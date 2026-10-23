// Types shared between the bot (backend) and the admin panel (frontend).
// This file must stay free of runtime imports so the panel can import it too.

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible';
export type ActivityKind = 'Playing' | 'Listening' | 'Watching' | 'Competing' | 'Custom';

export interface PresenceActivity {
  type: ActivityKind;
  text: string;
  musicOnly?: boolean;
}

export interface CommandSettings {
  enabled: boolean;
  disabledGuilds: string[];
}

export type DeployTarget = 'guild' | 'global' | 'both';

export interface PinboardEmoji {
  // Emoji ID for custom emojis, or the emoji itself (⭐) for Unicode emojis.
  emoji: string;
  // How the bot shows the emoji in the pinboard post ("<:name:id>"); empty = same as the reaction.
  display: string;
  // Reactions needed for this emoji; null = the board's default.
  threshold: number | null;
}

export interface PinboardBoard {
  id: string;
  name: string;
  enabled: boolean;
  guildId: string;
  channelId: string;
  threshold: number;
  // Empty = every emoji counts, using the default threshold.
  emojis: PinboardEmoji[];
  ignoredChannelIds: string[];
  ignoreSelfReactions: boolean;
  ignoreBotMessages: boolean;
}

export interface BotSettings {
  features: {
    music: boolean;
    pinboard: boolean;
    reminders: boolean;
  };
  music: {
    autoDeleteResponses: boolean;
    autoDeleteSeconds: number;
    leaveWhenAlone: boolean;
  };
  lavalink: {
    name: string;
    host: string;
    port: number;
    secure: boolean;
  };
  pinboard: {
    boards: PinboardBoard[];
  };
  intents: {
    // Discord's privileged "Server Members" intent. Needs to be switched on in the
    // Developer Portal too; the bot cannot log in otherwise.
    members: boolean;
  };
  presence: {
    status: PresenceStatus;
    rotate: boolean;
    intervalSeconds: number;
    activities: PresenceActivity[];
  };
  maintenance: {
    enabled: boolean;
    message: string;
  };
  commands: Record<string, CommandSettings>;
  commandSync: {
    // Re-deploy slash commands automatically when one is enabled or disabled,
    // so disabled commands disappear from Discord's command list.
    enabled: boolean;
    target: DeployTarget;
  };
  panel: {
    enabled: boolean;
    host: string;
    port: number;
    publicUrl: string;
    adminIds: string[];
  };
}

export type SettingsSection = keyof BotSettings;

export type PanelRole = 'owner' | 'admin';

export interface PanelUser {
  id: string;
  username: string;
  avatarUrl: string | null;
  role: PanelRole;
  method: 'discord' | 'password';
}

export interface AuthConfig {
  discord: boolean;
  password: boolean;
  mode: 'local' | 'domain';
  publicUrl: string;
  lanUrls: string[];
  redirectUri: string;
  botName: string;
  botAvatarUrl: string | null;
}

export interface LavalinkNodeInfo {
  name: string;
  connected: boolean;
  players: number;
  playingPlayers: number;
  uptime: number;
  cpuLoad: number;
  memoryUsed: number;
  memoryAllocated: number;
}

export interface Overview {
  bot: {
    ready: boolean;
    tag: string | null;
    id: string | null;
    avatarUrl: string | null;
    ping: number;
    uptime: number;
    startedAt: number;
  };
  counts: {
    guilds: number;
    users: number;
    commands: number;
    activeQueues: number;
    reminders: number;
    pinboardEntries: number;
    commandsToday: number;
  };
  process: {
    memoryRss: number;
    heapUsed: number;
    heapTotal: number;
    cpuPercent: number;
  };
  features: BotSettings['features'];
  maintenance: boolean;
  musicAvailable: boolean;
  musicRestartRequired: boolean;
  lavalink: LavalinkNodeInfo[];
  recentErrors: LogEntry[];
}

export interface MetricSample {
  t: number;
  memoryRss: number;
  heapUsed: number;
  ping: number;
  guilds: number;
  users: number;
  queues: number;
  cpuPercent: number;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  t: number;
  level: LogLevel;
  message: string;
}

export interface AuditEntry {
  t: number;
  userId: string;
  username: string;
  action: string;
  details?: string;
}

export interface CommandUsageEntry {
  t: number;
  command: string;
  userId: string;
  userTag: string;
  guildId: string | null;
  guildName: string | null;
  success: boolean;
}

export interface CommandInfo {
  name: string;
  description: string;
  category: 'music' | 'utility' | 'dev';
  private: boolean;
  options: number;
  enabled: boolean;
  disabledGuilds: string[];
  uses: number;
  lastUsed: number | null;
}

export interface TrackInfo {
  title: string;
  author: string;
  uri: string;
  duration: number;
  artworkUrl: string | null;
  requestedBy: string;
  isStream: boolean;
}

export interface MusicQueueSummary {
  guildId: string;
  guildName: string;
  guildIconUrl: string | null;
  current: TrackInfo | null;
  paused: boolean;
  queueLength: number;
  voiceChannelName: string | null;
  listeners: number;
}

export type LoopMode = 'off' | 'track' | 'queue';

export interface MusicQueueDetail extends MusicQueueSummary {
  position: number;
  volume: number;
  loop: LoopMode;
  autoplay: boolean;
  filter: string;
  tracks: TrackInfo[];
  history: TrackInfo[];
  textChannelId: string;
}

export interface SearchResult {
  title: string;
  author: string;
  uri: string;
  duration: number;
  artworkUrl: string | null;
}

export interface FilterPresetInfo {
  id: string;
  label: string;
}

export interface ChannelInfo {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'announcement' | 'stage' | 'forum' | 'other';
  parentName: string | null;
  position: number;
  sendable: boolean;
  members?: number;
}

export interface RoleInfo {
  id: string;
  name: string;
  color: string;
  members: number;
  position: number;
}

export interface EmojiInfo {
  id: string;
  name: string;
  animated: boolean;
  url: string;
  display: string;
}

export interface GuildSummary {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number;
  ownerId: string;
  joinedAt: number | null;
  hasQueue: boolean;
}

export interface GuildDetail extends GuildSummary {
  createdAt: number;
  description: string | null;
  boostTier: number;
  boosts: number;
  botNickname: string | null;
  channels: ChannelInfo[];
  roles: RoleInfo[];
  emojis: EmojiInfo[];
  botPermissions: string[];
  disabledCommands: string[];
}

export interface PinboardEntry {
  boardId: string;
  originalMessageId: string;
  pinboardMessageId: string;
  channelId?: string;
  authorName?: string;
  authorAvatarUrl?: string;
  excerpt?: string;
  imageUrl?: string;
  count?: number;
  pinnedAt?: number;
}

export interface ReminderInfo {
  id: string;
  userId: string;
  userTag: string | null;
  channelId: string;
  channelName: string | null;
  content: string;
  dueAt: number;
  createdAt: number;
}

export interface EmbedPayload {
  title?: string;
  description?: string;
  url?: string;
  color?: string;
  authorName?: string;
  authorIconUrl?: string;
  footerText?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  timestamp?: boolean;
  fields?: { name: string; value: string; inline: boolean }[];
}

export interface SendMessagePayload {
  channelId: string;
  content?: string;
  embed?: EmbedPayload;
  allowMentions?: boolean;
}

export interface SystemInfo {
  botVersion: string;
  nodeVersion: string;
  discordJsVersion: string;
  platform: string;
  hostname: string;
  pid: number;
  osUptime: number;
  totalMemory: number;
  freeMemory: number;
  cpuCount: number;
  pm2: boolean;
  startedAt: number;
  panelMode: 'local' | 'domain';
  panelPort: number;
  databasePath: string;
}

export interface MemberInfo {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  bot: boolean;
}

export interface MemberListResponse {
  members: MemberInfo[];
  // False when the full member list is unavailable (Server Members intent off).
  complete: boolean;
}

export interface PinboardBoardStatus extends PinboardBoard {
  botInGuild: boolean;
  guildName: string | null;
  channelName: string | null;
  guildEmojis: EmojiInfo[];
}

export interface LavalinkNodeDetail {
  name: string;
  connected: boolean;
  state: string;
  stats: {
    players: number;
    playingPlayers: number;
    uptime: number;
    cpu: { cores: number; systemLoad: number; lavalinkLoad: number };
    memory: { used: number; free: number; allocated: number; reservable: number };
    frameStats: { sent: number; nulled: number; deficit: number } | null;
  } | null;
  info: {
    version: string;
    buildTime: number;
    jvm: string;
    lavaplayer: string;
    sourceManagers: string[];
    filters: string[];
    plugins: { name: string; version: string }[];
  } | null;
}

export interface LavalinkProcessInfo {
  name: string;
  status: string;
  pid: number | null;
  uptime: number | null;
  restarts: number;
  memory: number;
  cpu: number;
}

export interface LavalinkLocalStatus {
  installed: boolean;
  dir: string;
  version: string | null;
  pm2Available: boolean;
  process: LavalinkProcessInfo | null;
  updateRunning: boolean;
}

export interface LavalinkOverview {
  musicEnabled: boolean;
  restartRequired: boolean;
  connection: BotSettings['lavalink'];
  baseUrl: string;
  nodes: LavalinkNodeDetail[];
  local: LavalinkLocalStatus;
}

export type ResamplingQuality = 'LOW' | 'MEDIUM' | 'HIGH';

export const LAVALINK_SOURCES = ['bandcamp', 'soundcloud', 'twitch', 'vimeo', 'nico', 'http', 'local'] as const;
export type LavalinkSource = typeof LAVALINK_SOURCES[number];

export interface LavalinkConfig {
  port: number;
  memoryMB: number;
  sources: Record<LavalinkSource, boolean>;
  youtube: {
    enabled: boolean;
    clients: string[];
    oauthEnabled: boolean;
    hasRefreshToken: boolean;
    remoteCipherUrl: string;
    remoteCipherPassword: string;
  };
  bufferDurationMs: number;
  opusEncodingQuality: number;
  resamplingQuality: ResamplingQuality;
  youtubePlaylistLoadLimit: number;
  trackStuckThresholdMs: number;
}

export interface YoutubeAuthStatus {
  oauthEnabled: boolean;
  deviceCode: string | null;
  verificationUrl: string | null;
  codeShownAt: number | null;
  tokenStored: boolean;
  tokenActive: boolean | null;
}

export interface ClientTestResult {
  client: string;
  ok: boolean;
  status: number;
  message: string;
}
