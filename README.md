<img alt="OpenClaw icon" src=".diploi/icon.svg" width="32">

# Starter OpenClaw

Diploi starter for running a self-hosted OpenClaw in Diploi Development Mode with:
- a wrapper server (`server/`) that initializes config, manages the OpenClaw gateway, and exposes control APIs
- a React/Vite control UI (`web/`)

## What This Project Does

On startup, the wrapper:
1. Initializes `/app/openclaw.json` (if missing) via `openclaw onboard`
2. Patches config defaults (gateway token, model provider, channel/plugin defaults)
3. Starts and monitors the OpenClaw gateway on `127.0.0.1:18789`
4. Proxies:
   - `/dashboard` to OpenClaw gateway UI
   - all other app routes to the Vite frontend

## Requirements

- Diploi's Development Environment
- Node.js 22+
- npm
- OpenClaw runtime available as either:
  - `openclaw` on `PATH`, or
  - `/lib/openclaw/dist/index.js` (provided in this repo's Docker images)

## Environment Variables

Common variables used by the wrapper:

- `PORT` (default: `3000`)
- `HOSTNAME` (default: `0.0.0.0`)
- `VITE_HOST` (default: `127.0.0.1`)
- `VITE_PORT` (default: `5173`)
- `OPENCLAW_CONFIG_PATH` (default: `/app/openclaw.json`)
- `OPENCLAW_STATE_DIR` (default: `/app`)
- `OPENCLAW_WORKSPACE_DIR` (default: `/app/workspace`)
- `OPENCLAW_GATEWAY_TOKEN` (optional; generated if missing)
- `DIPLOI_AI_GATEWAY_URL` / `DIPLOI_AI_GATEWAY_TOKEN` (optional model proxy wiring)
- `DIPLOI_LOGIN_SECRET` (required to validate `diploi-jwt-login` cookie)
- `DIPLOI_LOGIN_USERNAME` / `DIPLOI_LOGIN_PASSWORD` (credential login)

## Local Development

Install dependencies:

```bash
npm install
```

Run dev mode (process manager + wrapper API + Vite UI):

```bash
npm run dev
```

This starts:
- `server/processManager.ts`
- `server/index.ts` (Hono wrapper API)
- `web` Vite dev server

## Production Run

```bash
npm run start
```

Note: current `npm run build` is a placeholder in `package.json`. If you need a build artifact, add a real build step first.

## API Endpoints

Wrapper endpoints:

- `GET /healthz`
- `GET /api/dashboard-token`
- `GET /api/gateway/status`
- `POST /api/gateway/start`
- `POST /api/gateway/stop`
- `POST /api/gateway/restart`
- `POST /api/full-reset`
- `POST /api/logout`
- `WS /api/terminal-ws` (browser terminal)

## Project Structure

```text
server/
  index.ts            # wrapper server + proxy
  processManager.ts   # gateway lifecycle manager
  initOpenclaw.ts     # OpenClaw config bootstrap + patching
  api.ts              # API routes
  terminalWs.ts       # PTY websocket bridge
web/
  src/                # React UI
Dockerfile.dev        # full dev image including OpenClaw build
Dockerfile            # production runtime image
diploi.yaml           # Diploi starter metadata
```
