import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import net from 'node:net';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { IncomingMessage } from 'node:http';
import type { Context } from 'hono';
import { initOpenclaw } from './initOpenclaw.ts';
import { createGatewayClient } from './gatewayClient.ts';
import type { GatewayManager, GatewayStatus } from './gatewayManager.ts';
import { logInfo } from './utils.ts';
import { registerApiRoutes } from './api.ts';
import { handleTerminalUpgrade, isTerminalWsPath } from './terminalWs.ts';


const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 18789;
const VITE_HOST = process.env.VITE_HOST ?? '127.0.0.1';
const VITE_PORT = Number(process.env.VITE_PORT ?? 5173);
const LOGIN_COOKIE_NAME = 'diploi-jwt-login';
const LOGIN_SECRET = process.env.DIPLOI_LOGIN_SECRET ?? '';


const getGatewayFallbackStatus = (): GatewayStatus => ({
  state: 'stopped',
  pid: null,
  target: { host: TARGET_HOST, port: TARGET_PORT },
  startedAt: null,
  readyAt: null,
  restartCount: 0,
  lastExit: null,
  lastError: null,
});



let gateway: GatewayManager | null = null;
let gatewayStartPromise: Promise<void> | null = null;


const wrapperInit = {
  state: 'initializing' as 'initializing' | 'ready' | 'error',
  startedAt: new Date().toISOString(),
  readyAt: null as string | null,
  error: null as string | null,
};

const INDEX_HTML_URL = new URL('./index.html', import.meta.url);
let indexHtmlCache: string | null = null;
const getIndexHtml = async () => {
  if (indexHtmlCache != null) return indexHtmlCache;
  indexHtmlCache = await readFile(INDEX_HTML_URL, 'utf8');
  return indexHtmlCache;
};

const LOGIN_HTML_URL = new URL('./login.html', import.meta.url);
let loginHtmlCache: string | null = null;
const getLoginHtml = async () => {
  if (loginHtmlCache != null) return loginHtmlCache;
  loginHtmlCache = await readFile(LOGIN_HTML_URL, 'utf8');
  return loginHtmlCache;
};

const isDashboardPath = (pathname: string) => pathname === '/dashboard' || pathname.startsWith('/dashboard/');

const base64UrlDecode = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  return Buffer.from(padded, 'base64');
};

const parseCookieHeader = (header: string | null): Record<string, string> => {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (!rawKey) continue;
    out[rawKey] = rest.join('=');
  }
  return out;
};

const verifyJwt = (token: string, secret: string) => {
  if (!secret) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, signatureB64] = parts;
  try {
    const header = JSON.parse(base64UrlDecode(headerB64).toString('utf8')) as { alg?: string };
    if (header.alg && header.alg !== 'HS256') return false;
    const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as { exp?: number; nbf?: number };
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.nbf === 'number' && now < payload.nbf) return false;
    if (typeof payload.exp === 'number' && now >= payload.exp) return false;
    const signature = base64UrlDecode(signatureB64);
    const expected = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest();
    if (signature.length !== expected.length) return false;
    return timingSafeEqual(signature, expected);
  } catch {
    return false;
  }
};

const ensureGatewayReady = () => {
  if (!gateway || gateway.getStatus().state !== 'running') {
    if (gateway && !gatewayStartPromise) {
      gatewayStartPromise = gateway.ensureRunning().finally(() => {
        gatewayStartPromise = null;
      });
    }
    return false;
  }
  return true;
};

type ProxyTarget = { host: string; port: number; bearer?: string };
const proxyTo = async (c: Context, target: ProxyTarget) => {
  const url = new URL(c.req.url);
  url.protocol = 'http:';
  url.hostname = target.host;
  url.port = String(target.port);

  const headers = new Headers(c.req.raw.headers);
  headers.set('host', `${target.host}:${target.port}`);
  if (target.bearer) headers.set('authorization', `Bearer ${target.bearer}`);

  const method = c.req.method;
  const body = method === 'GET' || method === 'HEAD' ? undefined : c.req.raw.body;
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
    body,
    redirect: 'manual',
  };
  if (body) init.duplex = 'half';

  try {
    const upstream = await fetch(url, init);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  } catch (err) {
    return new Response(`Upstream error: ${String(err)}`, {
      status: 502,
      headers: { 'content-type': 'text/plain' },
    });
  }
};

const app = new Hono();

const loginHeaders = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
app.use('*', async (c: Context, next) => {
  const url = new URL(c.req.url);
  const pathname = url.pathname;
  const isApiPath = pathname === '/api' || pathname.startsWith('/api/');
  const isLogoutPath = pathname === '/api/logout';
  const isProtected = pathname === '/' || isApiPath;
  if (!isProtected || isLogoutPath) return next();

  const cookies = parseCookieHeader(c.req.raw.headers.get('cookie'));
  const token = cookies[LOGIN_COOKIE_NAME];
  if (token && verifyJwt(token, LOGIN_SECRET)) return next();

  try {
    const html = await getLoginHtml();
    return c.html(html, 401, loginHeaders);
  } catch (err) {
    return c.text(`Failed to read login.html: ${String(err)}`, 500);
  }
});

app.get('/healthz', (c: Context) => {
  logInfo(`/healthz`);
  return c.json({ ok: true });
});

const runNpmClean = (cwd: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'clean'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });
    let stderr = '';
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm run clean exited with ${code}: ${stderr}`));
    });
  });

const runFullReset = async (): Promise<{ ok: boolean; error?: string; gateway: GatewayStatus }> => {
  if (!gateway) {
    return { ok: false, error: 'Gateway not initialized yet', gateway: getGatewayFallbackStatus() };
  }
  try {
    await gateway.stop();
    logInfo('full-reset: gateway stopped');
    await runNpmClean(process.cwd());
    logInfo('full-reset: npm run clean done');
    await initOpenclaw();
    await gateway.ensureRunning();
    logInfo('full-reset: gateway started');
    return { ok: true, gateway: gateway.getStatus() };
  } catch (err) {
    logInfo('full-reset: error', String(err));
    return {
      ok: false,
      error: String(err),
      gateway: gateway ? gateway.getStatus() : getGatewayFallbackStatus(),
    };
  }
};


registerApiRoutes(app, {
  wrapperInit,
  getGateway: () => gateway,
  getGatewayFallbackStatus,
  logInfo,
  runFullReset,
});

app.post('/api/logout', (c: Context) => {
  const url = new URL(c.req.url);
  const host = url.hostname;
  const expires = 'Thu, 01 Jan 1970 00:00:00 GMT';
  const baseCookie = `${LOGIN_COOKIE_NAME}=; Max-Age=0; Expires=${expires}; Path=/; HttpOnly; SameSite=None; Secure`;
  const headers = new Headers({
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });

  headers.append('set-cookie', baseCookie);
  if (host && !['localhost', '127.0.0.1', '::1'].includes(host)) {
    headers.append('set-cookie', `${baseCookie}; Domain=${host}`);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
});

const indexHeaders = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
const serveIndex = async (c: Context) => {
  try {
    const html = await getIndexHtml();
    logInfo(`/index.html`);
    return c.html(html, 200, indexHeaders);
  } catch (err) {
    return c.text(`Failed to read index.html: ${String(err)}`, 500);
  }
};

//app.get('/', serveIndex);
///app.get('/index.html', serveIndex);
//app.on('HEAD', '/', () => new Response(null, { status: 200, headers: indexHeaders }));
//app.on('HEAD', '/index.html', () => new Response(null, { status: 200, headers: indexHeaders }));

const dashboardHandler = async (c: Context) => {
  if (!ensureGatewayReady()) {
    return c.json(
      {
        ok: false,
        error: 'Gateway not ready yet',
        wrapper: wrapperInit,
        gateway: gateway ? gateway.getStatus() : getGatewayFallbackStatus(),
      },
      503,
      { 'cache-control': 'no-store', 'retry-after': '2' },
    );
  }
  return proxyTo(c, { host: TARGET_HOST, port: TARGET_PORT });
};

app.all('/dashboard', dashboardHandler);
app.all('/dashboard/*', dashboardHandler);
app.all('*', (c: Context) => proxyTo(c, { host: VITE_HOST, port: VITE_PORT }));

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOSTNAME ?? '0.0.0.0';

const server = serve({ fetch: app.fetch, port, hostname: host });
server.on('listening', () => {
  logInfo(`Listening on ${host}:${port}`);
  logInfo(`Proxying dashboard to http://${TARGET_HOST}:${TARGET_PORT}`);
  logInfo(`Proxying app routes to http://${VITE_HOST}:${VITE_PORT}`);
});


// Initialize OpenClaw + gateway asynchronously.
// Gateway lifecycle is managed by processManager.ts; we just ensure config exists and signal desired state.
void (async () => {
  try {
    await initOpenclaw();
    gateway = createGatewayClient();
    await gateway.ensureRunning();
    wrapperInit.state = 'ready';
    wrapperInit.readyAt = new Date().toISOString();
  } catch (err) {
    wrapperInit.state = 'error';
    wrapperInit.error = String(err);
  }
})();

process.on('SIGTERM', () => {
  logInfo(`SIGTERM received`);
  // In watch mode, SIGTERM is typically used for hot-restarts. Let the gateway
  // keep running so the next wrapper instance can adopt it without lock races.
  process.exit(0);
  //void gateway?.stop().finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  logInfo(`SIGINT received`);
  process.exit(0);
});

process.on('SIGHUP', () => {
  logInfo(`SIGHUP received`);
  process.exit(0);
  //void gateway?.stop().finally(() => process.exit(0));
});


process.on('exit', () => {
  logInfo(`exit received`);
  // Can't await here; best-effort only.
  //if (!isWatchMode) void gateway?.stop();
});

server.on('upgrade', (req: IncomingMessage, socket: net.Socket, head: Buffer) => {
  const pathname = (req.url || '/').split('?')[0] || '/';

  // Handle terminal WebSocket in the wrapper (no gateway required)
  if (isTerminalWsPath(pathname)) {
    logInfo(`terminal upgrade received: ${req.url}`);
    if (handleTerminalUpgrade(req, socket, head)) return;
  }

  const isHmrPath = pathname === '/hmr' || pathname.startsWith('/hmr/');
  const useGateway = !isHmrPath;
  const targetHost = useGateway ? TARGET_HOST : VITE_HOST;
  const targetPort = useGateway ? TARGET_PORT : VITE_PORT;

  // Only allow WS upgrades to the gateway when it is ready.
  if (useGateway && (!gateway || gateway.getStatus().state !== 'running')) {
    socket.destroy();
    return;
  }

  const upstreamSocket = net.connect(targetPort, targetHost, () => {
    // Forward the original upgrade request to the upstream server.
    // Preserve header casing via rawHeaders, but replace Host to match the target.
    const raw = req.rawHeaders || [];
    const headerLines: string[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      const key = raw[i];
      const value = raw[i + 1];
      if (!key) continue;
      if (String(key).toLowerCase() === 'host') continue;
      if (String(key).toLowerCase() === 'authorization') continue;
      headerLines.push(`${key}: ${value}`);
    }
    headerLines.push(`Host: ${targetHost}:${targetPort}`);
    //if (bearer) headerLines.push(`Authorization: Bearer ${bearer}`);

    upstreamSocket.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headerLines.join('\r\n')}\r\n\r\n`);
    if (head && head.length) upstreamSocket.write(head);

    socket.pipe(upstreamSocket);
    upstreamSocket.pipe(socket);
  });

  const onError = () => {
    try {
      socket.destroy();
    } catch {
      // ignore
    }
    try {
      upstreamSocket.destroy();
    } catch {
      // ignore
    }
  };

  upstreamSocket.on('error', onError);
  socket.on('error', onError);
});


