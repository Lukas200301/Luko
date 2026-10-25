import { reconnectLavalink } from '../../utils/LavalinkConnection';
import { RouteRegistrar, PanelError, audit, bodyOf, bool, currentUser, isSnowflake, num, str, strList } from '../context';
import { ActivityKind, BotSettings, DeployTarget, PinboardBoard, PinboardEmoji, PresenceStatus, SettingsSection } from '../../shared/types';

const STATUSES: PresenceStatus[] = ['online', 'idle', 'dnd', 'invisible'];
const ACTIVITY_KINDS: ActivityKind[] = ['Playing', 'Listening', 'Watching', 'Competing', 'Custom'];

// Sections whose changes only take effect after a restart.
const RESTART_SECTIONS: SettingsSection[] = ['panel', 'intents'];

type Sanitizer<K extends SettingsSection> = (input: Record<string, unknown>, current: BotSettings[K]) => BotSettings[K];

const sanitizers: { [K in SettingsSection]?: Sanitizer<K> } = {
  features: (input, current) => ({
    music: bool(input.music, current.music),
    pinboard: bool(input.pinboard, current.pinboard),
    reminders: bool(input.reminders, current.reminders),
    birthdays: bool(input.birthdays, current.birthdays),
    polls: bool(input.polls, current.polls),
    musicHistory: bool(input.musicHistory, current.musicHistory)
  }),

  backups: (input, current) => ({
    enabled: bool(input.enabled, current.enabled),
    hour: Math.round(num(input.hour, current.hour, 0, 23)),
    keep: Math.round(num(input.keep, current.keep, 1, 90))
  }),

  alerts: (input, current) => ({
    enabled: bool(input.enabled, current.enabled),
    lavalinkDown: bool(input.lavalinkDown, current.lavalinkDown),
    errors: bool(input.errors, current.errors),
    disk: bool(input.disk, current.disk),
    diskPercent: Math.round(num(input.diskPercent, current.diskPercent, 50, 99)),
    temperature: bool(input.temperature, current.temperature),
    temperatureC: Math.round(num(input.temperatureC, current.temperatureC, 40, 100)),
    updates: bool(input.updates, current.updates),
    backups: bool(input.backups, current.backups)
  }),

  birthdays: (input, current) => {
    const channels: Record<string, string> = {};
    if (typeof input.channels === 'object' && input.channels !== null) {
      for (const [guildId, channelId] of Object.entries(input.channels as Record<string, unknown>).slice(0, 200)) {
        const channel = str(channelId, 30);
        if (isSnowflake(guildId) && isSnowflake(channel)) channels[guildId] = channel;
      }
    }
    return {
      hour: Math.round(num(input.hour, current.hour, 0, 23)),
      message: str(input.message, 500) || current.message,
      channels: typeof input.channels === 'object' && input.channels !== null ? channels : current.channels
    };
  },

  music: (input, current) => ({
    autoDeleteResponses: bool(input.autoDeleteResponses, current.autoDeleteResponses),
    autoDeleteSeconds: Math.round(num(input.autoDeleteSeconds, current.autoDeleteSeconds, 5, 600)),
    leaveWhenAlone: bool(input.leaveWhenAlone, current.leaveWhenAlone)
  }),

  lavalink: (input, current) => ({
    name: str(input.name, 50) || current.name,
    host: str(input.host, 255) || current.host,
    port: Math.round(num(input.port, current.port, 1, 65535)),
    secure: bool(input.secure, current.secure)
  }),

  pinboard: (input, current) => {
    if (!Array.isArray(input.boards)) return current;

    const usedIds = new Set<string>();
    const boards = input.boards.slice(0, 50).flatMap((raw): PinboardBoard[] => {
      if (typeof raw !== 'object' || raw === null) return [];
      const board = raw as Record<string, unknown>;

      let id = str(board.id, 40);
      if (!/^[A-Za-z0-9_-]+$/.test(id) || usedIds.has(id)) id = Math.random().toString(36).slice(2, 10);
      usedIds.add(id);

      const snowflakeOrEmpty = (value: unknown) => {
        const v = str(value, 30);
        return isSnowflake(v) ? v : '';
      };

      const emojis = Array.isArray(board.emojis)
        ? board.emojis.slice(0, 25).flatMap((rawEmoji): PinboardEmoji[] => {
          if (typeof rawEmoji !== 'object' || rawEmoji === null) return [];
          const e = rawEmoji as Record<string, unknown>;
          const emoji = str(e.emoji, 100);
          const threshold = e.threshold === null || e.threshold === '' || e.threshold === undefined
            ? null
            : Math.round(num(e.threshold, 5, 1, 1000));
          return emoji ? [{ emoji, display: str(e.display, 120), threshold }] : [];
        })
        : [];

      return [{
        id,
        name: str(board.name, 50) || 'Pinboard',
        enabled: bool(board.enabled, true),
        guildId: snowflakeOrEmpty(board.guildId),
        channelId: snowflakeOrEmpty(board.channelId),
        threshold: Math.round(num(board.threshold, 5, 1, 1000)),
        emojis,
        ignoredChannelIds: strList(board.ignoredChannelIds, 100).filter(isSnowflake),
        ignoreSelfReactions: bool(board.ignoreSelfReactions, false),
        ignoreBotMessages: bool(board.ignoreBotMessages, false)
      }];
    });

    return { boards };
  },

  intents: (input, current) => ({
    members: bool(input.members, current.members)
  }),

  presence: (input, current) => ({
    status: STATUSES.includes(input.status as PresenceStatus) ? input.status as PresenceStatus : current.status,
    rotate: bool(input.rotate, current.rotate),
    intervalSeconds: Math.round(num(input.intervalSeconds, current.intervalSeconds, 15, 3600)),
    activities: Array.isArray(input.activities)
      ? input.activities.slice(0, 25).flatMap((raw) => {
        if (typeof raw !== 'object' || raw === null) return [];
        const activity = raw as Record<string, unknown>;
        const text = str(activity.text, 128);
        const type = ACTIVITY_KINDS.includes(activity.type as ActivityKind) ? activity.type as ActivityKind : 'Playing';
        return text ? [{ type, text, musicOnly: bool(activity.musicOnly, false) }] : [];
      })
      : current.activities
  }),

  commandSync: (input, current) => ({
    enabled: bool(input.enabled, current.enabled),
    target: (['guild', 'global', 'both'] as DeployTarget[]).includes(input.target as DeployTarget) ? input.target as DeployTarget : current.target
  }),

  maintenance: (input, current) => ({
    enabled: bool(input.enabled, current.enabled),
    message: str(input.message, 500) || current.message
  }),

  panel: (input, current) => {
    const publicUrl = str(input.publicUrl, 255).replace(/\/+$/, '');
    if (publicUrl && !/^https?:\/\/[^\s/]+/.test(publicUrl)) {
      throw new PanelError(400, 'The public URL must start with http:// or https://');
    }
    return {
      enabled: bool(input.enabled, current.enabled),
      host: str(input.host, 100) || current.host,
      port: Math.round(num(input.port, current.port, 1, 65535)),
      publicUrl,
      adminIds: strList(input.adminIds, 50).filter(isSnowflake)
    };
  }
};

export const registerSettingsRoutes: RouteRegistrar = (app, ctx) => {
  const { client } = ctx;

  app.get('/settings', async () => ({
    settings: client.settings.get(),
    ownerId: process.env.OWNER_ID ?? null,
    restartSections: RESTART_SECTIONS
  }));

  app.put('/settings/:section', async (request) => {
    const { section } = request.params as { section: SettingsSection };
    const sanitize = sanitizers[section] as Sanitizer<typeof section> | undefined;
    if (!sanitize) throw new PanelError(400, 'This settings section cannot be edited here.');

    if (section === 'panel' && currentUser(request).role !== 'owner') {
      throw new PanelError(403, 'Only the bot owner can change panel access settings.');
    }

    const current = client.settings.get()[section];
    const value = sanitize(bodyOf(request), current);
    client.settings.update(section, value);

    // Apply new Lavalink connection settings right away.
    if (section === 'lavalink') {
      reconnectLavalink(client);
    }

    // Forget the stored posts of pinboards that were deleted (the Discord posts themselves stay).
    if (section === 'pinboard') {
      const kept = new Set((value as BotSettings['pinboard']).boards.map(b => b.id));
      for (const board of (current as BotSettings['pinboard']).boards) {
        if (!kept.has(board.id)) client.pinboardManager.removeBoard(board.id);
      }
    }
    audit(ctx, request, 'Changed settings', section);

    return { ok: true, settings: client.settings.get(), restartRequired: RESTART_SECTIONS.includes(section) };
  });
};
