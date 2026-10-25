import { Client, Embed, Message } from 'discord.js';
import { PinboardBoard, PinboardEntry } from '../shared/types';
import { PinboardMetadata, POST_HEADER } from './PinboardManager';
import { isPinboardPost } from './PinboardService';

// Pins made by older versions only stored IDs (or a short preview). This reads each pinboard post
// back once and stores the full message, so the panel never has to ask Discord for it again.
// It also repairs pins of pinboard posts (a post that was pinned again, e.g. from an old pinboard
// channel): those only stored the post's header, so they are pointed back at the real message.

interface Progress {
  running: boolean;
  done: number;
  total: number;
}

const progress = new Map<string, Progress>();
const BATCH = 10;
// Discord errors that won't change on a retry: unknown channel, unknown message, missing access.
const PERMANENT_ERRORS = new Set([10003, 10008, 50001]);

export function backfillStatus(client: Client, boardId: string): { pending: number; running: boolean; done: number; total: number } {
  const state = progress.get(boardId);
  return {
    pending: client.pinboardManager.countMissing(boardId),
    running: !!state?.running,
    done: state?.done ?? 0,
    total: state?.total ?? 0
  };
}

interface PostedMessage {
  channelId?: string;
  messageId?: string;
  authorId?: string;
  authorName: string;
  authorAvatarUrl?: string;
  content: string;
  imageUrl?: string;
}

// The message a pinboard post shows, as written by PinboardService: a jump link, author, text and image.
function readEmbed(embed: Embed | undefined): PostedMessage {
  const description = embed?.description ?? '';
  const jump = /\]\(https:\/\/discord\.com\/channels\/\d+\/(\d+)\/([^)\s/]+)\)/.exec(description);
  const content = description.replace(/^\*\*\[Jump to message!\]\([^)]*\)\*\*\s*/, '');
  const authorAvatarUrl = embed?.author?.iconURL ?? undefined;
  return {
    channelId: jump?.[1],
    messageId: jump?.[2],
    authorId: authorAvatarUrl ? /\/avatars\/(\d+)\//.exec(authorAvatarUrl)?.[1] : undefined,
    authorName: embed?.author?.name ?? 'Unknown author',
    authorAvatarUrl,
    content,
    imageUrl: embed?.image?.url ?? undefined
  };
}

// Reads a board's own pinboard post: "<emoji> **<count>** <#channel>" plus the embed.
function parsePost(post: Message): PinboardMetadata & { reaction?: { emoji: string; display: string; count: number } } {
  const header = /^(.*?)\s*\*\*(\d+)\*\*\s*<#(\d+)>/.exec(post.content);
  const display = header?.[1]?.trim() || undefined;
  const count = header ? Number(header[2]) : undefined;
  const emoji = display ? (/<a?:\w+:(\d+)>/.exec(display)?.[1] ?? display) : undefined;
  const shown = readEmbed(post.embeds[0]);

  return {
    channelId: shown.channelId ?? header?.[3],
    authorId: shown.authorId,
    authorName: shown.authorName,
    authorAvatarUrl: shown.authorAvatarUrl,
    content: shown.content,
    excerpt: shown.content.slice(0, 300),
    imageUrl: shown.imageUrl,
    count,
    emoji,
    emojiDisplay: display,
    reaction: emoji && display && count !== undefined ? { emoji, display, count } : undefined
  };
}

type Fetcher = { messages: { fetch(id: string): Promise<Message> } };

// Fetches a message; `permanent` says whether a failure is final (deleted, no access).
async function fetchMessage(client: Client, channelId: string, messageId: string): Promise<{ message: Message | null; permanent: boolean }> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !('messages' in channel)) return { message: null, permanent: true };
    return { message: await (channel as Fetcher).messages.fetch(messageId), permanent: false };
  } catch (error) {
    return { message: null, permanent: PERMANENT_ERRORS.has((error as { code?: number })?.code ?? 0) };
  }
}

async function fillOne(client: Client, board: PinboardBoard, channel: Fetcher, entry: PinboardEntry): Promise<void> {
  let deleted = false;
  const post = await channel.messages.fetch(entry.pinboardMessageId).catch((error: { code?: number }) => {
    // 10008 = Unknown Message: the pinboard post was deleted, so there is nothing to read back.
    deleted = error?.code === 10008;
    return null;
  });

  if (deleted) {
    // Remember that, so the post isn't requested again.
    client.pinboardManager.setPinboardMessageId(board.id, entry.originalMessageId, entry.pinboardMessageId, {
      authorName: entry.authorName ?? 'Unknown author',
      content: ''
    });
    return;
  }
  if (!post) return;

  const { reaction, ...metadata } = parsePost(post);
  client.pinboardManager.setPinboardMessageId(board.id, entry.originalMessageId, entry.pinboardMessageId, metadata);
  if (reaction && client.pinboardManager.getDetail(board.id, entry.originalMessageId)?.reactions.length === 0) {
    client.pinboardManager.setReactions(board.id, entry.originalMessageId, [reaction]);
  }
}

type RepairResult = 'repaired' | 'duplicate' | 'kept' | 'retry';

// A pin whose "message" is itself a pinboard post: follow the post's jump link to the real message
// and store that one instead. The board's Discord post stays; it updates itself on the next reaction.
async function unwrapRepost(client: Client, board: PinboardBoard, entry: PinboardEntry): Promise<RepairResult> {
  let target: PostedMessage | null = null;
  let channelId = entry.channelId;
  let messageId = entry.originalMessageId;

  // A post of a post of a post is possible, so follow up to three links.
  for (let depth = 0; depth < 3 && channelId; depth++) {
    const { message, permanent } = await fetchMessage(client, channelId, messageId);
    if (!message) {
      if (!permanent) return 'retry';
      break;
    }
    if (!isPinboardPost(message)) break;
    const shown = readEmbed(message.embeds[0]);
    if (!shown.channelId || !shown.messageId || !/^\d+$/.test(shown.messageId)) break;
    target = shown;
    channelId = shown.channelId;
    messageId = shown.messageId;
    if (!POST_HEADER.test(shown.content)) break;
  }

  if (!target?.channelId || !target.messageId) return 'kept';

  if (client.pinboardManager.getEntry(board.id, target.messageId)) {
    // The real message is already pinned on this board; this one was only a copy of it.
    client.pinboardManager.removePinboardMessage(board.id, entry.originalMessageId);
    return 'duplicate';
  }

  // The real message is the best source (current text, author ID); the post's copy is the fallback.
  const { message: original } = await fetchMessage(client, target.channelId, target.messageId);
  const metadata: PinboardMetadata = original ? {
    channelId: original.channelId,
    authorId: original.author.id,
    authorName: original.author.displayName || original.author.tag,
    authorAvatarUrl: original.author.displayAvatarURL(),
    content: original.content,
    excerpt: original.content.slice(0, 300),
    imageUrl: original.attachments.find(a => !!a.contentType?.startsWith('image/'))?.url ?? target.imageUrl
  } : {
    channelId: target.channelId,
    authorId: target.authorId,
    authorName: target.authorName,
    authorAvatarUrl: target.authorAvatarUrl,
    content: target.content,
    excerpt: target.content.slice(0, 300),
    imageUrl: target.imageUrl
  };

  client.pinboardManager.moveEntry(board.id, entry.originalMessageId, target.messageId, metadata);
  return 'repaired';
}

async function repairReposts(client: Client, board: PinboardBoard, state: Progress): Promise<void> {
  const startedAt = Date.now();
  const candidates = client.pinboardManager.repostCandidates(board.id, client.pinboardManager.repostsCheckedAt(board.id), 100_000);
  if (candidates.length === 0) {
    client.pinboardManager.setRepostsCheckedAt(board.id, startedAt);
    return;
  }

  state.total += candidates.length;
  const counts: Record<RepairResult, number> = { repaired: 0, duplicate: 0, kept: 0, retry: 0 };
  for (let i = 0; i < candidates.length; i += BATCH) {
    const results = await Promise.all(candidates.slice(i, i + BATCH).map(entry => unwrapRepost(client, board, entry).catch((): RepairResult => 'retry')));
    for (const result of results) counts[result]++;
    state.done += results.length;
  }

  // Check these again later only when Discord couldn't be asked this time.
  if (counts.retry === 0) client.pinboardManager.setRepostsCheckedAt(board.id, startedAt);
  if (counts.repaired + counts.duplicate > 0) {
    const pins = (n: number) => `${n} ${n === 1 ? 'pin' : 'pins'}`;
    console.log(`📌 "${board.name}": ${pins(counts.repaired)} of pinboard posts now show the real message, ${pins(counts.duplicate)} that copied an existing pin removed.`);
  }
}

// Starts filling in a board's older pins in the background (no-op when already running or done).
export function startBackfill(client: Client, board: PinboardBoard): void {
  if (progress.get(board.id)?.running || !client.guilds.cache.has(board.guildId)) return;

  const missing = client.pinboardManager.missingContent(board.id, 100_000);
  const checkReposts = client.pinboardManager.repostCandidates(board.id, client.pinboardManager.repostsCheckedAt(board.id), 100_000).length > 0;
  if (missing.length === 0 && !checkReposts) return;

  const state: Progress = { running: true, done: 0, total: missing.length };
  progress.set(board.id, state);

  void (async () => {
    try {
      if (missing.length > 0) {
        const channel = await client.channels.fetch(board.channelId).catch(() => null);
        if (channel?.isTextBased() && 'messages' in channel) {
          console.log(`📌 Loading ${missing.length} older pins of "${board.name}" from Discord…`);
          for (let i = 0; i < missing.length; i += BATCH) {
            await Promise.all(missing.slice(i, i + BATCH).map(entry => fillOne(client, board, channel, entry).catch(() => {})));
            state.done = Math.min(missing.length, i + BATCH);
          }
          console.log(`📌 Finished loading older pins of "${board.name}".`);
        }
      }
      await repairReposts(client, board, state);
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
