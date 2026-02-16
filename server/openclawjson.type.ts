// Helper to make it easier to work with the OpenClaw config file.
// NOTE! This could change anytime, so be careful when using this type.
// Taken from: 
// https://github.com/openclaw/openclaw/blob/744892de723440d950138602951348c6cfda3f12/src/config/types.openclaw.ts

export type OpenClawConfig = {
  meta?: {
    lastTouchedVersion?: string;
    lastTouchedAt?: string;
  };
  auth?: any; //AuthConfig;
  env?: {
    shellEnv?: {
      enabled?: boolean;
      timeoutMs?: number;
    };
    /** Inline env vars to apply when not already present in the process env. */
    vars?: Record<string, string>;
    /** Sugar: allow env vars directly under env (string values only). */
    [key: string]:
    | string
    | Record<string, string>
    | { enabled?: boolean; timeoutMs?: number }
    | undefined;
  };
  wizard?: {
    lastRunAt?: string;
    lastRunVersion?: string;
    lastRunCommit?: string;
    lastRunCommand?: string;
    lastRunMode?: "local" | "remote";
  };
  diagnostics?: any; //DiagnosticsConfig;
  logging?: any; //LoggingConfig;
  update?: {
    /** Update channel for git + npm installs ("stable", "beta", or "dev"). */
    channel?: "stable" | "beta" | "dev";
    /** Check for updates on gateway start (npm installs only). */
    checkOnStart?: boolean;
  };
  browser?: any; //BrowserConfig;
  ui?: {
    /** Accent color for OpenClaw UI chrome (hex). */
    seamColor?: string;
    assistant?: {
      /** Assistant display name for UI surfaces. */
      name?: string;
      /** Assistant avatar (emoji, short text, or image URL/data URI). */
      avatar?: string;
    };
  };
  skills?: any; //SkillsConfig;
  plugins?: any; //PluginsConfig;
  models?: any; //ModelsConfig;
  nodeHost?: any; //NodeHostConfig;
  agents?: any; //AgentsConfig;
  tools?: any; //ToolsConfig;
  bindings?: any; //AgentBinding[];
  broadcast?: any; //BroadcastConfig;
  audio?: any; //AudioConfig;
  messages?: any; //MessagesConfig;
  commands?: any; //CommandsConfig;
  approvals?: any; //ApprovalsConfig;
  session?: any; //SessionConfig;
  web?: any; //WebConfig;
  channels?: ChannelsConfig;
  cron?: any; //CronConfig;
  hooks?: any; //HooksConfig;
  discovery?: any; //DiscoveryConfig;
  canvasHost?: any; //CanvasHostConfig;
  talk?: any; //TalkConfig;
  gateway?: GatewayConfig;
  memory?: any; //MemoryConfig;
};

export type GatewayConfig = {
  port?: number;
  mode?: "local" | "remote";
  bind?: any; //GatewayBindMode;
  /** Custom IP address for bind="custom" mode. Fallback: 0.0.0.0. */
  customBindHost?: string;
  controlUi?: GatewayControlUiConfig;
  auth?: any; //GatewayAuthConfig;
  tailscale?: any; //GatewayTailscaleConfig;
  remote?: any; //GatewayRemoteConfig;
  reload?: any; //GatewayReloadConfig;
  tls?: any; //GatewayTlsConfig;
  http?: any; //GatewayHttpConfig;
  nodes?: any; //GatewayNodesConfig;
  trustedProxies?: string[];
};

export type GatewayAuthConfig = {
  mode?: "token" | "password";
  token?: string;
  password?: string;
  allowTailscale?: boolean;
};

export type GatewayControlUiConfig = {
  enabled?: boolean;
  basePath?: string;
  root?: string;
  allowedOrigins?: string[];  /** Allow token-only auth over insecure HTTP (default: false). */
  allowInsecureAuth?: boolean;
  dangerouslyDisableDeviceAuth?: boolean;
};

export type ChannelHeartbeatVisibilityConfig = {
  showOk?: boolean;
  showAlerts?: boolean;
  useIndicator?: boolean;
};

export type ChannelDefaultsConfig = {
  groupPolicy?: 'open' | 'allowlist' | 'disabled' | string;
  heartbeat?: ChannelHeartbeatVisibilityConfig;
  [key: string]: unknown;
};

export type DiscordDmConfig = {
  enabled?: boolean;
  policy?: 'pairing' | 'open' | 'allowlist' | 'disabled' | string;
  allowFrom?: Array<string | number>;
  groupEnabled?: boolean;
  groupChannels?: Array<string | number>;
};

export type DiscordGuildChannelConfig = {
  allow?: boolean;
  requireMention?: boolean;
  enabled?: boolean;
  users?: Array<string | number>;
  skills?: string[];
  systemPrompt?: string;
  includeThreadStarter?: boolean;
  tools?: Record<string, unknown>;
  toolsBySender?: Record<string, unknown>;
};

export type DiscordReactionNotificationMode = 'off' | 'own' | 'all' | 'allowlist';

export type DiscordGuildEntry = {
  slug?: string;
  requireMention?: boolean;
  tools?: Record<string, unknown>;
  toolsBySender?: Record<string, unknown>;
  reactionNotifications?: DiscordReactionNotificationMode;
  users?: Array<string | number>;
  channels?: Record<string, DiscordGuildChannelConfig>;
};

export type DiscordAccountConfig = {
  name?: string;
  capabilities?: string[];
  enabled?: boolean;
  token?: string;
  allowBots?: boolean;
  groupPolicy?: 'open' | 'allowlist' | 'disabled' | string;
  textChunkLimit?: number;
  chunkMode?: 'length' | 'newline';
  blockStreaming?: boolean;
  blockStreamingCoalesce?: Record<string, unknown>;
  maxLinesPerMessage?: number;
  mediaMaxMb?: number;
  historyLimit?: number;
  dmHistoryLimit?: number;
  dms?: Record<string, DiscordDmConfig>;
  retry?: Record<string, unknown>;
  actions?: Record<string, boolean>;
  replyToMode?: 'off' | 'first' | 'all' | string;
  dm?: DiscordDmConfig;
  guilds?: Record<string, DiscordGuildEntry>;
  heartbeat?: ChannelHeartbeatVisibilityConfig;
  execApprovals?: Record<string, unknown>;
  intents?: Record<string, boolean>;
  pluralkit?: Record<string, unknown>;
  responsePrefix?: string;
  markdown?: Record<string, unknown>;
  commands?: Record<string, unknown>;
  configWrites?: boolean;
};

export type DiscordConfig = {
  accounts?: Record<string, DiscordAccountConfig>;
} & DiscordAccountConfig;

export type GenericChannelConfig = {
  enabled?: boolean;
  [key: string]: unknown;
};

export type ChannelsConfig = {
  defaults?: ChannelDefaultsConfig;
  whatsapp?: GenericChannelConfig;
  telegram?: GenericChannelConfig;
  discord?: DiscordConfig;
  googlechat?: GenericChannelConfig;
  slack?: GenericChannelConfig;
  signal?: GenericChannelConfig;
  imessage?: GenericChannelConfig;
  msteams?: GenericChannelConfig;
  [key: string]: unknown;
};