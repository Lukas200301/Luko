import type { DiscordMentions } from './types';

// Names for mentions in message text. API responses with pins carry the names they need;
// they're remembered here so every component rendering message text can use them.
const mentions: DiscordMentions = { channels: {}, users: {}, roles: {} };

export function rememberMentions<T extends { mentions?: DiscordMentions }>(response: T): T {
  if (response.mentions) {
    Object.assign(mentions.channels, response.mentions.channels);
    Object.assign(mentions.users, response.mentions.users);
    Object.assign(mentions.roles, response.mentions.roles);
  }
  return response;
}

export function mentionName(kind: 'channel' | 'user' | 'role', id: string): string | undefined {
  if (kind === 'channel') return mentions.channels[id];
  if (kind === 'user') return mentions.users[id];
  return mentions.roles[id]?.name;
}

export function roleColor(id: string): number {
  return mentions.roles[id]?.color ?? 0;
}

// The user's current avatar through the panel (stored avatar URLs break when people change theirs).
export function avatarUrl(userId: string | undefined | null, guildId?: string): string | undefined {
  if (!userId || !/^\d{15,25}$/.test(userId)) return undefined;
  return `/api/users/${userId}/avatar${guildId ? `?guild=${guildId}` : ''}`;
}
