import { readFile } from 'node:fs/promises';
import type { Hono } from 'hono';
import type { Context } from 'hono';
import type { GatewayManager, GatewayStatus } from './gatewayManager.ts';

const CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH ?? '/app/openclaw.json';
const getGatewayTokenFromConfig = async (): Promise<string | null> => {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    const cfg = JSON.parse(raw || '{}') as any;
    const tok = cfg?.gateway?.auth?.token;
    return typeof tok === 'string' && tok.trim().length > 0 ? tok.trim() : null;
  } catch {
    return null;
  }
};

type WrapperInit = {
  state: 'initializing' | 'ready' | 'error';
  startedAt: string;
  readyAt: string | null;
  error: string | null;
};

type ApiDeps = {
  wrapperInit: WrapperInit;
  getGateway: () => GatewayManager | null;
  getGatewayFallbackStatus: () => GatewayStatus;
  logInfo: (...args: unknown[]) => void;
  runFullReset: () => Promise<{ ok: boolean; error?: string; gateway: GatewayStatus }>;
};

export const registerApiRoutes = (app: Hono, deps: ApiDeps) => {
  app.get('/api/dashboard-token', async (c: Context) => {
    const tok = await getGatewayTokenFromConfig();
    if (!tok) {
      deps.logInfo(`/api/dashboard-token: token not available`);
      return c.json(
        { ok: false, error: 'Dashboard token not available yet', wrapper: deps.wrapperInit },
        503,
        { 'cache-control': 'no-store', 'retry-after': '2' },
      );
    }
    deps.logInfo(`/api/dashboard-token`);
    return c.json({ ok: true, token: tok }, 200, { 'cache-control': 'no-store' });
  });

  app.get('/api/gateway/status', (c: Context) => {
    const gateway = deps.getGateway();
    const payload = {
      ok: true,
      now: new Date().toISOString(),
      wrapper: deps.wrapperInit,
      gateway: gateway ? gateway.getStatus() : deps.getGatewayFallbackStatus(),
    };
    const content = JSON.stringify(payload);
    if (Math.random() < 0.1) deps.logInfo(`/api/gateway/status`, content, '(THROTTLED)'); // 10% chance to log
    return c.json(payload, 200, { 'cache-control': 'no-store' });
  });

  app.post('/api/gateway/stop', async (c: Context) => {
    const gateway = deps.getGateway();
    if (!gateway) {
      deps.logInfo(`/api/gateway/stop: Gateway not initialized yet`);
      return c.json({ ok: false, error: 'Gateway not initialized yet', wrapper: deps.wrapperInit }, 409, {
        'cache-control': 'no-store',
      });
    }
    await gateway.stop();
    deps.logInfo(`/api/gateway/stop`);
    return c.json(
      { ok: true, now: new Date().toISOString(), wrapper: deps.wrapperInit, gateway: gateway.getStatus() },
      200,
      { 'cache-control': 'no-store' },
    );
  });

  app.post('/api/gateway/start', async (c: Context) => {
    const gateway = deps.getGateway();
    if (!gateway) {
      deps.logInfo(`/api/gateway/start: Gateway not initialized yet`);
      return c.json({ ok: false, error: 'Gateway not initialized yet', wrapper: deps.wrapperInit }, 409, {
        'cache-control': 'no-store',
      });
    }
    await gateway.start();
    await gateway.ensureRunning();
    deps.logInfo(`/api/gateway/start`);
    return c.json(
      { ok: true, now: new Date().toISOString(), wrapper: deps.wrapperInit, gateway: gateway.getStatus() },
      200,
      { 'cache-control': 'no-store' },
    );
  });

  app.post('/api/gateway/restart', async (c: Context) => {
    const gateway = deps.getGateway();
    if (!gateway) {
      deps.logInfo(`/api/gateway/restart: Gateway not initialized yet`);
      return c.json({ ok: false, error: 'Gateway not initialized yet', wrapper: deps.wrapperInit }, 409, {
        'cache-control': 'no-store',
      });
    }
    await gateway.stop();
    await gateway.start();
    await gateway.ensureRunning();
    deps.logInfo(`/api/gateway/restart`);
    return c.json(
      { ok: true, now: new Date().toISOString(), wrapper: deps.wrapperInit, gateway: gateway.getStatus() },
      200,
      { 'cache-control': 'no-store' },
    );
  });

  app.post('/api/full-reset', async (c: Context) => {
    const gateway = deps.getGateway();
    if (!gateway) {
      deps.logInfo(`/api/full-reset: Gateway not initialized yet`);
      return c.json(
        { ok: false, error: 'Gateway not initialized yet', gateway: deps.getGatewayFallbackStatus() },
        409,
        { 'cache-control': 'no-store' },
      );
    }

    try {
      const result = await deps.runFullReset();
      deps.logInfo(`/api/full-reset: ${result.ok ? 'done' : 'failed'}`);

      const status = result.ok ? 200 : 500;
      return c.json(
        {
          ok: result.ok,
          error: result.error,
          now: new Date().toISOString(),
          wrapper: deps.wrapperInit,
          gateway: result.gateway,
        },
        status,
        { 'cache-control': 'no-store' },
      );
    } catch (err) {
      deps.logInfo(`/api/full-reset: error`, String(err));
      return c.json(
        {
          ok: false,
          error: String(err),
          now: new Date().toISOString(),
          wrapper: deps.wrapperInit,
          gateway: deps.getGatewayFallbackStatus(),
        },
        500,
        { 'cache-control': 'no-store' },
      );
    }
  });
};
