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
import { PinboardBoard, PinboardEmoji } from '../shared/types';

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

// Picks the reaction with the most votes among those that reached their threshold.
async function bestReaction(board: PinboardBoard, message: Message): Promise<QualifyingReaction | null> {
  let best: QualifyingReaction | null = null;

  for (const reaction of message.reactions.cache.values()) {
    const config = emojiConfig(board, reaction);
    if (!config) continue;

    const count = await reactionCount(board, reaction, message);
    const threshold = config.threshold ?? board.threshold;
    if (count >= threshold && (!best || count > best.count)) {
      best = { reaction, config, count };
    }
  }

  return best;
}

function isIgnoredChannel(board: PinboardBoard, message: Message): boolean {
  if (message.channelId === board.channelId) return true;
  const parentId = message.channel.isThread() ? message.channel.parentId : null;
  return board.ignoredChannelIds.includes(message.channelId) || (!!parentId && board.ignoredChannelIds.includes(parentId));
}

function buildEmbed(message: Message): { embed: EmbedBuilder; imageUrl: string | null } {
  const embed = new EmbedBuilder()
    .setColor(0xFEEA3B)
    .setAuthor({
      name: message.author?.displayName || message.author?.tag || 'Unknown User',
      iconURL: message.author?.displayAvatarURL() || undefined
    })
    .setDescription(`**[Jump to message!](${message.url})**\n\n${message.content || ''}`)
    .setFooter({ text: `#${'name' in message.channel ? message.channel.name : 'unknown'} • Today at ${message.createdAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}` });

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
async function updateBoard(client: Client, board: PinboardBoard, message: Message): Promise<void> {
  if (isIgnoredChannel(board, message)) return;
  if (board.ignoreBotMessages && message.author?.bot) return;

  const targetChannel = await client.channels.fetch(board.channelId).catch(() => null);
  if (!targetChannel?.isTextBased() || !('messages' in targetChannel) || !targetChannel.isSendable()) return;

  const existingId = client.pinboardManager.getPinboardMessageId(board.id, message.id);
  const best = await bestReaction(board, message);

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
    authorName: message.author?.displayName || message.author?.tag || 'Unknown User',
    authorAvatarUrl: message.author?.displayAvatarURL() || undefined,
    excerpt: (message.content || '').slice(0, 300),
    imageUrl: imageUrl || undefined,
    count: best.count
  };

  if (existingId) {
    try {
      const pinboardMsg = await targetChannel.messages.fetch(existingId);
      await pinboardMsg.edit({ content: topText, embeds: [embed] });
      client.pinboardManager.setPinboardMessageId(board.id, message.id, existingId, metadata);
      return;
    } catch {
      // The pinboard post was deleted by hand; post it again below.
    }
  }

  const newMsg = await targetChannel.send({ content: topText, embeds: [embed] });
  client.pinboardManager.setPinboardMessageId(board.id, message.id, newMsg.id, metadata);
}

export async function refreshPinboards(client: Client, partialMessage: Message | PartialMessage): Promise<void> {
  const settings = client.settings.get();
  if (!settings.features.pinboard || !partialMessage.guildId) return;

  const boards = settings.pinboard.boards.filter(b => b.enabled && b.channelId && b.guildId === partialMessage.guildId);
  if (boards.length === 0) return;

  try {
    const message = partialMessage.partial ? await partialMessage.fetch() : partialMessage;
    for (const board of boards) {
      await updateBoard(client, board, message);
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
}
