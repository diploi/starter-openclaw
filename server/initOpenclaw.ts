import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logInfo } from './utils.ts';

import { gatewaySettings } from './constants.ts';
import type { OpenClawConfig } from './openclawjson.type.ts';

const { configPath, statePath, workspacePath, openclawScriptPath, gatewayHost, gatewayPort } = gatewaySettings;

const loadConfig = async (): Promise<OpenClawConfig | null> => {
  try {
    const raw = await readFile(configPath, 'utf8');
    return JSON.parse(raw || '{}') as OpenClawConfig;
  } catch {
    return null;
  }
};

function execCommand(cmd: string, args: string[]) {
  return new Promise<{ code: number; output: string }>((resolve) => {
    const proc = childProcess.spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OPENCLAW_CONFIG_PATH: configPath,
        OPENCLAW_STATE_DIR: statePath,
        OPENCLAW_WORKSPACE_DIR: workspacePath,
      },
    });

    let out = '';
    proc.stdout?.on('data', (d) => (out += d.toString('utf8')));
    proc.stderr?.on('data', (d) => (out += d.toString('utf8')));

    proc.on('error', (err) => {
      out += `\n[spawn error] ${String(err)}\n`;
      resolve({ code: 127, output: out });
    });

    proc.on('close', (code) => resolve({ code: code ?? 0, output: out }));
  });
}

async function runOnboard(): Promise<void> {
  fs.mkdirSync(statePath, { recursive: true });
  fs.mkdirSync(workspacePath, { recursive: true });

  // This generates a baseline config file that we patch
  const args = [
    'onboard',
    '--non-interactive',
    '--accept-risk',
    '--json',
    '--no-install-daemon',
    '--skip-health',
    '--workspace',
    workspacePath,
    '--gateway-bind',
    'loopback',
    '--gateway-port',
    gatewayPort.toString(),
    '--flow',
    'manual',
  ];

  // Try global launcher first (if present), then fall back to running the built entry.
  let r = await execCommand('openclaw', args);
  if (r.code === 127) r = await execCommand('node', [openclawScriptPath, ...args]);
  if (r.code !== 0) throw new Error(`openclaw onboard failed (exit ${r.code}):\n${r.output}`);

  try {
    const gitDir = path.join(workspacePath, '.git');
    if (fs.existsSync(gitDir)) {
      fs.rmSync(gitDir, { recursive: true });
    }
  } catch {
    // best-effort
  }
}

async function patchConfig(): Promise<void> {
  const raw = await readFile(configPath, 'utf8');
  const cfg = JSON.parse(raw || '{}') as OpenClawConfig;

  // Use token from env or 
  const envToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  const gatewayToken = envToken && envToken.length > 0 ? envToken : crypto.randomBytes(32).toString('hex');

  // Ensure base objects exist
  cfg.agents ||= {};
  cfg.agents.defaults ||= {};
  cfg.models ||= {};
  cfg.models.providers ||= {};
  cfg.gateway ||= {};
  cfg.gateway.controlUi ||= {};
  cfg.meta ||= {};

  // Agents defaults
  cfg.agents.defaults.workspace = workspacePath;
  cfg.agents.defaults.maxConcurrent = 4;
  cfg.agents.defaults.subagents ||= {};
  cfg.agents.defaults.subagents.maxConcurrent = 8;
  cfg.agents.defaults.model ||= {};
  cfg.agents.defaults.model.primary = 'custom-proxy/gpt-4.1-nano';
  cfg.agents.defaults.models ||= {};
  cfg.agents.defaults.models['custom-proxy/gpt-4.1-nano'] ||= {};

  // Model provider (only if env is present; otherwise leave whatever onboard created)
  const diploiBase = process.env.DIPLOI_AI_GATEWAY_URL?.trim();
  const diploiToken = process.env.DIPLOI_AI_GATEWAY_TOKEN?.trim();
  if (diploiBase && diploiToken) {
    cfg.models.providers['custom-proxy'] = {
      baseUrl: `${diploiBase}/v1`,
      apiKey: diploiToken,
      api: 'openai-completions',
      models: [
        {
          id: 'gpt-4.1-nano',
          name: 'GPT-4.1 Nano',
          reasoning: false,
          input: ['text'],
          contextWindow: 200000,
          maxTokens: 8192,
        },
      ],
    };
  }

  // Gateway defaults for wrapper/proxy setup
  cfg.gateway.mode = 'local';
  cfg.gateway.bind = 'loopback';
  cfg.gateway.port = gatewayPort;
  cfg.gateway.auth ||= {};
  cfg.gateway.auth.mode = 'token';
  cfg.gateway.auth.token = gatewayToken;
  cfg.gateway.trustedProxies = [gatewayHost];
  cfg.gateway.controlUi.allowedOrigins = [process.env.APP_ENDPOINT ?? ''];
  cfg.gateway.controlUi.basePath = '/dashboard';
  cfg.gateway.controlUi.allowInsecureAuth = true;

  // Touch meta timestamp (best-effort)
  cfg.meta.lastTouchedAt = new Date().toISOString();
  const discordToken = process.env.DISCORD_BOT_TOKEN?.trim();

  // Enable default channel plugins
  cfg.plugins ||= {};
  cfg.plugins.entries ||= {};
  const discordPlugin = (cfg.plugins.entries.discord ||= {});
  discordPlugin.enabled = true;
  const whatsappPlugin = (cfg.plugins.entries.whatsapp ||= {});
  whatsappPlugin.enabled = true;
  const telegramPlugin = (cfg.plugins.entries.telegram ||= {});
  telegramPlugin.enabled = true;
  const slackPlugin = (cfg.plugins.entries.slack ||= {});
  slackPlugin.enabled = true;
  const ircPlugin = (cfg.plugins.entries.irc ||= {});
  ircPlugin.enabled = true;
  const signalPlugin = (cfg.plugins.entries.signal ||= {});
  signalPlugin.enabled = true;
  const googlechatPlugin = (cfg.plugins.entries.googlechat ||= {});
  googlechatPlugin.enabled = true;
  const bluebubblesPlugin = (cfg.plugins.entries.bluebubbles ||= {});
  bluebubblesPlugin.enabled = true;

  // Default Discord channel config
  cfg.channels ||= {};
  const discordChannelConfig = (cfg.channels.discord ||= {});
  discordChannelConfig.enabled = true;
  discordChannelConfig.groupPolicy = "allowlist";

  if (discordToken) {
    discordChannelConfig.token = discordToken;
  }

  // Default Whatsapp channel config
  const whatsappChannelConfig = (cfg.channels.whatsapp ||= {});
  whatsappChannelConfig.dmPolicy = "allowlist";
  whatsappChannelConfig.selfChatMode = true;


  // Default Telegram channel config
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const telegramChannelConfig = (cfg.channels.telegram ||= {});
  telegramChannelConfig.enabled = true; // Disabled by default
  telegramChannelConfig.dmPolicy = "pairing";
  telegramChannelConfig.groups ||= {};

  if (telegramToken) {
    telegramChannelConfig.enabled = true;
    telegramChannelConfig.botToken = telegramToken;
  }

  await writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, { encoding: 'utf8' });
}

export const initOpenclaw = async () => {

  let config = await loadConfig();
  if (config) {
    logInfo(`Config exists at ${configPath}`);

    const diploiToken = process.env.DIPLOI_AI_GATEWAY_TOKEN?.trim();
    if (diploiToken && config.models?.providers?.["custom-proxy"]) {
      config.models.providers["custom-proxy"].apiKey = diploiToken;
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8' });
    }

    return config;
  }

  try {
    logInfo(`Running OpenClaw configure`);
    await runOnboard();
    logInfo(`Patching OpenClaw config`);
    await patchConfig();
    logInfo(`Initialized OpenClaw config at ${configPath}`);
    return await loadConfig() as OpenClawConfig;
  } catch (err: any) {
    logInfo(`Failed to initialize OpenClaw`, err);
    throw err;
  }
};
