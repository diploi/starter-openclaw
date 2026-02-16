/**
 * WebSocket handler for browser-based terminal (xterm.js).
 * Spawns a PTY and bridges it with the WebSocket connection.
 */
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';
import { gatewaySettings } from './constants.ts';
import { logInfo } from './utils.ts';

const TERMINAL_WS_PATH = '/api/terminal-ws';
const SHELL = process.env.SHELL || 'bash';
const CWD = '/app';

export const TERMINAL_WS_PATHNAME = TERMINAL_WS_PATH;

export function isTerminalWsPath(pathname: string): boolean {
  return pathname === TERMINAL_WS_PATH || pathname.startsWith(`${TERMINAL_WS_PATH}/`);
}

export function handleTerminalUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
): boolean {
  const pathname = (req.url || '/').split('?')[0] || '/';
  if (!isTerminalWsPath(pathname)) return false;

  const wss = new WebSocketServer({ noServer: true });

  wss.on('wsClientError', (err: Error) => {
    logInfo('terminal ws handshake error:', err.message);
  });

  wss.on('error', (err: Error) => {
    logInfo('terminal wss error:', err.message);
  });

  // Must register 'connection' listener BEFORE handleUpgrade - the handshake callback
  // can run synchronously, and we need the listener in place when emit('connection') runs.
  wss.on('connection', (ws) => {
    logInfo('terminal connection established');

    let ptyProcess: pty.IPty | null = null;

    try {
      ptyProcess = pty.spawn(SHELL, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: CWD,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        },
      });

      ptyProcess.onData((data: string) => {
        if (ws.readyState === 1) {
          ws.send(data, (err) => {
            if (err) {
              try {
                ptyProcess?.kill();
              } catch {
                // ignore
              }
            }
          });
        }
      });

      ptyProcess.onExit(({ exitCode }) => {
        if (ws.readyState === 1) {
          ws.close(1000, exitCode === 0 ? 'Session ended' : `Exit code ${exitCode}`);
        }
      });

      ws.on('message', (data: Buffer | string) => {
        const raw = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
        if (!ptyProcess) return;
        // Support resize: JSON message { "resize": { "cols": N, "rows": N } }
        if (raw.startsWith('{')) {
          try {
            const msg = JSON.parse(raw) as { resize?: { cols?: number; rows?: number } };
            if (msg.resize && typeof msg.resize.cols === 'number' && typeof msg.resize.rows === 'number') {
              ptyProcess.resize(msg.resize.cols, msg.resize.rows);
              return;
            }
          } catch {
            // Fall through to write as normal input
          }
        }
        ptyProcess.write(raw);
      });

      ws.on('close', () => {
        try {
          ptyProcess?.kill();
        } catch {
          // ignore
        }
        ptyProcess = null;
      });

      ws.on('error', () => {
        try {
          ptyProcess?.kill();
        } catch {
          // ignore
        }
      });
    } catch (err) {
      const msg = `Failed to spawn shell: ${String(err)}`;
      if (ws.readyState === 0 || ws.readyState === 1) {
        ws.send(`\r\n${msg}\r\n`);
        ws.close(1011, msg);
      }
    }
  });

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });

  return true;
}
