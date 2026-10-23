import {
  ChannelType,
  Client,
  Collection,
  GatewayIntentBits,
  Guild,
  GuildBasedChannel,
  GuildMember,
  PermissionFlagsBits
} from 'discord.js';
import { RouteRegistrar, PanelError, audit, bodyOf, isSnowflake, str, strList } from '../context';
import { ChannelInfo, GuildDetail, GuildSummary, MemberListResponse } from '../../shared/types';

const MEMBER_REFRESH_MS = 10 * 60 * 1000;
const lastMemberFetch = new Map<string, number>();

// True when the bot logged in with the privileged Server Members intent.
export function hasMembersIntent(client: Client): boolean {
  return client.options.intents.has(GatewayIntentBits.GuildMembers);
}

// Loads every member of a server into the cache (at most every 10 minutes per server).
async function fetchAllMembers(guild: Guild): Promise<void> {
  const last = lastMemberFetch.get(guild.id) ?? 0;
  if (Date.now() - last < MEMBER_REFRESH_MS) return;
  await guild.members.fetch();
  lastMemberFetch.set(guild.id, Date.now());
}

const CHANNEL_TYPES: Partial<Record<ChannelType, ChannelInfo['type']>> = {
  [ChannelType.GuildText]: 'text',
  [ChannelType.GuildVoice]: 'voice',
  [ChannelType.GuildAnnouncement]: 'announcement',
  [ChannelType.GuildStageVoice]: 'stage',
  [ChannelType.GuildForum]: 'forum'
};

export function getGuild(client: Client, guildId: string): Guild {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new PanelError(404, 'The bot is not in this server.');
  return guild;
}

function channelInfo(guild: Guild, channel: GuildBasedChannel): ChannelInfo | null {
  const type = CHANNEL_TYPES[channel.type];
  if (!type) return null;

  const me = guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  const sendable = !!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]) && channel.isTextBased();

  return {
    id: channel.id,
    name: channel.name,
    type,
    parentName: channel.parent?.name ?? null,
    position: 'rawPosition' in channel ? channel.rawPosition : 0,
    sendable,
    members: channel.isVoiceBased() ? channel.members.filter(m => !m.user.bot).size : undefined
  };
}

export function listChannels(guild: Guild): ChannelInfo[] {
  return guild.channels.cache
    .map(channel => channelInfo(guild, channel))
    .filter((c): c is ChannelInfo => c !== null)
    .sort((a, b) => (a.parentName ?? '').localeCompare(b.parentName ?? '') || a.position - b.position);
}

function summarize(client: Client, guild: Guild): GuildSummary {
  return {
    id: guild.id,
    name: guild.name,
    iconUrl: guild.iconURL({ size: 128 }),
    memberCount: guild.memberCount,
    ownerId: guild.ownerId,
    joinedAt: guild.joinedTimestamp ?? null,
    hasQueue: client.queueManager.has(guild.id)
  };
}

export const registerGuildRoutes: RouteRegistrar = (app, ctx) => {
  const { client } = ctx;

  app.get('/guilds', async () => {
    return client.guilds.cache.map(guild => summarize(client, guild)).sort((a, b) => b.memberCount - a.memberCount);
  });

  app.get('/guilds/:guildId', async (request): Promise<GuildDetail> => {
    const { guildId } = request.params as { guildId: string };
    const guild = getGuild(client, guildId);
    const commands = client.settings.get().commands;

    return {
      ...summarize(client, guild),
      createdAt: guild.createdTimestamp,
      description: guild.description,
      boostTier: guild.premiumTier,
      boosts: guild.premiumSubscriptionCount ?? 0,
      botNickname: guild.members.me?.nickname ?? null,
      channels: listChannels(guild),
      roles: guild.roles.cache
        .filter(role => role.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map(role => ({ id: role.id, name: role.name, color: role.hexColor, members: role.members.size, position: role.position })),
      emojis: guild.emojis.cache.map(emoji => ({
        id: emoji.id,
        name: emoji.name ?? 'emoji',
        animated: !!emoji.animated,
        url: emoji.imageURL(),
        display: emoji.toString()
      })),
      botPermissions: guild.members.me?.permissions.toArray() ?? [],
      disabledCommands: Object.entries(commands)
        .filter(([, settings]) => settings.disabledGuilds.includes(guild.id))
        .map(([name]) => name)
    };
  });

  app.put('/guilds/:guildId/nickname', async (request) => {
    const { guildId } = request.params as { guildId: string };
    const guild = getGuild(client, guildId);
    const nickname = str(bodyOf(request).nickname, 32);

    await guild.members.me?.setNickname(nickname || null);
    audit(ctx, request, 'Changed bot nickname', `${guild.name}: ${nickname || '(reset)'}`);
    return { ok: true };
  });

  app.put('/guilds/:guildId/commands', async (request) => {
    const { guildId } = request.params as { guildId: string };
    const guild = getGuild(client, guildId);
    const disabled = new Set(strList(bodyOf(request).disabled, 200));
    const commands = { ...client.settings.get().commands };

    for (const name of client.commands.keys()) {
      const current = commands[name] ?? { enabled: true, disabledGuilds: [] };
      const others = current.disabledGuilds.filter(id => id !== guild.id);
      commands[name] = { ...current, disabledGuilds: disabled.has(name) ? [...others, guild.id] : others };
    }

    client.settings.update('commands', commands);
    audit(ctx, request, 'Changed server commands', `${guild.name}: ${disabled.size} disabled`);
    return { ok: true };
  });

  app.post('/guilds/:guildId/leave', async (request) => {
    const { guildId } = request.params as { guildId: string };
    const guild = getGuild(client, guildId);
    const name = guild.name;

    await guild.leave();
    audit(ctx, request, 'Left server', name);
    return { ok: true };
  });

  app.get('/guilds/:guildId/channels', async (request) => {
    const { guildId } = request.params as { guildId: string };
    return listChannels(getGuild(client, guildId));
  });

  app.get('/guilds/:guildId/members', async (request): Promise<MemberListResponse> => {
    const { guildId } = request.params as { guildId: string };
    const query = request.query as Record<string, unknown>;
    const guild = getGuild(client, guildId);
    const search = str(query.q, 50);
    const channel = guild.channels.cache.get(str(query.channelId, 30));

    let members: Collection<string, GuildMember>;
    let complete = false;

    if (search) {
      // Name search uses Discord's REST search, which works without the members intent.
      members = await guild.members.search({ query: search, limit: 100 })
        .catch(() => guild.members.cache.filter(m => `${m.user.username} ${m.displayName}`.toLowerCase().includes(search.toLowerCase())));
      complete = true;
    } else if (hasMembersIntent(client)) {
      await fetchAllMembers(guild);
      members = guild.members.cache;
      complete = true;
    } else {
      members = guild.members.cache;
    }

    const visible = channel ? members.filter(m => channel.permissionsFor(m)?.has(PermissionFlagsBits.ViewChannel)) : members;

    return {
      complete,
      members: visible
        .map(m => ({
          id: m.id,
          username: m.user.username,
          displayName: m.displayName,
          avatarUrl: m.displayAvatarURL({ size: 64 }),
          bot: m.user.bot
        }))
        .sort((a, b) => Number(a.bot) - Number(b.bot) || a.displayName.localeCompare(b.displayName))
        .slice(0, 500)
    };
  });

  app.get('/users/:userId', async (request) => {
    const { userId } = request.params as { userId: string };
    if (!isSnowflake(userId)) throw new PanelError(400, 'Invalid user ID.');

    try {
      const user = await client.users.fetch(userId);
      return { id: user.id, username: user.username, displayName: user.displayName, avatarUrl: user.displayAvatarURL({ size: 64 }), bot: user.bot };
    } catch {
      throw new PanelError(404, 'User not found.');
    }
  });
};
