#!/usr/bin/env node
/**
 * Gateway process manager - runs as a separate process, spawns and reaps the openclaw gateway.
 * Communicates via control file (desired state) and status file (current state).
 * Being the sole parent of the gateway process ensures proper reaping (no zombies).
 */
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { gatewaySettings } from './constants.ts';
import type { OpenClawConfig } from './openclawjson.type.ts';

const {
  configPath,
  statePath,
  workspacePath,
  gatewayControlFilePath,
  gatewayStatusFilePath,
  openclawScriptPath,
  gatewayHost,
  gatewayPort,
} = gatewaySettings;

const POLL_MS = 500;
const READY_TIMEOUT_MS = 40_000;

type ControlState = { desired: 'running' | 'stopped'; updatedAt: string };

type GatewayStatus = {
  state: 'stopped' | 'starting' | 'running' | 'stopping';
  pid: number | null;
  target: { host: string; port: number };
  startedAt: string | null;
  readyAt: string | null;
  restartCount: number;
  lastExit: { code: number | null; signal: string | null; at: string } | null;
  lastError: string | null;
};

const defaultStatus = (): GatewayStatus => ({
  state: 'stopped',
  pid: null,
  target: { host: gatewayHost, port: gatewayPort },
  startedAt: null,
  readyAt: null,
  restartCount: 0,
  lastExit: null,
  lastError: null,
});

const ensureDir = (filePath: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const readControl = (): ControlState => {
  try {
    const raw = fs.readFileSync(gatewayControlFilePath, 'utf8').trim();
    if (!raw) return { desired: 'stopped', updatedAt: new Date().toISOString() };
    const parsed = JSON.parse(raw) as Partial<ControlState>;
    return {
      desired: parsed?.desired === 'stopped' ? 'stopped' : 'running',
      updatedAt: parsed?.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return { desired: 'stopped', updatedAt: new Date().toISOString() };
  }
};

const writeStatus = (status: GatewayStatus) => {
  try {
    ensureDir(gatewayStatusFilePath);
    fs.writeFileSync(gatewayStatusFilePath, `${JSON.stringify(status, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // best-effort
  }
};

const loadConfig = (): OpenClawConfig | null => {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw || '{}') as OpenClawConfig;
  } catch {
    return null;
  }
};

const openclawEnv = () => ({
  ...process.env,
  OPENCLAW_CONFIG_PATH: configPath,
  OPENCLAW_STATE_DIR: statePath,
  OPENCLAW_WORKSPACE_DIR: workspacePath,
});

const canConnect = (host: string, port: number, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });

const waitForReady = async (timeoutMs: number): Promise<boolean> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await canConnect(gatewayHost, gatewayPort, 750)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

const runOpenclawGatewayStop = async (): Promise<void> => {
  const env = openclawEnv();
  const args = ['gateway', 'stop'];
  const run = (cmd: string, argv: string[]) =>
    new Promise<{ code: number; output: string }>((resolve) => {
      const proc = childProcess.spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'], env });
      let out = '';
      proc.stdout?.on('data', (d) => (out += d.toString('utf8')));
      proc.stderr?.on('data', (d) => (out += d.toString('utf8')));
      proc.on('close', (code) => resolve({ code: code ?? 0, output: out }));
    });
  let r = await run('openclaw', args);
  if (r.code === 127) r = await run('node', [openclawScriptPath, ...args]);
  if (r.code !== 0 && !r.output.toLowerCase().includes('not running')) {
    throw new Error(`openclaw gateway stop failed (exit ${r.code}): ${r.output}`);
  }
};

const resolveOpenclawCommand = () => {
  return {
    primary: { cmd: 'openclaw' as const, wrapArgs: (args: string[]) => args },
    fallback: { cmd: 'node' as const, wrapArgs: (args: string[]) => [openclawScriptPath, ...args] },
  };
};

const buildArgs = (port: number) => ['gateway', 'run', '--bind', 'loopback', '--port', String(port)];

async function main() {
  let proc: childProcess.ChildProcess | null = null;
  let status: GatewayStatus = defaultStatus();
  let restartCount = 0;

  const writeStatusAndLog = (next: GatewayStatus, msg?: string) => {
    status = next;
    writeStatus(status);
    if (msg) console.log(`[process-manager] ${msg}`);
  };

  const stopChild = (): Promise<void> => {
    return new Promise((resolve) => {
      if (!proc || !proc.pid) {
        resolve();
        return;
      }
      const pid = proc.pid;
      writeStatusAndLog({ ...status, state: 'stopping' }, `Stopping gateway (pid ${pid})`);

      proc.once('exit', (code, signal) => {
        proc = null;
        writeStatusAndLog(
          {
            ...status,
            state: 'stopped',
            pid: null,
            readyAt: null,
            lastExit: { code, signal: signal as string | null, at: new Date().toISOString() },
          },
          `Gateway exited (pid ${pid}) code=${code} signal=${signal}`,
        );
        resolve();
      });

      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // ignore
        }
        proc = null;
        writeStatusAndLog(
          {
            ...status,
            state: 'stopped',
            pid: null,
            readyAt: null,
            lastExit: { code: null, signal: null, at: new Date().toISOString() },
          },
          `Gateway already stopped (pid ${pid})`,
        );
        resolve();
      }
    });
  };

  const startChild = async (): Promise<boolean> => {
    const config = loadConfig();
    if (!config?.gateway?.auth?.token) {
      writeStatusAndLog({ ...status, lastError: 'Config or gateway token missing' }, 'Config not ready, skipping start');
      return false;
    }

    try {
      await runOpenclawGatewayStop();
    } catch {
      // Continue - lock might not exist
    }

    writeStatusAndLog({ ...status, state: 'starting', startedAt: new Date().toISOString(), lastError: null });
    const args = buildArgs(gatewayPort);
    const { primary, fallback } = resolveOpenclawCommand();
    const env = openclawEnv();

    const spawnProc = (cmd: string, argv: string[]) =>
      childProcess.spawn(cmd, argv, {
        stdio: ['ignore', 'inherit', 'inherit'],
        env,
      });

    let p = spawnProc(primary.cmd, primary.wrapArgs(args));
    await new Promise((r) => setTimeout(r, 200));
    if (p.exitCode != null || p.signalCode != null) {
      p = spawnProc(fallback.cmd, fallback.wrapArgs(args));
    }

    proc = p;
    const pid = p.pid ?? null;
    writeStatusAndLog({ ...status, pid, state: 'starting' }, `Gateway started (pid ${pid})`);

    p.on('exit', (code, signal) => {
      if (proc === p) {
        proc = null;
        restartCount += 1;
        writeStatusAndLog(
          {
            ...status,
            state: 'stopped',
            pid: null,
            readyAt: null,
            restartCount,
            lastExit: { code, signal: signal as string | null, at: new Date().toISOString() },
          },
          `Gateway exited (pid ${pid}) code=${code} signal=${signal}`,
        );
      }
    });

    const ready = await waitForReady(READY_TIMEOUT_MS);
    if (ready && proc === p) {
      writeStatusAndLog(
        { ...status, state: 'running', readyAt: new Date().toISOString() },
        `Gateway ready (pid ${pid})`,
      );
      return true;
    }
    if (!proc) return false;
    writeStatusAndLog({ ...status, lastError: 'Gateway did not become ready in time' });
    return false;
  };

  console.log('[process-manager] Started, watching control file');
  writeStatusAndLog(defaultStatus());

  const loop = async () => {
    const control = readControl();

    if (control.desired === 'stopped') {
      if (proc) {
        await stopChild();
      }
    } else {
      if (!proc) {
        await startChild();
      } else if (status.state !== 'running') {
        // Recover from stale "starting" states if the gateway is already reachable.
        const reachable = await canConnect(status.target.host, status.target.port, 750);
        if (reachable) {
          writeStatusAndLog(
            { ...status, state: 'running', readyAt: status.readyAt ?? new Date().toISOString(), lastError: null },
            `Gateway reachable; marking running (pid ${status.pid})`,
          );
        }
      }
    }
  };

  await loop();
  const interval = setInterval(loop, POLL_MS);

  process.on('SIGTERM', async () => {
    console.log('[process-manager] SIGTERM received');
    clearInterval(interval);
    await stopChild();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('[process-manager] SIGINT received');
    clearInterval(interval);
    await stopChild();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[process-manager] Fatal:', err);
  process.exit(1);
});
