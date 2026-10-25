import { Client, EmbedBuilder, resolveColor } from 'discord.js';
import { RouteRegistrar, PanelError, audit, bodyOf, bool, isSnowflake, num, str } from '../context';
import {
  EmbedPayload,
  EmojiInfo,
  PinboardBoard,
  PinboardBoardStatus,
  PinboardEntryDetail,
  PinboardEntryPage,
  PinboardRange,
  PinboardSort,
  PinboardStats,
  ReminderInfo
} from '../../shared/types';
import { backfillStatus, startBackfill } from '../../utils/PinboardBackfill';

const RECENT_LIMIT = 25;
const RANGES: PinboardRange[] = ['7d', '30d', '90d', '365d', 'all'];
const SORTS: PinboardSort[] = ['newest', 'oldest', 'reactions', 'message'];
const MAX_PAGE_SIZE = 50;

function boardStatus(client: Client, board: PinboardBoard, entryCount: number): PinboardBoardStatus {
  const guild = client.guilds.cache.get(board.guildId);
  const channel = guild?.channels.cache.get(board.channelId);
  return {
    ...board,
    entryCount,
    botInGuild: !!guild || !board.guildId,
    guildName: guild?.name ?? null,
    channelName: channel?.name ?? null,
    guildEmojis: guild
      ? guild.emojis.cache.map((emoji): EmojiInfo => ({
        id: emoji.id,
        name: emoji.name ?? 'emoji',
        animated: !!emoji.animated,
        url: emoji.imageURL({ size: 128 }),
        display: emoji.toString()
      }))
      : []
  };
}

function buildEmbed(payload: EmbedPayload): EmbedBuilder | null {
  const embed = new EmbedBuilder();
  let hasContent = false;

  const title = str(payload.title, 256);
  const description = str(payload.description, 4096);
  const url = str(payload.url, 500);
  const authorName = str(payload.authorName, 256);
  const footerText = str(payload.footerText, 2048);
  const imageUrl = str(payload.imageUrl, 1000);
  const thumbnailUrl = str(payload.thumbnailUrl, 1000);
  const color = str(payload.color, 7);

  if (title) { embed.setTitle(title); hasContent = true; }
  if (description) { embed.setDescription(description); hasContent = true; }
  if (url.startsWith('http')) embed.setURL(url);
  if (authorName) {
    const iconURL = str(payload.authorIconUrl, 1000);
    embed.setAuthor({ name: authorName, iconURL: iconURL.startsWith('http') ? iconURL : undefined });
    hasContent = true;
  }
  if (footerText) { embed.setFooter({ text: footerText }); hasContent = true; }
  if (imageUrl.startsWith('http')) { embed.setImage(imageUrl); hasContent = true; }
  if (thumbnailUrl.startsWith('http')) embed.setThumbnail(thumbnailUrl);
  if (/^#[0-9a-f]{6}$/i.test(color)) embed.setColor(resolveColor(color as `#${string}`));
  if (payload.timestamp) embed.setTimestamp();

  for (const field of (payload.fields ?? []).slice(0, 25)) {
    const name = str(field.name, 256);
    const value = str(field.value, 1024);
    if (name && value) {
      embed.addFields({ name, value, inline: !!field.inline });
      hasContent = true;
    }
  }

  return hasContent ? embed : null;
}

export const registerCommunityRoutes: RouteRegistrar = (app, ctx) => {
  const { client } = ctx;

  // ---- Pinboard ----

  // Board settings plus the newest pinned messages. Kept fast: no Discord requests here.
  app.get('/pinboard', async () => {
    const settings = client.settings.get();
    const counts = client.pinboardManager.countsByBoard();

    return {
      enabled: settings.features.pinboard,
      boards: settings.pinboard.boards.map(board => boardStatus(client, board, counts.get(board.id) ?? 0)),
      recent: client.pinboardManager.getPage(null, RECENT_LIMIT, 0),
      total: client.pinboardManager.size()
    };
  });

  const findBoard = (boardId: string): PinboardBoard => {
    const board = client.settings.get().pinboard.boards.find(b => b.id === boardId);
    if (!board) throw new PanelError(404, 'Pinboard not found.');
    return board;
  };

  const channelName = (board: PinboardBoard, channelId?: string): string | null => {
    const channel = channelId ? client.guilds.cache.get(board.guildId)?.channels.cache.get(channelId) : undefined;
    return channel?.name ?? null;
  };

  const rangeOf = (value: unknown): PinboardRange => (RANGES.includes(value as PinboardRange) ? value as PinboardRange : 'all');

  // One page of a board's pinned messages, filtered and sorted. Reads only the database.
  app.get('/pinboard/boards/:boardId/entries', async (request): Promise<PinboardEntryPage> => {
    const { boardId } = request.params as { boardId: string };
    const query = request.query as Record<string, unknown>;
    const board = findBoard(boardId);

    const limit = Math.round(num(query.limit, RECENT_LIMIT, 1, MAX_PAGE_SIZE));
    const offset = Math.round(num(query.offset, 0, 0, Number.MAX_SAFE_INTEGER));
    const { entries, total } = client.pinboardManager.query({
      boardId,
      range: rangeOf(query.range),
      sort: SORTS.includes(query.sort as PinboardSort) ? query.sort as PinboardSort : 'newest',
      emoji: str(query.emoji, 100) || undefined,
      author: str(query.author, 150) || undefined,
      channelId: str(query.channel, 30) || undefined,
      search: str(query.q, 100) || undefined,
      limit,
      offset
    });

    // Older pins are completed in the background; the page doesn't wait for it.
    startBackfill(client, board);

    return { entries: entries.map(e => ({ ...e, channelName: channelName(board, e.channelId) })), total, offset, limit };
  });

  app.get('/pinboard/boards/:boardId/entries/:messageId', async (request): Promise<PinboardEntryDetail> => {
    const { boardId, messageId } = request.params as { boardId: string; messageId: string };
    const board = findBoard(boardId);
    const detail = client.pinboardManager.getDetail(boardId, messageId);
    if (!detail) throw new PanelError(404, 'Pinned message not found.');
    return { ...detail, channelName: channelName(board, detail.channelId) };
  });

  app.get('/pinboard/boards/:boardId/stats', async (request): Promise<PinboardStats> => {
    const { boardId } = request.params as { boardId: string };
    const board = findBoard(boardId);
    const stats = client.pinboardManager.stats(boardId, rangeOf((request.query as Record<string, unknown>).range));
    startBackfill(client, board);

    return {
      ...stats,
      channels: stats.channels.map(ch => ({ ...ch, name: channelName(board, ch.channelId) })),
      backfill: backfillStatus(client, boardId)
    };
  });

  app.post('/pinboard/boards/:boardId/backfill', async (request) => {
    const board = findBoard((request.params as { boardId: string }).boardId);
    if (!client.guilds.cache.has(board.guildId)) throw new PanelError(400, 'The bot is not in this server, so the posts cannot be read.');
    startBackfill(client, board);
    return backfillStatus(client, board.id);
  });

  app.delete('/pinboard/entries/:boardId/:messageId', async (request) => {
    const { boardId, messageId } = request.params as { boardId: string; messageId: string };
    const entry = client.pinboardManager.getEntry(boardId, messageId);
    if (!entry) throw new PanelError(404, 'Pinboard entry not found.');

    const board = client.settings.get().pinboard.boards.find(b => b.id === boardId);
    if (board) {
      const channel = await client.channels.fetch(board.channelId).catch(() => null);
      if (channel?.isTextBased() && 'messages' in channel) {
        // The pinboard post may already be gone; removing the entry is still useful.
        await channel.messages.delete(entry.pinboardMessageId).catch(() => {});
      }
    }

    client.pinboardManager.removePinboardMessage(boardId, messageId);
    audit(ctx, request, 'Removed pinboard entry', entry.excerpt?.slice(0, 80) || messageId);
    return { ok: true };
  });

  // ---- Reminders ----

  app.get('/reminders', async (): Promise<ReminderInfo[]> => {
    return client.reminderManager.getAllReminders().map((reminder) => {
      const channel = client.channels.cache.get(reminder.channelId);
      return {
        ...reminder,
        userTag: client.users.cache.get(reminder.userId)?.tag ?? null,
        channelName: channel && 'name' in channel ? channel.name : null
      };
    });
  });

  app.post('/reminders', async (request) => {
    const body = bodyOf(request);
    const userId = str(body.userId, 30);
    const channelId = str(body.channelId, 30);
    const content = str(body.content, 1500);
    const dueAt = num(body.dueAt, 0);

    if (!isSnowflake(userId)) throw new PanelError(400, 'Enter a valid user ID.');
    if (!content) throw new PanelError(400, 'Enter a reminder message.');
    if (dueAt <= Date.now()) throw new PanelError(400, 'The reminder time must be in the future.');

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isSendable()) throw new PanelError(400, 'The bot cannot send messages in that channel.');

    const reminder = client.reminderManager.addReminder(userId, channelId, content, dueAt - Date.now());
    audit(ctx, request, 'Created reminder', content.slice(0, 80));
    return reminder;
  });

  app.delete('/reminders/:id', async (request) => {
    const { id } = request.params as { id: string };
    if (!client.reminderManager.removeReminderById(id)) throw new PanelError(404, 'Reminder not found.');
    audit(ctx, request, 'Deleted reminder', id);
    return { ok: true };
  });

  // ---- Messages ----

  app.post('/messages', async (request) => {
    const body = bodyOf(request);
    const channelId = str(body.channelId, 30);
    const content = str(body.content, 2000);
    const embedPayload = typeof body.embed === 'object' && body.embed !== null ? body.embed as EmbedPayload : null;
    const embed = embedPayload ? buildEmbed(embedPayload) : null;

    if (!content && !embed) throw new PanelError(400, 'Write a message or fill in the embed.');

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.isDMBased() || !channel.isSendable()) {
      throw new PanelError(400, 'The bot cannot send messages in that channel.');
    }

    const message = await channel.send({
      content: content || undefined,
      embeds: embed ? [embed] : [],
      allowedMentions: bool(body.allowMentions, false) ? undefined : { parse: [] }
    });

    audit(ctx, request, 'Sent message', `#${'name' in channel ? channel.name : channelId} in ${channel.guild.name}`);
    return { ok: true, url: message.url };
  });
};
