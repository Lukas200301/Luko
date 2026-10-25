import { Client, Guild } from 'discord.js';
import { DiscordMentions } from '../shared/types';

// Current avatars and names of Discord users for the panel. Stored avatar URLs stop working when
// someone changes their avatar, so they are looked up again (at most every few hours per user).

const TTL = 6 * 60 * 60 * 1000;
// Unknown users (or the bot being offline) are asked again sooner.
const MISS_TTL = 10 * 60 * 1000;
const MAX_USER_LOOKUPS = 25;

interface Known {
  // null when Discord doesn't know the user (or couldn't be asked): the panel then uses the stored avatar.
  avatarUrl: string | null;
  name: string | null;
  expires: number;
}

const known = new Map<string, Known>();
const pending = new Map<string, Promise<Known>>();

async function lookUp(client: Client, userId: string, guild: Guild | undefined): Promise<Known> {
  // The server profile first (server avatar and nickname), then the user, so people who left still resolve.
  const member = guild ? await guild.members.fetch({ user: userId, force: true }).catch(() => null) : null;
  const user = member?.user ?? await client.users.fetch(userId, { force: true }).catch(() => null);

  if (user) client.pinboardManager.updateAvatar(userId, user.displayAvatarURL());
  return {
    avatarUrl: member?.displayAvatarURL({ size: 128 }) ?? user?.displayAvatarURL({ size: 128 }) ?? null,
    name: member?.displayName ?? user?.displayName ?? null,
    expires: Date.now() + (user ? TTL : MISS_TTL)
  };
}

export function userInfo(client: Client, userId: string, guildId?: string): Promise<Known> {
  const guild = guildId ? client.guilds.cache.get(guildId) : undefined;
  const key = `${guild?.id ?? ''}:${userId}`;
  const cached = known.get(key);
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached);

  let lookup = pending.get(key);
  if (!lookup) {
    lookup = lookUp(client, userId, guild)
      .then(info => {
        known.set(key, info);
        return info;
      })
      .finally(() => pending.delete(key));
    pending.set(key, lookup);
  }
  return lookup;
}

const MENTION = /<(#|@!?|@&)(\d{15,25})>/g;

// Names for the channel, user and role mentions in some message texts.
export async function resolveMentions(client: Client, guildId: string | undefined, texts: Array<string | undefined>): Promise<DiscordMentions> {
  const mentions: DiscordMentions = { channels: {}, users: {}, roles: {} };
  const guild = guildId ? client.guilds.cache.get(guildId) : undefined;
  const lookups = new Set<string>();

  for (const text of texts) {
    if (!text) continue;
    for (const [, kind, id] of text.matchAll(MENTION)) {
      if (kind === '#') {
        const channel = client.channels.cache.get(id);
        if (channel && 'name' in channel && channel.name) mentions.channels[id] = channel.name;
      } else if (kind === '@&') {
        const role = guild?.roles.cache.get(id);
        if (role) mentions.roles[id] = { name: role.name, color: role.colors.primaryColor };
      } else {
        const name = guild?.members.cache.get(id)?.displayName ?? client.users.cache.get(id)?.displayName;
        if (name) mentions.users[id] = name;
        else lookups.add(id);
      }
    }
  }

  await Promise.all([...lookups].slice(0, MAX_USER_LOOKUPS).map(async id => {
    const { name } = await userInfo(client, id, guild?.id);
    if (name) mentions.users[id] = name;
  }));
  return mentions;
}
