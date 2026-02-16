import childProcess from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { gatewaySettings } from './constants.ts';
import type { OpenClawConfig } from './openclawjson.type.ts';
import { logInfo } from './utils.ts';

const { configPath, statePath, workspacePath, gatewayStateFilePath, openclawScriptPath, gatewayHost, gatewayPort } = gatewaySettings;
const detach = true; // In dev watch mode, detaching makes restarts reliable (gateway survives parent restart).

type PersistedGatewayState = {
  desired: 'running' | 'stopped';
  pid: number | null;
  updatedAt: string;
};

const defaultPersistedState = (): PersistedGatewayState => ({
  desired: 'running',
  pid: null,
  updatedAt: new Date().toISOString(),
});

const readPersistedState = (): PersistedGatewayState => {
  // Best-effort: if state file is missing or invalid, default to desired=running.
  try {
    const raw = fs.readFileSync(gatewayStateFilePath, 'utf8').trim();
    if (!raw) return defaultPersistedState();

    // Backward-compat: if the file is just a number, treat it as pid-only.
    if (/^\d+$/.test(raw)) {
      const pid = Number(raw);
      return { ...defaultPersistedState(), pid: Number.isFinite(pid) ? pid : null };
    }

    const parsed = JSON.parse(raw) as Partial<PersistedGatewayState> | null;
    const desired = parsed?.desired === 'stopped' ? 'stopped' : 'running';
    const pid = typeof parsed?.pid === 'number' && Number.isFinite(parsed.pid) ? parsed.pid : null;
    const updatedAt = typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString();
    return { desired, pid, updatedAt };
  } catch {
    return defaultPersistedState();
  }
};

const writePersistedState = (next: PersistedGatewayState) => {
  try {
    fs.mkdirSync(path.dirname(gatewayStateFilePath), { recursive: true });
    fs.writeFileSync(gatewayStateFilePath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // best-effort
  }
};

const updatePersistedState = (patch: Partial<PersistedGatewayState>) => {
  const cur = readPersistedState();
  writePersistedState({
    ...cur,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
};


export type GatewayState = 'stopped' | 'starting' | 'running' | 'stopping';

export type GatewayStatus = {
  state: GatewayState;
  pid: number | null;
  target: { host: string; port: number };
  startedAt: string | null;
  readyAt: string | null;
  restartCount: number;
  lastExit: { code: number | null; signal: NodeJS.Signals | null; at: string } | null;
  lastError: string | null;
};

export type GatewayManagerOptions = {
  token?: string;
  configPath?: string;
  stateDir?: string;
  workspaceDir?: string;
  openclawEntry?: string;
  openclawNode?: string;
  // In dev watch mode, detaching makes restarts reliable (gateway survives parent restart).
  detach?: boolean;
};

export type GatewayManager = {
  getStatus: () => GatewayStatus;
  ensureRunning: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

const sleep = (ms: number) => {
  return new Promise((r) => setTimeout(r, ms));
};

const getProcState = (pid: number): string | null => {
  // Linux-only best-effort. Format: "pid (comm) state ..."
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rparen = stat.lastIndexOf(')');
    if (rparen < 0) return null;
    const after = stat.slice(rparen + 2); // ") "
    const state = after.split(' ')[0];
    return state || null;
  } catch {
    return null;
  }
};

const getProcPpid = (pid: number): number | null => {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rparen = stat.lastIndexOf(')');
    if (rparen < 0) return null;
    const after = stat.slice(rparen + 2); // ") "
    const parts = after.split(' ');
    // parts[0] = state, parts[1] = ppid
    const ppid = Number(parts[1]);
    return Number.isFinite(ppid) && ppid > 1 ? ppid : null;
  } catch {
    return null;
  }
};

const getProcComm = (pid: number): string | null => {
  try {
    return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim() || null;
  } catch {
    return null;
  }
};

const isPidRunning = (pid: number): boolean => {
  if (!pid || pid <= 1) return false;

  // Treat zombies as not-running for our purposes. A zombie PID will still
  // respond to kill(0) but cannot be signaled/killed and will block restarts.
  const st = getProcState(pid);
  if (st === 'Z') return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const pidExists = (pid: number): boolean => getProcState(pid) != null;

const waitForPidGone = async (pid: number, timeoutMs: number): Promise<boolean> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!pidExists(pid)) return true;
    await sleep(200);
  }
  return !pidExists(pid);
};

const waitForPidExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = getProcState(pid);
    if (!st) return true;
    if (st === 'Z') {
      await sleep(250);
      continue;
    }
    if (!isPidRunning(pid)) return true;
    await sleep(250);
  }
  const finalState = getProcState(pid);
  return !finalState || finalState !== 'Z';
};

const canConnect = async (host: string, port: number, timeoutMs: number): Promise<boolean> => {
  return await new Promise((resolve) => {
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
};

const waitForReady = async (host: string, port: number, timeoutMs: number): Promise<boolean> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await canConnect(host, port, 750)) return true;
    await sleep(250);
  }
  return false;
};

const clearPersistedPid = () => {
  updatePersistedState({ pid: null });
};

const buildArgs = (port: number, token: string) => {
  return [
    'gateway',
    'run',
    '--bind',
    'loopback',
    '--port',
    String(port),
    //'--auth',
    //'token',
    //'--token',
    //token,
  ];
};

const resolveOpenclawCommand = (openclawEntry: string, openclawNode: string) => {
  // Prefer global launcher if present; otherwise run the built entry directly.
  // We intentionally do not try to probe PATH here; the spawn error/exit will tell us.
  return {
    primary: { cmd: 'openclaw', wrapArgs: (args: string[]) => args },
    fallback: { cmd: openclawNode, wrapArgs: (args: string[]) => [openclawEntry, ...args] },
  };
};

const openclawEnv = () => ({
  ...process.env,
  OPENCLAW_CONFIG_PATH: configPath,
  OPENCLAW_STATE_DIR: statePath,
  OPENCLAW_WORKSPACE_DIR: workspacePath,
});

const runOpenclawGatewayStop = async (): Promise<void> => {
  const { primary, fallback } = resolveOpenclawCommand(openclawScriptPath, 'node');
  const args = ['gateway', 'stop'];
  const env = openclawEnv();
  let r = await runWithOutput(primary.cmd, args, { timeoutMs: 15_000, env });
  if (r.code === 127) r = await runWithOutput(fallback.cmd, fallback.wrapArgs(args), { timeoutMs: 15_000, env });
  if (r.code !== 0 && !r.output.toLowerCase().includes('not running')) {
    throw new Error(`openclaw gateway stop failed (exit ${r.code}): ${r.output}`);
  }
};

const runWithOutput = async (
  cmd: string,
  args: string[],
  opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
) => {
  const timeoutMs = opts?.timeoutMs ?? 20_000;
  const env = opts?.env ?? process.env;
  return await new Promise<{ code: number; output: string }>((resolve) => {
    const proc = childProcess.spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env });

    let out = '';
    proc.stdout?.on('data', (d) => (out += d.toString('utf8')));
    proc.stderr?.on('data', (d) => (out += d.toString('utf8')));

    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve({ code: 124, output: out });
    }, timeoutMs);

    proc.on('error', (err) => {
      clearTimeout(timer);
      out += `\n[spawn error] ${String(err)}\n`;
      resolve({ code: 127, output: out });
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 0, output: out });
    });
  });
};

export const createGatewayManager = (config: OpenClawConfig): GatewayManager => {

  const token = config.gateway?.auth?.token;
  if (!token) throw new Error('Gateway token missing.');

  const shutdownTimeoutMs = Number(process.env.GATEWAY_SHUTDOWN_TIMEOUT_MS ?? 30_000);

  // Initialize desired state from disk (survives container restarts).
  const initialPersisted = readPersistedState();
  let desired = initialPersisted.desired === 'running';
  let proc: childProcess.ChildProcess | null = null;
  let starting: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let stopping = false;

  let state: GatewayState = 'stopped';
  let startedAt: string | null = null;
  let readyAt: string | null = null;
  let restartCount = 0;
  let lastExit: GatewayStatus['lastExit'] = null;
  let lastError: string | null = null;
  let lastStartOutput: string | null = null;
  let adoptedPid: number | null = initialPersisted.pid && isPidRunning(initialPersisted.pid) ? initialPersisted.pid : null;

  const getStatus = (): GatewayStatus => ({
    state,
    pid: proc?.pid ?? adoptedPid ?? null,
    target: { host: gatewayHost, port: gatewayPort },
    startedAt,
    readyAt,
    restartCount,
    lastExit,
    lastError,
  });

  const killPidBestEffort = async (pid: number, timeoutMs: number) => {
    if (!pid || pid <= 1) return;

    // Can't kill a zombie; it must be reaped by its parent.
    if (getProcState(pid) === 'Z') return;

    try {
      if (detach) process.kill(-pid, 'SIGTERM');
      else process.kill(pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // ignore
      }
    }

    await waitForPidExit(pid, timeoutMs);
    if (isPidRunning(pid)) {
      try {
        if (detach) process.kill(-pid, 'SIGKILL');
        else process.kill(pid, 'SIGKILL');
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // ignore
        }
      }
    }
  };

  const cleanupPidBestEffort = async (pid: number, timeoutMs: number) => {
    if (!pid || pid <= 1) return;
    const st = getProcState(pid);
    if (st === 'Z') {
      await reapZombieByKillingParentBestEffort(pid);
      await waitForPidExit(pid, Math.min(5_000, timeoutMs));
      return;
    }

    await killPidBestEffort(pid, timeoutMs);
    if (getProcState(pid) === 'Z') {
      await reapZombieByKillingParentBestEffort(pid);
      await waitForPidExit(pid, Math.min(5_000, timeoutMs));
    }
  };

  const waitForChildExit = async (child: childProcess.ChildProcess | null, timeoutMs: number) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  const reapZombieByKillingParentBestEffort = async (zombiePid: number) => {
    const st = getProcState(zombiePid);
    if (st !== 'Z') return false;

    const ppid = getProcPpid(zombiePid);
    if (!ppid) return false;

    // Only kill parents that look like they're part of OpenClaw, to avoid collateral damage.
    const comm = (getProcComm(ppid) || '').toLowerCase();
    const allowed = comm.includes('openclaw') || comm.includes('node');
    if (!allowed) return false;

    try {
      process.kill(ppid, 'SIGTERM');
    } catch {
      // ignore
    }

    // Give the kernel/init some time to reap the zombie after parent exit.
    await sleep(1500);
    return getProcState(zombiePid) !== 'Z';
  };

  const clearLockPidBestEffort = async (lockPid: number) => {
    if (!lockPid || lockPid <= 1) return;
    try {
      await runOpenclawGatewayStop();
    } catch {
      // Fall back to killing the process if openclaw gateway stop fails
      const st = getProcState(lockPid);
      if (st === 'Z') {
        await reapZombieByKillingParentBestEffort(lockPid);
        return;
      }
      await killPidBestEffort(lockPid, 30_000);
    }
    await waitForPidGone(lockPid, 15_000);
  };

  const parsePidFromLockMessage = (text: string): number | null => {
    if (!text) return null;
    const m = text.match(/\(pid\s+(\d+)\)/i) || text.match(/\bpid\s+(\d+)\b/i);
    if (!m) return null;
    const pid = Number(m[1]);
    return Number.isFinite(pid) ? pid : null;
  };

  const start = async () => {
    desired = true;
    updatePersistedState({ desired: 'running' });
    if (proc) return;
    if (stopPromise) await stopPromise;
    if (starting) return await starting;

    starting = (async () => {
      state = 'starting';
      lastError = null;
      startedAt = new Date().toISOString();
      readyAt = null;

      const existingPid = readPersistedState().pid;
      if (existingPid) {
        try {
          await runOpenclawGatewayStop();
        } catch {
          // If openclaw stop fails, try killing the process directly
          if (pidExists(existingPid)) {
            await cleanupPidBestEffort(existingPid, 15_000);
            await waitForPidGone(existingPid, 10_000);
          }
        }
        clearPersistedPid();
      }

      const args = buildArgs(gatewayPort, token);
      const { primary, fallback } = resolveOpenclawCommand(openclawScriptPath, 'node');

      const spawnOnce = (cmd: string, argv: string[]) => {
        const p = childProcess.spawn(cmd, argv, {
          detached: detach,
          // In detached mode, keep logs visible (otherwise stdout/stderr are discarded).
          stdio: detach ? (['ignore', 'inherit', 'inherit'] as const) : (['ignore', 'pipe', 'pipe'] as const),
          env: openclawEnv(),
        });

        if (!detach) {
          let snippet = '';
          const cap = 64 * 1024;
          const push = (chunk: Buffer, to: 'stdout' | 'stderr') => {
            if (to === 'stdout') process.stdout.write(chunk);
            else process.stderr.write(chunk);
            snippet += chunk.toString('utf8');
            if (snippet.length > cap) snippet = snippet.slice(-cap);
            lastStartOutput = snippet;
          };
          p.stdout?.on('data', (d) => push(d, 'stdout'));
          p.stderr?.on('data', (d) => push(d, 'stderr'));
        }
        return p;
      };

      let p = spawnOnce(primary.cmd, primary.wrapArgs(args));
      p.once('error', () => {
        // We'll fall back below.
      });

      await sleep(200);
      if (p.exitCode !== null || p.signalCode !== null) {
        p = spawnOnce(fallback.cmd, fallback.wrapArgs(args));
      }

      proc = p;
      if (p.pid) {
        adoptedPid = p.pid;
        updatePersistedState({ desired: 'running', pid: p.pid });
      }
      if (detach) p.unref();

      p.on('error', (err) => {
        lastError = String(err);
      });

      p.on('exit', (code, signal) => {
        lastExit = { code, signal: (signal as NodeJS.Signals | null) ?? null, at: new Date().toISOString() };
        proc = null;
        adoptedPid = null;
        readyAt = null;
        state = 'stopped';
        clearPersistedPid();

        if (desired && !stopping) {
          restartCount += 1;
          const backoffMs = Math.min(15_000, 500 * restartCount);
          setTimeout(() => void start(), backoffMs);
        }
      });
    })().finally(() => {
      starting = null;
    });

    return await starting;
  };

  const ensureRunning = async () => {
    if (state === 'running') return;
    if (stopPromise) await stopPromise;

    // If persisted desired state is stopped, do not auto-start (survives container restarts).
    if (readPersistedState().desired === 'stopped') {
      desired = false;
      state = 'stopped';
      return;
    }

    if (await canConnect(gatewayHost, gatewayPort, 250)) {
      state = 'running';
      readyAt = readyAt ?? new Date().toISOString();
      const pidFromState = readPersistedState().pid;
      adoptedPid = pidFromState && isPidRunning(pidFromState) ? pidFromState : adoptedPid;
      return;
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await start();
      const ok = await waitForReady(gatewayHost, gatewayPort, 40_000);
      if (ok) {
        readyAt = new Date().toISOString();
        state = 'running';
        return;
      }


      const out = lastStartOutput || lastError || '';
      const looksLikeLock =
        out.includes('gateway already running') ||
        out.includes('lock timeout') ||
        out.includes('openclaw gateway stop') ||
        out.toLowerCase().includes('already running');

      if (attempt === 0 && looksLikeLock) {
        const lockPid = parsePidFromLockMessage(out) || readPersistedState().pid;
        if (lockPid) await clearLockPidBestEffort(lockPid);
        clearPersistedPid();
        continue;
      }

      throw new Error(`Gateway did not become ready on ${gatewayHost}:${gatewayPort}`);
    }
  };

  const stop = async () => {
    if (stopPromise) return await stopPromise;


    logInfo(`Stopping gateway...`);
    desired = false;
    stopping = true;
    state = 'stopping';
    updatePersistedState({ desired: 'stopped' });

    const targetPid = proc?.pid ?? readPersistedState().pid ?? adoptedPid;

    stopPromise = (async () => {
      try {
        try {
          await runOpenclawGatewayStop();
        } catch {
          // Continue with process kill if openclaw gateway stop fails (e.g. not installed)
        }

        if (proc) {
          const pid = proc.pid ?? null;
          if (pid) {
            try {
              if (detach) process.kill(-pid, 'SIGTERM');
              else process.kill(pid, 'SIGTERM');
            } catch {
              try {
                process.kill(pid, 'SIGTERM');
              } catch {
                // ignore
              }
            }
            await waitForChildExit(proc, shutdownTimeoutMs);
            if (pid && pidExists(pid)) {
              try {
                if (detach) process.kill(-pid, 'SIGKILL');
                else process.kill(pid, 'SIGKILL');
              } catch {
                try {
                  process.kill(pid, 'SIGKILL');
                } catch {
                  // ignore
                }
              }
            }
          }
          if (pid) await waitForPidGone(pid, shutdownTimeoutMs);
        } else if (targetPid && pidExists(targetPid)) {
          await cleanupPidBestEffort(targetPid, shutdownTimeoutMs);
          await waitForPidGone(targetPid, shutdownTimeoutMs);
        }

      } finally {
        proc = null;
        adoptedPid = null;
        state = 'stopped';
        readyAt = null;
        updatePersistedState({ pid: null });
        stopping = false;
      }
    })().finally(() => {
      stopPromise = null;
    });

    return await stopPromise;
  };

  return { getStatus, ensureRunning, start, stop };
};

