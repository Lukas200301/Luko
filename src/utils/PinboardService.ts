import {
  Client,
  EmbedBuilder,
  Message,
  MessageReaction,
  PartialMessage,
  PartialMessageReaction,
  PartialUser,
  User
} from 'discord.js';
import { PinboardBoard, PinboardEmoji, PinboardReaction } from '../shared/types';
import { startAllBackfills } from './PinboardBackfill';

interface QualifyingReaction {
  reaction: MessageReaction;
  config: PinboardEmoji;
  count: number;
}

function emojiKey(reaction: MessageReaction): string | null {
  return reaction.emoji.id || reaction.emoji.name;
}

// The emoji config for a reaction on this board, or null when the reaction doesn't count.
// A board without emojis counts every emoji with the board's default threshold.
function emojiConfig(board: PinboardBoard, reaction: MessageReaction): PinboardEmoji | null {
  const key = emojiKey(reaction);
  if (!key) return null;
  if (board.emojis.length === 0) return { emoji: key, display: '', threshold: null };
  return board.emojis.find(e => e.emoji === key) ?? null;
}

async function reactionCount(board: PinboardBoard, reaction: MessageReaction, message: Message): Promise<number> {
  let count = reaction.count ?? 0;
  if (board.ignoreSelfReactions && message.author && count > 0) {
    const users = await reaction.users.fetch().catch(() => null);
    if (users?.has(message.author.id)) count--;
  }
  return count;
}

// All reactions that count on this board, with their counts.
async function countedReactions(board: PinboardBoard, message: Message): Promise<QualifyingReaction[]> {
  const counted: QualifyingReaction[] = [];
  for (const reaction of message.reactions.cache.values()) {
    const config = emojiConfig(board, reaction);
    if (!config) continue;
    counted.push({ reaction, config, count: await reactionCount(board, reaction, message) });
  }
  return counted;
}

// Picks the reaction with the most votes among those that reached their threshold.
function bestReaction(board: PinboardBoard, counted: QualifyingReaction[]): QualifyingReaction | null {
  let best: QualifyingReaction | null = null;
  for (const candidate of counted) {
    const threshold = candidate.config.threshold ?? board.threshold;
    if (candidate.count >= threshold && (!best || candidate.count > best.count)) {
      best = candidate;
    }
  }
  return best;
}

// Pinboard channels (of any board) and the board's ignored channels.
function isIgnoredChannel(board: PinboardBoard, boards: PinboardBoard[], message: Message): boolean {
  if (boards.some(b => b.channelId === message.channelId)) return true;
  const parentId = message.channel.isThread() ? message.channel.parentId : null;
  return board.ignoredChannelIds.includes(message.channelId) || (!!parentId && board.ignoredChannelIds.includes(parentId));
}

// A pinboard post written by this or another Luko bot, also in an old pinboard channel.
// Pinning those again only copies the header ("⭐ **5** #channel") and loses the real message.
export function isPinboardPost(message: Message): boolean {
  return !!message.author?.bot
    && /\*\*\d+\*\*\s*<#\d+>/.test(message.content)
    && !!message.embeds[0]?.description?.startsWith('**[Jump to message!](');
}

function buildEmbed(message: Message): { embed: EmbedBuilder; imageUrl: string | null } {
  const embed = new EmbedBuilder()
    .setColor(0xFEEA3B)
    .setAuthor({
      name: message.author?.displayName || message.author?.tag || 'Unknown User',
      iconURL: message.author?.displayAvatarURL() || undefined
    })
    .setDescription(`**[Jump to message!](${message.url})**\n\n${message.content || ''}`)
    .setFooter({ text: `#${'name' in message.channel ? message.channel.name : 'unknown'}` })
    // Discord shows this in each reader's own time zone ("Today at …", "Yesterday at …", or the date).
    .setTimestamp(message.createdAt);

  let imageUrl: string | null = message.attachments.find(a => !!a.contentType?.startsWith('image/'))?.url ?? null;

  if (!imageUrl) {
    for (const e of message.embeds) {
      if (e.data.image?.url) {
        imageUrl = e.data.image.url;
        break;
      } else if (e.data.thumbnail?.url) {
        imageUrl = e.data.thumbnail.url;
        break;
      }
    }
  }

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  return { embed, imageUrl };
}

function displayEmoji(best: QualifyingReaction): string {
  if (best.config.display) return best.config.display;
  const emoji = best.reaction.emoji;
  if (emoji.id) return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
  return emoji.name || '📌';
}

// Creates, updates or removes the post for one message on one board.
async function updateBoard(client: Client, board: PinboardBoard, boards: PinboardBoard[], message: Message): Promise<void> {
  if (isIgnoredChannel(board, boards, message) || isPinboardPost(message)) return;
  if (board.ignoreBotMessages && message.author?.bot) return;

  const targetChannel = await client.channels.fetch(board.channelId).catch(() => null);
  if (!targetChannel?.isTextBased() || !('messages' in targetChannel) || !targetChannel.isSendable()) return;

  const existingId = client.pinboardManager.getPinboardMessageId(board.id, message.id);
  const counted = await countedReactions(board, message);
  const best = bestReaction(board, counted);

  if (!best) {
    if (existingId) {
      await targetChannel.messages.delete(existingId).catch(() => {});
      client.pinboardManager.removePinboardMessage(board.id, message.id);
    }
    return;
  }

  const { embed, imageUrl } = buildEmbed(message);
  const topText = `${displayEmoji(best)} **${best.count}** <#${message.channel.id}>`;
  const metadata = {
    channelId: message.channel.id,
    authorId: message.author?.id,
    authorName: message.author?.displayName || message.author?.tag || 'Unknown User',
    authorAvatarUrl: message.author?.displayAvatarURL() || undefined,
    excerpt: (message.content || '').slice(0, 300),
    content: message.content || '',
    imageUrl: imageUrl || undefined,
    count: best.count,
    emoji: emojiKey(best.reaction) ?? undefined,
    emojiDisplay: displayEmoji(best),
    messageCreatedAt: message.createdTimestamp
  };
  const reactions: PinboardReaction[] = counted
    .filter(c => c.count > 0)
    .map(c => ({ emoji: emojiKey(c.reaction) ?? '?', display: displayEmoji(c), count: c.count }));

  if (existingId) {
    try {
      const pinboardMsg = await targetChannel.messages.fetch(existingId);
      await pinboardMsg.edit({ content: topText, embeds: [embed] });
      client.pinboardManager.setPinboardMessageId(board.id, message.id, existingId, metadata);
      client.pinboardManager.setReactions(board.id, message.id, reactions);
      return;
    } catch {
      // The pinboard post was deleted by hand; post it again below.
    }
  }

  const newMsg = await targetChannel.send({ content: topText, embeds: [embed] });
  client.pinboardManager.setPinboardMessageId(board.id, message.id, newMsg.id, metadata);
  client.pinboardManager.setReactions(board.id, message.id, reactions);
}

export async function refreshPinboards(client: Client, partialMessage: Message | PartialMessage): Promise<void> {
  const settings = client.settings.get();
  if (!settings.features.pinboard || !partialMessage.guildId) return;

  const boards = settings.pinboard.boards.filter(b => b.enabled && b.channelId && b.guildId === partialMessage.guildId);
  if (boards.length === 0) return;

  try {
    const message = partialMessage.partial ? await partialMessage.fetch() : partialMessage;
    for (const board of boards) {
      await updateBoard(client, board, settings.pinboard.boards, message);
    }
  } catch (error) {
    console.error('Error handling pinboard reaction:', error);
  }
}

export async function handlePinboardReaction(
  client: Client,
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser
): Promise<void> {
  if (user.bot) return;

  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('Something went wrong when fetching the reaction:', error);
      return;
    }
  }

  await refreshPinboards(client, reaction.message);
}

export function registerPinboard(client: Client): void {
  client.on('messageReactionAdd', (reaction, user) => handlePinboardReaction(client, reaction, user));
  client.on('messageReactionRemove', (reaction, user) => handlePinboardReaction(client, reaction, user));
  client.on('messageReactionRemoveAll', (message) => refreshPinboards(client, message));
  client.on('messageReactionRemoveEmoji', (reaction) => refreshPinboards(client, reaction.message));

  // Store the full message of pins made by older versions, once, in the background.
  client.once('clientReady', () => setTimeout(() => startAllBackfills(client), 15_000));
  client.settings.on('change', (section: string) => {
    if (section === 'pinboard' && client.isReady()) startAllBackfills(client);
  });
}
