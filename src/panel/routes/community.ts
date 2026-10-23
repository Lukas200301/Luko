import { Client, EmbedBuilder, resolveColor } from 'discord.js';
import { RouteRegistrar, PanelError, audit, bodyOf, bool, isSnowflake, num, str } from '../context';
import { EmbedPayload, EmojiInfo, PinboardBoard, PinboardBoardStatus, PinboardEntry, ReminderInfo } from '../../shared/types';

const BACKFILL_BATCH = 20;

// Entries pinned by older versions only stored message IDs. Their author, text and image
// can be read back from the pinboard post itself, which is what this does (a few at a time).
async function backfillBoard(client: Client, board: PinboardBoard, entries: PinboardEntry[]): Promise<number> {
  const missing = entries.filter(e => e.boardId === board.id && !e.authorName).slice(0, BACKFILL_BATCH);
  if (missing.length === 0) return 0;

  const channel = await client.channels.fetch(board.channelId).catch(() => null);
  if (!channel?.isTextBased() || !('messages' in channel)) return 0;

  let filled = 0;
  await Promise.all(missing.map(async (entry) => {
    const message = await channel.messages.fetch(entry.pinboardMessageId).catch(() => null);
    const embed = message?.embeds[0];
    if (!message || !embed) return;

    const excerpt = (embed.description ?? '').replace(/^\*\*\[Jump to message!\]\([^)]*\)\*\*\s*/, '').slice(0, 300);
    client.pinboardManager.setPinboardMessageId(board.id, entry.originalMessageId, entry.pinboardMessageId, {
      channelId: /<#(\d+)>/.exec(message.content)?.[1],
      authorName: embed.author?.name ?? 'Unknown User',
      authorAvatarUrl: embed.author?.iconURL ?? undefined,
      excerpt,
      imageUrl: embed.image?.url ?? undefined,
      count: Number(/\*\*(\d+)\*\*/.exec(message.content)?.[1]) || undefined,
      pinnedAt: message.createdTimestamp
    });
    filled++;
  }));

  return filled;
}

function boardStatus(client: Client, board: PinboardBoard): PinboardBoardStatus {
  const guild = client.guilds.cache.get(board.guildId);
  const channel = guild?.channels.cache.get(board.channelId);
  return {
    ...board,
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

  app.get('/pinboard', async () => {
    const settings = client.settings.get();
    const boards = settings.pinboard.boards;

    let entries = client.pinboardManager.getEntries();
    let filled = 0;
    for (const board of boards) {
      if (client.guilds.cache.has(board.guildId)) filled += await backfillBoard(client, board, entries);
    }
    if (filled > 0) entries = client.pinboardManager.getEntries();

    return {
      enabled: settings.features.pinboard,
      boards: boards.map(board => boardStatus(client, board)),
      entries
    };
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
