import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { db, LEGACY_BOARD_ID, transaction } from './Database';
import { BotSettings, PinboardBoard, PinboardEmoji, SettingsSection } from '../shared/types';

function splitList(value: string | undefined): string[] {
  return (value || '').split(',').map(v => v.trim()).filter(Boolean);
}

// Defaults for a fresh install. Values from an existing .env are picked up once,
// when the settings are created, so older setups keep working after the update.
function createDefaults(): BotSettings {
  const env = process.env;

  return {
    features: {
      music: env.MUSIC_ENABLED ? env.MUSIC_ENABLED === 'true' : true,
      pinboard: !!env.PINBOARD_GUILD_ID,
      reminders: true,
      birthdays: true,
      polls: true,
      musicHistory: true
    },
    backups: {
      enabled: true,
      hour: 4,
      keep: 7
    },
    alerts: {
      enabled: false,
      lavalinkDown: true,
      errors: true,
      disk: true,
      diskPercent: 90,
      temperature: true,
      temperatureC: 75,
      updates: true,
      backups: true
    },
    birthdays: {
      hour: 9,
      message: '🎂 Happy birthday {user}! 🎉',
      channels: {}
    },
    music: {
      autoDeleteResponses: true,
      autoDeleteSeconds: 30,
      leaveWhenAlone: true
    },
    lavalink: {
      name: 'Lavalink',
      host: env.LAVALINK_HOST || 'localhost',
      port: parseInt(env.LAVALINK_PORT || '2333', 10),
      secure: false
    },
    pinboard: {
      boards: env.PINBOARD_GUILD_ID
        ? [legacyBoard({
          guildId: env.PINBOARD_GUILD_ID,
          channelId: env.PINBOARD_CHANNEL_ID || '',
          emojis: splitList(env.PINBOARD_EMOJIS || env.PINBOARD_EMOJI),
          emojiDisplays: splitList(env.PINBOARD_EMOJI_DISPLAYS || env.PINBOARD_EMOJI_DISPLAY),
          threshold: parseInt(env.PINBOARD_THRESHOLD || '5', 10)
        })]
        : []
    },
    pinboardStats: {
      posts: {}
    },
    intents: {
      members: false
    },
    presence: {
      status: 'online',
      rotate: true,
      intervalSeconds: 30,
      activities: [
        { type: 'Listening', text: '{users} users' },
        { type: 'Playing', text: 'music in {servers} servers', musicOnly: true },
        { type: 'Watching', text: '{queues} active queues', musicOnly: true },
        { type: 'Playing', text: '/play to start jamming', musicOnly: true },
        { type: 'Listening', text: 'your favorite songs 🎵', musicOnly: true }
      ]
    },
    maintenance: {
      enabled: false,
      message: '🛠️ Luko is currently in maintenance mode. Please try again later.'
    },
    commands: {},
    commandSync: {
      enabled: true,
      target: 'global'
    },
    panel: {
      enabled: true,
      host: '0.0.0.0',
      port: 5000,
      publicUrl: '',
      adminIds: []
    }
  };
}

interface LegacyPinboard {
  guildId: string;
  channelId: string;
  emojis: string[];
  emojiDisplays: string[];
  threshold: number;
}

// Before multiple pinboards existed there was exactly one, configured with these fields.
function legacyBoard(old: LegacyPinboard): PinboardBoard {
  return {
    id: LEGACY_BOARD_ID,
    name: 'Pinboard',
    enabled: true,
    guildId: old.guildId,
    channelId: old.channelId,
    threshold: old.threshold || 5,
    emojis: (old.emojis ?? []).map((emoji, i): PinboardEmoji => ({ emoji, display: old.emojiDisplays?.[i] ?? '', threshold: null })),
    ignoredChannelIds: [],
    ignoreSelfReactions: false,
    ignoreBotMessages: false,
    ignorePinboardPosts: false
  };
}

export function normalizeBoard(board: Partial<PinboardBoard>): PinboardBoard {
  return {
    id: board.id || Math.random().toString(36).slice(2, 10),
    name: board.name || 'Pinboard',
    enabled: board.enabled ?? true,
    guildId: board.guildId ?? '',
    channelId: board.channelId ?? '',
    threshold: board.threshold || 5,
    emojis: (board.emojis ?? []).map(e => ({ emoji: e.emoji, display: e.display ?? '', threshold: e.threshold ?? null })),
    ignoredChannelIds: board.ignoredChannelIds ?? [],
    ignoreSelfReactions: board.ignoreSelfReactions ?? false,
    ignoreBotMessages: board.ignoreBotMessages ?? false,
    ignorePinboardPosts: board.ignorePinboardPosts ?? false
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Fills in keys missing from `loaded` with defaults, so new settings appear
// automatically after an update without overwriting what the user changed.
function mergeDefaults<T>(defaults: T, loaded: unknown): T {
  if (!isPlainObject(defaults) || !isPlainObject(loaded)) {
    return (loaded === undefined ? defaults : loaded) as T;
  }

  const result: Record<string, unknown> = { ...loaded };
  for (const [key, value] of Object.entries(defaults)) {
    result[key] = key in loaded ? mergeDefaults(value, loaded[key]) : value;
  }
  return result as T;
}

// Upgrades settings saved by older versions to the current shape.
function upgrade(loaded: Record<string, unknown>): Record<string, unknown> {
  const pinboard = loaded.pinboard;
  if (isPlainObject(pinboard) && 'guildId' in pinboard && !('boards' in pinboard)) {
    const old = pinboard as unknown as LegacyPinboard;
    loaded.pinboard = { boards: old.guildId ? [legacyBoard(old)] : [] };
  }
  return loaded;
}

const statements = {
  all: db.prepare('SELECT section, value FROM settings'),
  upsert: db.prepare('INSERT INTO settings (section, value) VALUES (?, ?) ON CONFLICT (section) DO UPDATE SET value = excluded.value')
};

const LEGACY_FILE = path.join(process.cwd(), 'data', 'settings.json');

// Bot settings, stored per section in the settings table of data/luko.db.
export class SettingsManager extends EventEmitter {
  private settings: BotSettings;

  constructor() {
    super();
    this.settings = this.load();
  }

  private readStored(): Record<string, unknown> | null {
    const rows = statements.all.all() as Array<{ section: string; value: string }>;
    if (rows.length > 0) {
      return Object.fromEntries(rows.map(row => [row.section, JSON.parse(row.value)]));
    }

    // One-time import of data/settings.json from the previous version.
    if (fs.existsSync(LEGACY_FILE)) {
      try {
        const imported = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf-8'));
        fs.renameSync(LEGACY_FILE, `${LEGACY_FILE}.migrated`);
        console.log('⚙️ Imported data/settings.json into the database (kept as settings.json.migrated).');
        return imported;
      } catch (error) {
        console.error('❌ Could not import data/settings.json, using defaults:', error);
      }
    }

    return null;
  }

  private load(): BotSettings {
    const defaults = createDefaults();
    let stored: Record<string, unknown> | null = null;

    try {
      stored = this.readStored();
    } catch (error) {
      console.error('❌ Failed to load settings, using defaults:', error);
    }

    if (!stored) {
      console.log('⚙️ Created settings from defaults and your .env values.');
    }

    const settings = mergeDefaults(defaults, upgrade(stored ?? {}));
    settings.pinboard.boards = settings.pinboard.boards.map(normalizeBoard);
    this.writeAll(settings);
    return settings;
  }

  private writeAll(settings: BotSettings): void {
    transaction(db, () => {
      for (const [section, value] of Object.entries(settings)) {
        statements.upsert.run(section, JSON.stringify(value));
      }
    });
  }

  get(): BotSettings {
    return this.settings;
  }

  update<K extends SettingsSection>(section: K, value: BotSettings[K]): BotSettings {
    statements.upsert.run(section, JSON.stringify(value));
    this.settings = { ...this.settings, [section]: value };
    this.emit('change', section, this.settings);
    return this.settings;
  }
}
