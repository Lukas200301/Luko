import { Client, Message } from 'discord.js';
import { PinboardBoard, PinboardEntry } from '../shared/types';
import { PinboardMetadata } from './PinboardManager';

// Pins made by older versions only stored IDs (or a short preview). This reads each pinboard post
// back once and stores the full message, so the panel never has to ask Discord for it again.

interface Progress {
  running: boolean;
  done: number;
  total: number;
}

const progress = new Map<string, Progress>();
const BATCH = 10;

export function backfillStatus(client: Client, boardId: string): { pending: number; running: boolean; done: number; total: number } {
  const state = progress.get(boardId);
  return {
    pending: client.pinboardManager.countMissing(boardId),
    running: !!state?.running,
    done: state?.done ?? 0,
    total: state?.total ?? 0
  };
}

// Reads a pinboard post as written by PinboardService: "<emoji> **<count>** <#channel>" plus an embed.
function parsePost(post: Message, entry: PinboardEntry): PinboardMetadata & { reaction?: { emoji: string; display: string; count: number } } {
  const embed = post.embeds[0];
  const header = /^(.*?)\s*\*\*(\d+)\*\*\s*<#(\d+)>/.exec(post.content);
  const display = header?.[1]?.trim() || undefined;
  const count = header ? Number(header[2]) : undefined;
  const emoji = display ? (/<a?:\w+:(\d+)>/.exec(display)?.[1] ?? display) : undefined;

  const description = embed?.description ?? '';
  const jump = /\]\(https:\/\/discord\.com\/channels\/\d+\/(\d+)\/[^)\s]+\)/.exec(description);
  const content = description.replace(/^\*\*\[Jump to message!\]\([^)]*\)\*\*\s*/, '');
  const authorAvatarUrl = embed?.author?.iconURL ?? undefined;

  return {
    channelId: jump?.[1] ?? header?.[3],
    authorId: authorAvatarUrl ? /\/avatars\/(\d+)\//.exec(authorAvatarUrl)?.[1] : undefined,
    authorName: embed?.author?.name ?? 'Unknown author',
    authorAvatarUrl,
    content,
    excerpt: content.slice(0, 300),
    imageUrl: embed?.image?.url ?? undefined,
    count,
    emoji,
    emojiDisplay: display,
    pinnedAt: entry.pinnedAt ?? post.createdTimestamp,
    reaction: emoji && display && count !== undefined ? { emoji, display, count } : undefined
  };
}

async function fillOne(client: Client, board: PinboardBoard, channel: { messages: { fetch(id: string): Promise<Message> } }, entry: PinboardEntry): Promise<void> {
  let deleted = false;
  const post = await channel.messages.fetch(entry.pinboardMessageId).catch((error: { code?: number }) => {
    // 10008 = Unknown Message: the pinboard post was deleted, so there is nothing to read back.
    deleted = error?.code === 10008;
    return null;
  });

  if (deleted) {
    // Remember that, so the post isn't requested again. 0 keeps an unknown pin date at the end.
    client.pinboardManager.setPinboardMessageId(board.id, entry.originalMessageId, entry.pinboardMessageId, {
      authorName: entry.authorName ?? 'Unknown author',
      content: '',
      pinnedAt: entry.pinnedAt ?? 0
    });
    return;
  }
  if (!post) return;

  const { reaction, ...metadata } = parsePost(post, entry);
  client.pinboardManager.setPinboardMessageId(board.id, entry.originalMessageId, entry.pinboardMessageId, metadata);
  if (reaction && client.pinboardManager.getDetail(board.id, entry.originalMessageId)?.reactions.length === 0) {
    client.pinboardManager.setReactions(board.id, entry.originalMessageId, [reaction]);
  }
}

// Starts filling in a board's older pins in the background (no-op when already running or done).
export function startBackfill(client: Client, board: PinboardBoard): void {
  if (progress.get(board.id)?.running || !client.guilds.cache.has(board.guildId)) return;

  const missing = client.pinboardManager.missingContent(board.id, 100_000);
  if (missing.length === 0) return;

  const state: Progress = { running: true, done: 0, total: missing.length };
  progress.set(board.id, state);

  void (async () => {
    try {
      const channel = await client.channels.fetch(board.channelId).catch(() => null);
      if (!channel?.isTextBased() || !('messages' in channel)) return;

      console.log(`📌 Loading ${missing.length} older pins of "${board.name}" from Discord…`);
      for (let i = 0; i < missing.length; i += BATCH) {
        await Promise.all(missing.slice(i, i + BATCH).map(entry => fillOne(client, board, channel, entry).catch(() => {})));
        state.done = Math.min(missing.length, i + BATCH);
      }
      console.log(`📌 Finished loading older pins of "${board.name}".`);
    } catch (error) {
      console.error(`❌ Loading older pins of "${board.name}" failed:`, error);
    } finally {
      state.running = false;
    }
  })();
}

export function startAllBackfills(client: Client): void {
  for (const board of client.settings.get().pinboard.boards) {
    startBackfill(client, board);
  }
}
