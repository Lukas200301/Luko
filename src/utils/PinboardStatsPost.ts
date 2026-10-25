import { APIEmbed, APIEmbedField, Client } from 'discord.js';
import { db } from './Database';
import {
  PINBOARD_STATS_SECTIONS,
  PinboardBoard,
  PinboardRange,
  PinboardStatsPost,
  PinboardStatsSection
} from '../shared/types';

// Posts a board's statistics as an embed: from the panel (with a preview) or automatically every
// Monday / on the 1st of the month. The layout is chosen per board in the panel.

const RANGES: PinboardRange[] = ['7d', '30d', '90d', '365d', 'all'];
const RANGE_LABELS: Record<PinboardRange, string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', '365d': 'Last year', all: 'All time' };
const MEDALS = ['🥇', '🥈', '🥉'];
const SPARK = '▁▂▃▄▅▆▇█';
const FIELD_LIMIT = 1024;
const DESCRIPTION_LIMIT = 4096;
const CHECK_INTERVAL = 10 * 60 * 1000;

const SECTION_TITLES: Record<PinboardStatsSection, string> = {
  totals: '📊 Overview',
  timeline: '📈 Pins over time',
  authors: '🏆 Top authors',
  channels: '#️⃣ Top channels',
  emojis: '😀 Top emojis',
  topPins: '🔥 Most reactions'
};

const statements = {
  getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
  setMeta: db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
};

export function defaultStatsPost(board: PinboardBoard): PinboardStatsPost {
  return {
    channelId: board.channelId,
    range: '30d',
    title: '',
    description: '',
    color: '#FEE75C',
    sections: [...PINBOARD_STATS_SECTIONS],
    limit: 5,
    layout: 'fields',
    mentionAuthors: true,
    thumbnail: true,
    schedule: 'off',
    hour: 18
  };
}

// Cleans up a layout sent by the panel.
export function sanitizeStatsPost(input: Record<string, unknown>, fallback: PinboardStatsPost): PinboardStatsPost {
  const text = (value: unknown, max: number, current: string) => (typeof value === 'string' ? value.trim().slice(0, max) : current);
  const flag = (value: unknown, current: boolean) => (typeof value === 'boolean' ? value : current);
  const int = (value: unknown, min: number, max: number, current: number) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : current;
  };

  const sections = Array.isArray(input.sections)
    ? [...new Set(input.sections.filter((s): s is PinboardStatsSection => PINBOARD_STATS_SECTIONS.includes(s as PinboardStatsSection)))]
    : fallback.sections;
  const channelId = text(input.channelId, 30, fallback.channelId);
  const color = text(input.color, 7, fallback.color);

  return {
    channelId: /^\d{15,25}$/.test(channelId) ? channelId : fallback.channelId,
    range: RANGES.includes(input.range as PinboardRange) ? input.range as PinboardRange : fallback.range,
    title: text(input.title, 200, fallback.title),
    description: text(input.description, 1000, fallback.description),
    color: /^#[0-9a-f]{6}$/i.test(color) ? color : fallback.color,
    sections,
    limit: int(input.limit, 1, 10, fallback.limit),
    layout: input.layout === 'list' || input.layout === 'fields' ? input.layout : fallback.layout,
    mentionAuthors: flag(input.mentionAuthors, fallback.mentionAuthors),
    thumbnail: flag(input.thumbnail, fallback.thumbnail),
    schedule: input.schedule === 'weekly' || input.schedule === 'monthly' || input.schedule === 'off' ? input.schedule : fallback.schedule,
    hour: int(input.hour, 0, 23, fallback.hour)
  };
}

export function statsPostFor(client: Client, board: PinboardBoard): PinboardStatsPost {
  const saved = client.settings.get().pinboardStats.posts[board.id];
  return saved ? sanitizeStatsPost(saved as unknown as Record<string, unknown>, defaultStatsPost(board)) : defaultStatsPost(board);
}

// Keeps whole lines until the text would be longer than `max`.
function fit(lines: string[], max: number): string {
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > max - 2) {
      kept.push('…');
      break;
    }
    kept.push(line);
    length += line.length + 1;
  }
  return kept.join('\n');
}

// A short, safe preview of a message for a link label: no mentions, emoji codes or markdown.
function excerpt(text: string, max = 60): string {
  const clean = text
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/<@[!&]?\d+>/g, '@someone')
    .replace(/<#\d+>/g, '#channel')
    .replace(/<t:\d+(:\w)?>/g, 'a date')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/[*_~`|>[\]\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

const rank = (i: number) => MEDALS[i] ?? `\`${i + 1}.\``;
const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

export function buildStatsEmbed(client: Client, board: PinboardBoard, config: PinboardStatsPost): APIEmbed {
  const stats = client.pinboardManager.stats(board.id, config.range);
  const guild = client.guilds.cache.get(board.guildId);
  const empty = 'Nothing in this time range';

  const sectionLines: Record<PinboardStatsSection, () => string[]> = {
    totals: () => [`**${plural(stats.pins, 'pin')}** · **${plural(stats.reactions, 'reaction')}** · ${stats.averageReactions.toLocaleString('en-US')} per pin · record **${stats.maxReactions}**`],
    timeline: () => {
      const points = stats.timeline.slice(-24);
      if (stats.pins === 0 || points.length === 0) return [empty];
      const max = Math.max(1, ...points.map(p => p.pins));
      const busiest = points.reduce((a, b) => (b.pins > a.pins ? b : a));
      const spark = points.map(p => SPARK[Math.round((p.pins / max) * (SPARK.length - 1))]).join('');
      return ['```', spark, '```', `*${points[0].label} – ${points[points.length - 1].label} · busiest: ${busiest.label} (${plural(busiest.pins, 'pin')})*`];
    },
    authors: () => stats.authors.slice(0, config.limit).map((a, i) => {
      const who = config.mentionAuthors && /^\d{15,25}$/.test(a.key) ? `<@${a.key}>` : `**${a.name}**`;
      return `${rank(i)} ${who} · ${plural(a.pins, 'pin')}`;
    }),
    channels: () => stats.channels.slice(0, config.limit).map((c, i) => `${rank(i)} <#${c.channelId}> · ${plural(c.pins, 'pin')}`),
    emojis: () => stats.emojis.slice(0, config.limit).map((e, i) => {
      const emoji = e.display || (/^\d+$/.test(e.emoji) ? `<:e:${e.emoji}>` : e.emoji);
      return `${rank(i)} ${emoji} · ${plural(e.pins, 'pin')} · ${plural(e.reactions, 'reaction')}`;
    }),
    topPins: () => stats.top.slice(0, config.limit).map((entry, i) => {
      const emoji = entry.emojiDisplay || entry.emoji || '⭐';
      const label = excerpt(entry.content ?? entry.excerpt ?? '') || (entry.imageUrl ? 'Image' : 'Message');
      const url = entry.channelId ? `https://discord.com/channels/${board.guildId}/${entry.channelId}/${entry.originalMessageId}` : null;
      const who = config.mentionAuthors && entry.authorId ? `<@${entry.authorId}>` : `**${entry.authorName ?? 'Unknown'}**`;
      return `${rank(i)} ${emoji} **${entry.count ?? 0}** · ${who} · ${url ? `[${label}](${url})` : label}`;
    })
  };

  const lines = (section: PinboardStatsSection) => {
    const result = sectionLines[section]();
    return result.length ? result : [empty];
  };

  const embed: APIEmbed = {
    title: (config.title || `📌 ${board.name} statistics`).slice(0, 256),
    color: parseInt(config.color.slice(1), 16),
    footer: { text: `${guild?.name ?? board.name} · ${RANGE_LABELS[config.range]}` },
    timestamp: new Date().toISOString()
  };
  if (config.thumbnail && guild?.iconURL()) embed.thumbnail = { url: guild.iconURL({ size: 256 })! };

  const intro = config.description ? `${config.description}\n\n` : '';

  if (config.layout === 'list' || stats.pins === 0) {
    const blocks = stats.pins === 0
      ? ['No pins in this time range yet.']
      : config.sections.map(section => `**${SECTION_TITLES[section]}**\n${lines(section).join('\n')}`);
    embed.description = fit(`${intro}${blocks.join('\n\n')}`.split('\n'), DESCRIPTION_LIMIT);
    return embed;
  }

  // Side by side: the overview as three inline fields, the short lists next to each other,
  // the timeline and the top pins over the full width.
  const fields: APIEmbedField[] = [];
  for (const section of config.sections) {
    if (section === 'totals') {
      fields.push(
        { name: '📌 Pins', value: `**${stats.pins.toLocaleString('en-US')}**\n${stats.pinsLast7Days} this week`, inline: true },
        { name: '💬 Reactions', value: `**${stats.reactions.toLocaleString('en-US')}**\n${stats.averageReactions.toLocaleString('en-US')} per pin`, inline: true },
        { name: '🏅 Record', value: `**${stats.maxReactions}**\non one pin`, inline: true }
      );
    } else {
      fields.push({ name: SECTION_TITLES[section], value: fit(lines(section), FIELD_LIMIT), inline: section === 'authors' || section === 'channels' || section === 'emojis' });
    }
  }
  if (intro) embed.description = intro.trim();
  embed.fields = fields.slice(0, 25);
  return embed;
}

// Author names as stored with the pins, for previews when Discord can't be asked.
export function storedAuthorNames(client: Client, board: PinboardBoard, range: PinboardRange): Record<string, string> {
  const stats = client.pinboardManager.stats(board.id, range);
  const names: Record<string, string> = {};
  for (const author of stats.authors) if (/^\d{15,25}$/.test(author.key)) names[author.key] = author.name;
  for (const entry of stats.top) if (entry.authorId && entry.authorName) names[entry.authorId] ??= entry.authorName;
  return names;
}

export async function postStats(client: Client, board: PinboardBoard, config: PinboardStatsPost): Promise<string> {
  const channel = await client.channels.fetch(config.channelId).catch(() => null);
  if (!channel || channel.isDMBased() || !channel.isSendable() || channel.guildId !== board.guildId) {
    throw new Error('The bot cannot post in that channel (it has to be a text channel on the pinboard\'s server).');
  }
  const message = await channel.send({ embeds: [buildStatsEmbed(client, board, config)], allowedMentions: { parse: [] } });
  return message.url;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

async function postScheduled(client: Client): Promise<void> {
  const settings = client.settings.get();
  if (!settings.features.pinboard || !client.isReady()) return;
  const now = new Date();

  for (const board of settings.pinboard.boards) {
    const config = statsPostFor(client, board);
    if (!board.enabled || config.schedule === 'off' || now.getHours() < config.hour) continue;
    const due = config.schedule === 'weekly' ? now.getDay() === 1 : now.getDate() === 1;
    if (!due) continue;

    const key = `pinboard_stats_posted:${board.id}`;
    if ((statements.getMeta.get(key) as { value: string } | undefined)?.value === dateKey(now)) continue;
    // Marked first: a failing channel shouldn't be retried every 10 minutes.
    statements.setMeta.run(key, dateKey(now));

    try {
      await postStats(client, board, config);
      console.log(`📌 Posted the ${config.schedule} statistics of "${board.name}".`);
    } catch (error) {
      console.error(`❌ Could not post the statistics of "${board.name}":`, error);
    }
  }
}

let timer: NodeJS.Timeout | null = null;

export function startStatsSchedule(client: Client): void {
  if (timer) return;
  timer = setInterval(() => void postScheduled(client), CHECK_INTERVAL);
  setTimeout(() => void postScheduled(client), 60_000);
}
