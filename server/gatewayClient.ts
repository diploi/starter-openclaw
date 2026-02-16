/**
 * File-based gateway client - reads status from process manager, writes desired state to control file.
 * Does not spawn processes; the process manager handles that.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { gatewaySettings } from './constants.ts';
import type { GatewayManager, GatewayStatus } from './gatewayManager.ts';

const { gatewayControlFilePath, gatewayStatusFilePath, gatewayHost, gatewayPort } = gatewaySettings;

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

const readStatus = (): GatewayStatus => {
  try {
    const raw = fs.readFileSync(gatewayStatusFilePath, 'utf8').trim();
    if (!raw) return defaultStatus();
    const parsed = JSON.parse(raw) as Partial<GatewayStatus>;
    return {
      state: parsed?.state ?? 'stopped',
      pid: typeof parsed?.pid === 'number' ? parsed.pid : null,
      target: parsed?.target ?? { host: gatewayHost, port: gatewayPort },
      startedAt: typeof parsed?.startedAt === 'string' ? parsed.startedAt : null,
      readyAt: typeof parsed?.readyAt === 'string' ? parsed.readyAt : null,
      restartCount: typeof parsed?.restartCount === 'number' ? parsed.restartCount : 0,
      lastExit: parsed?.lastExit ?? null,
      lastError: parsed?.lastError ?? null,
    };
  } catch {
    return defaultStatus();
  }
};

const writeControl = (desired: 'running' | 'stopped') => {
  try {
    ensureDir(gatewayControlFilePath);
    fs.writeFileSync(
      gatewayControlFilePath,
      JSON.stringify({ desired, updatedAt: new Date().toISOString() }, null, 2) + '\n',
      { encoding: 'utf8', mode: 0o600 },
    );
  } catch {
    // best-effort
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

const waitForRunning = async (timeoutMs: number): Promise<boolean> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = readStatus();
    if (status.state === 'running') return true;
    // Fallback: treat an actively listening gateway as ready even if status-file state lags.
    if (status.state === 'starting' && (await canConnect(status.target.host, status.target.port, 750))) return true;
    await sleep(250);
  }
  const status = readStatus();
  return status.state === 'running' || (await canConnect(status.target.host, status.target.port, 1000));
};

const waitForStopped = async (timeoutMs: number): Promise<boolean> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = readStatus();
    if (status.state === 'stopped') return true;
    if (status.state === 'stopping' && !(await canConnect(status.target.host, status.target.port, 750))) return true;
    await sleep(250);
  }
  const status = readStatus();
  return status.state === 'stopped' || !(await canConnect(status.target.host, status.target.port, 1000));
};

export const createGatewayClient = (): GatewayManager => {
  const POLL_TIMEOUT_MS = 60_000;

  return {
    getStatus: readStatus,

    async ensureRunning() {
      writeControl('running');
      const ok = await waitForRunning(POLL_TIMEOUT_MS);
      if (!ok) throw new Error('Gateway did not become running in time');
    },

    async start() {
      writeControl('running');
      await this.ensureRunning();
    },

    async stop() {
      writeControl('stopped');
      const ok = await waitForStopped(POLL_TIMEOUT_MS);
      if (!ok) throw new Error('Gateway did not stop in time');
    },
  };
};
