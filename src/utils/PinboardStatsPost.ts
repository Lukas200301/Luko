import { APIEmbed, APIEmbedField, AttachmentBuilder, Client } from 'discord.js';
import { db } from './Database';
import { renderBarChart } from './StatsChart';
import {
  PINBOARD_STATS_LISTS,
  PINBOARD_STATS_SECTIONS,
  PinboardBoard,
  PinboardRange,
  PinboardStatsList,
  PinboardStatsPost,
  PinboardStatsSection
} from '../shared/types';

// Posts a board's statistics as embeds: from the panel (with a preview) or automatically every
// Monday / on the 1st of the month. The layout is chosen per board in the panel.

const RANGES: PinboardRange[] = ['7d', '30d', '90d', '365d', 'all'];
const RANGE_LABELS: Record<PinboardRange, string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', '365d': 'Last year', all: 'All time' };
const MEDALS = ['🥇', '🥈', '🥉'];
export const CHART_FILE = 'pins-over-time.png';
export const MAX_LIST_ENTRIES = 25;
const FIELD_LIMIT = 1024;
const DESCRIPTION_LIMIT = 4096;
// Discord allows 6000 characters across all embeds of one message; keep some room.
const MESSAGE_LIMIT = 5800;
const MAX_FIELDS = 25;
const CHECK_INTERVAL = 10 * 60 * 1000;
const EMPTY = 'Nothing in this time range';

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

const isList = (section: PinboardStatsSection): section is PinboardStatsList => (PINBOARD_STATS_LISTS as readonly string[]).includes(section);

export function defaultStatsPost(board: PinboardBoard): PinboardStatsPost {
  return {
    channelId: board.channelId,
    range: '30d',
    title: '',
    description: '',
    color: '#FEE75C',
    sections: [...PINBOARD_STATS_SECTIONS],
    limits: { authors: 5, channels: 5, emojis: 5, topPins: 5 },
    layout: 'fields',
    mentionAuthors: true,
    thumbnail: true,
    schedule: 'off',
    hour: 18
  };
}

// Cleans up a layout sent by the panel (or saved by an older version).
export function sanitizeStatsPost(input: Record<string, unknown>, fallback: PinboardStatsPost): PinboardStatsPost {
  const text = (value: unknown, max: number, current: string) => (typeof value === 'string' ? value.trim().slice(0, max) : current);
  const flag = (value: unknown, current: boolean) => (typeof value === 'boolean' ? value : current);
  const int = (value: unknown, min: number, max: number, current: number) => {
    const n = Number(value);
    return value !== null && value !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : current;
  };

  const sections = Array.isArray(input.sections)
    ? [...new Set(input.sections.filter((s): s is PinboardStatsSection => PINBOARD_STATS_SECTIONS.includes(s as PinboardStatsSection)))]
    : fallback.sections;
  const channelId = text(input.channelId, 30, fallback.channelId);
  const color = text(input.color, 7, fallback.color);
  // Older versions had one "limit" for every list.
  const rawLimits = (typeof input.limits === 'object' && input.limits !== null ? input.limits : {}) as Record<string, unknown>;
  const limits = Object.fromEntries(PINBOARD_STATS_LISTS.map(list => [
    list,
    int(rawLimits[list] ?? input.limit, 1, MAX_LIST_ENTRIES, fallback.limits[list])
  ])) as Record<PinboardStatsList, number>;

  return {
    channelId: /^\d{15,25}$/.test(channelId) ? channelId : fallback.channelId,
    range: RANGES.includes(input.range as PinboardRange) ? input.range as PinboardRange : fallback.range,
    title: text(input.title, 200, fallback.title),
    description: text(input.description, 1000, fallback.description),
    color: /^#[0-9a-f]{6}$/i.test(color) ? color : fallback.color,
    sections,
    limits,
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

// Splits lines into chunks of at most `max` characters, keeping lines whole.
function chunk(lines: string[], max: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    const piece = line.length > max ? `${line.slice(0, max - 1)}…` : line;
    if (current && current.length + piece.length + 1 > max) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n${piece}` : piece;
  }
  if (current) chunks.push(current);
  return chunks;
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

type Stats = ReturnType<Client['pinboardManager']['stats']>;

// The text lines of every section except the chart.
function sectionLines(board: PinboardBoard, config: PinboardStatsPost, stats: Stats): Record<PinboardStatsSection, string[]> {
  const { limits } = config;
  const timeline = stats.timeline;
  const busiest = timeline.length ? timeline.reduce((a, b) => (b.pins > a.pins ? b : a)) : null;

  return {
    totals: [`**${plural(stats.pins, 'pin')}** · **${plural(stats.reactions, 'reaction')}** · ${stats.averageReactions.toLocaleString('en-US')} per pin · record **${stats.maxReactions}**`],
    // Only shown when the chart can't be drawn.
    timeline: busiest ? [`Busiest: **${busiest.label}** with ${plural(busiest.pins, 'pin')}`, `${timeline[0].label} – ${timeline[timeline.length - 1].label}`] : [EMPTY],
    authors: stats.authors.slice(0, limits.authors).map((a, i) => {
      const who = config.mentionAuthors && /^\d{15,25}$/.test(a.key) ? `<@${a.key}>` : `**${a.name}**`;
      return `${rank(i)} ${who} · ${plural(a.pins, 'pin')}`;
    }),
    channels: stats.channels.slice(0, limits.channels).map((c, i) => `${rank(i)} <#${c.channelId}> · ${plural(c.pins, 'pin')}`),
    emojis: stats.emojis.slice(0, limits.emojis).map((e, i) => {
      const emoji = e.display || (/^\d+$/.test(e.emoji) ? `<:e:${e.emoji}>` : e.emoji);
      return `${rank(i)} ${emoji} · ${plural(e.pins, 'pin')} · ${plural(e.reactions, 'reaction')}`;
    }),
    topPins: stats.top.slice(0, limits.topPins).map((entry, i) => {
      const emoji = entry.emojiDisplay || entry.emoji || '⭐';
      const label = excerpt(entry.content ?? entry.excerpt ?? '') || (entry.imageUrl ? 'Image' : 'Message');
      const url = entry.channelId ? `https://discord.com/channels/${board.guildId}/${entry.channelId}/${entry.originalMessageId}` : null;
      const who = config.mentionAuthors && entry.authorId ? `<@${entry.authorId}>` : `**${entry.authorName ?? 'Unknown'}**`;
      return `${rank(i)} ${emoji} **${entry.count ?? 0}** · ${who} · ${url ? `[${label}](${url})` : label}`;
    })
  };
}

// Fields for one section in the side-by-side layout. A long list continues in more fields (over the
// full width then, so it reads top to bottom).
function sectionFields(section: PinboardStatsSection, lines: string[], stats: Stats): APIEmbedField[] {
  if (section === 'totals') {
    return [
      { name: '📌 Pins', value: `**${stats.pins.toLocaleString('en-US')}**\n${stats.pinsLast7Days} this week`, inline: true },
      { name: '💬 Reactions', value: `**${stats.reactions.toLocaleString('en-US')}**\n${stats.averageReactions.toLocaleString('en-US')} per pin`, inline: true },
      { name: '🏅 Record', value: `**${stats.maxReactions}**\non one pin`, inline: true }
    ];
  }
  const chunks = chunk(lines.length ? lines : [EMPTY], FIELD_LIMIT);
  const inline = chunks.length === 1 && (section === 'authors' || section === 'channels' || section === 'emojis');
  return chunks.map((value, i) => ({ name: i === 0 ? SECTION_TITLES[section] : '\u200b', value, inline }));
}

export interface StatsMessage {
  embeds: APIEmbed[];
  chart: Buffer | null;
}

// The post as embeds plus the chart image. Discord always shows an embed's image at its bottom, so
// when the chart isn't the last section the post is split after it: the first embed ends with the
// chart, the rest continues in a second embed right below.
export function buildStatsMessage(client: Client, board: PinboardBoard, config: PinboardStatsPost): StatsMessage {
  const listLimit = Math.max(10, ...Object.values(config.limits));
  const stats = client.pinboardManager.stats(board.id, config.range, listLimit);
  const guild = client.guilds.cache.get(board.guildId);
  const color = parseInt(config.color.slice(1), 16);
  const title = (config.title || `📌 ${board.name} statistics`).slice(0, 256);
  const footer = { text: `${guild?.name ?? board.name} · ${RANGE_LABELS[config.range]}` };
  const thumbnail = config.thumbnail && guild?.iconURL() ? { url: guild.iconURL({ size: 256 })! } : undefined;

  if (stats.pins === 0) {
    return { embeds: [{ title, color, description: `${config.description ? `${config.description}\n\n` : ''}No pins in this time range yet.`, thumbnail, footer, timestamp: new Date().toISOString() }], chart: null };
  }

  // The chart: long ranges are grouped by month; at most the last two years.
  let chart: Buffer | null = null;
  if (config.sections.includes('timeline') && stats.timeline.length > 0) {
    const points = stats.timeline.slice(-24);
    const busiest = points.reduce((a, b) => (b.pins > a.pins ? b : a));
    chart = renderBarChart(points.map(p => ({ label: p.label, value: p.pins })), {
      title: 'Pins over time',
      subtitle: `${plural(points.reduce((sum, p) => sum + p.pins, 0), 'pin')} · busiest: ${busiest.label} (${busiest.pins})`,
      color: config.color
    });
  }

  const lines = sectionLines(board, config, stats);
  const shown = config.sections.filter(section => !(section === 'timeline' && chart));

  // Within Discord's limit for the whole message: shorten the longest lists first.
  const size = () => title.length + config.description.length + footer.text.length
    + shown.reduce((sum, s) => sum + SECTION_TITLES[s].length + lines[s].reduce((n, line) => n + line.length + 1, 0) + 40, 0);
  while (size() > MESSAGE_LIMIT) {
    const longest = shown.filter(isList).sort((a, b) => lines[b].length - lines[a].length)[0];
    if (!longest || lines[longest].length <= 1) break;
    lines[longest].pop();
  }

  // Sections before (and including) the chart, and after it.
  const chartAt = chart ? config.sections.indexOf('timeline') : -1;
  const groups = chartAt === -1
    ? [config.sections]
    : [config.sections.slice(0, chartAt), config.sections.slice(chartAt + 1)];

  const embeds: APIEmbed[] = [];
  groups.forEach((group, g) => {
    const sections = group.filter(section => section !== 'timeline' || !chart);
    if (g > 0 && sections.length === 0) return;
    const first = g === 0;
    const intro = first && config.description ? config.description : '';

    if (config.layout === 'list') {
      const blocks = sections.map(section => `**${SECTION_TITLES[section]}**\n${(lines[section].length ? lines[section] : [EMPTY]).join('\n')}`);
      const parts = chunk([intro, ...blocks].filter(Boolean).flatMap((block, i) => (i > 0 ? ['', ...block.split('\n')] : block.split('\n'))), DESCRIPTION_LIMIT);
      (parts.length ? parts : ['']).forEach((description, i) => embeds.push({ color, ...(first && i === 0 ? { title, thumbnail } : {}), ...(description ? { description } : {}) }));
    } else {
      const fields = sections.flatMap(section => sectionFields(section, lines[section], stats));
      for (let i = 0; i < Math.max(1, fields.length); i += MAX_FIELDS) {
        embeds.push({
          color,
          ...(first && i === 0 ? { title, thumbnail, ...(intro ? { description: intro } : {}) } : {}),
          ...(fields.length ? { fields: fields.slice(i, i + MAX_FIELDS) } : {})
        });
      }
    }
    // The chart closes the first group, right where "Pins over time" is in the order.
    if (first && chart) embeds[embeds.length - 1].image = { url: `attachment://${CHART_FILE}` };
  });

  const last = embeds[embeds.length - 1];
  last.footer = footer;
  last.timestamp = new Date().toISOString();
  return { embeds: embeds.slice(0, 10), chart };
}

// Author names as stored with the pins, for previews when Discord can't be asked.
export function storedAuthorNames(client: Client, board: PinboardBoard, config: PinboardStatsPost): Record<string, string> {
  const stats = client.pinboardManager.stats(board.id, config.range, Math.max(10, ...Object.values(config.limits)));
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
  const { embeds, chart } = buildStatsMessage(client, board, config);
  const message = await channel.send({
    embeds,
    files: chart ? [new AttachmentBuilder(chart, { name: CHART_FILE })] : [],
    allowedMentions: { parse: [] }
  });
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
