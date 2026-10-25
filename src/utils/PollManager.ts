import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits
} from 'discord.js';
import { randomBytes } from 'node:crypto';
import { db, transaction } from './Database';
import { PollInfo } from '../shared/types';

// Button polls: everyone clicks an option, the message shows live results, and the poll ends
// at its end time, with the End button (creator or Manage Messages) or from the panel.

export const MAX_POLL_OPTIONS = 10;
const CHECK_INTERVAL = 20_000;
const BAR_WIDTH = 14;

interface PollRow {
  id: string;
  guild_id: string | null;
  channel_id: string;
  message_id: string | null;
  question: string;
  options: string;
  multiple: number;
  anonymous: number;
  creator_id: string;
  creator_name: string;
  created_at: number;
  ends_at: number | null;
  ended_at: number | null;
}

const statements = {
  insert: db.prepare(`
    INSERT INTO polls (id, guild_id, channel_id, question, options, multiple, anonymous, creator_id, creator_name, created_at, ends_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  setMessage: db.prepare('UPDATE polls SET message_id = ? WHERE id = ?'),
  get: db.prepare('SELECT * FROM polls WHERE id = ?'),
  list: db.prepare('SELECT * FROM polls ORDER BY ended_at IS NOT NULL, created_at DESC LIMIT ?'),
  due: db.prepare('SELECT * FROM polls WHERE ended_at IS NULL AND ends_at IS NOT NULL AND ends_at <= ?'),
  end: db.prepare('UPDATE polls SET ended_at = ? WHERE id = ? AND ended_at IS NULL'),
  delete: db.prepare('DELETE FROM polls WHERE id = ?'),
  counts: db.prepare('SELECT option, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY option'),
  voters: db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM poll_votes WHERE poll_id = ?'),
  votersOf: db.prepare('SELECT user_id, option FROM poll_votes WHERE poll_id = ? ORDER BY voted_at'),
  userVotes: db.prepare('SELECT option FROM poll_votes WHERE poll_id = ? AND user_id = ?'),
  addVote: db.prepare('INSERT OR IGNORE INTO poll_votes (poll_id, user_id, option, voted_at) VALUES (?, ?, ?, ?)'),
  removeVote: db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option = ?'),
  clearUserVotes: db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?'),
  deleteVotes: db.prepare('DELETE FROM poll_votes WHERE poll_id = ?')
};

export interface NewPoll {
  guildId: string | null;
  channelId: string;
  question: string;
  options: string[];
  multiple: boolean;
  anonymous: boolean;
  creatorId: string;
  creatorName: string;
  endsAt: number | null;
}

export class PollManager {
  private timer: NodeJS.Timeout | null = null;

  constructor(private client: Client) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.endDue().catch(error => console.error('❌ Ending polls failed:', error)), CHECK_INTERVAL);
  }

  create(poll: NewPoll): PollInfo {
    const id = randomBytes(5).toString('hex');
    statements.insert.run(id, poll.guildId, poll.channelId, poll.question, JSON.stringify(poll.options), poll.multiple ? 1 : 0,
      poll.anonymous ? 1 : 0, poll.creatorId, poll.creatorName, Date.now(), poll.endsAt);
    return this.get(id)!;
  }

  setMessage(id: string, messageId: string): void {
    statements.setMessage.run(messageId, id);
  }

  private row(id: string): PollRow | undefined {
    return statements.get.get(id) as PollRow | undefined;
  }

  get(id: string): PollInfo | null {
    const row = this.row(id);
    return row ? this.toInfo(row) : null;
  }

  list(limit = 100): PollInfo[] {
    return (statements.list.all(limit) as unknown as PollRow[]).map(row => this.toInfo(row));
  }

  private toInfo(row: PollRow): PollInfo {
    const labels = JSON.parse(row.options) as string[];
    const counts = new Map((statements.counts.all(row.id) as Array<{ option: number; n: number }>).map(c => [c.option, c.n]));
    const guild = row.guild_id ? this.client.guilds.cache.get(row.guild_id) : undefined;
    const channel = this.client.channels.cache.get(row.channel_id);
    return {
      id: row.id,
      guildId: row.guild_id,
      guildName: guild?.name ?? null,
      channelId: row.channel_id,
      channelName: channel && 'name' in channel ? channel.name : null,
      messageId: row.message_id,
      question: row.question,
      options: labels.map((label, i) => ({ label, votes: counts.get(i) ?? 0 })),
      multiple: !!row.multiple,
      anonymous: !!row.anonymous,
      creatorId: row.creator_id,
      creatorName: row.creator_name,
      createdAt: row.created_at,
      endsAt: row.ends_at,
      endedAt: row.ended_at,
      voters: (statements.voters.get(row.id) as { n: number }).n
    };
  }

  // The poll message: results as bars, and one button per option (plus End) while it runs.
  render(poll: PollInfo): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
    const total = poll.options.reduce((sum, o) => sum + o.votes, 0);
    const top = Math.max(...poll.options.map(o => o.votes));
    const ended = poll.endedAt !== null;

    const votersByOption = new Map<number, string[]>();
    if (!poll.anonymous) {
      for (const vote of statements.votersOf.all(poll.id) as Array<{ user_id: string; option: number }>) {
        votersByOption.set(vote.option, [...(votersByOption.get(vote.option) ?? []), `<@${vote.user_id}>`]);
      }
    }

    const lines = poll.options.map((option, i) => {
      const percent = total ? Math.round((option.votes / total) * 100) : 0;
      const filled = total ? Math.round((option.votes / total) * BAR_WIDTH) : 0;
      const winner = ended && top > 0 && option.votes === top ? ' 🏆' : '';
      const voters = votersByOption.get(i);
      const who = voters ? `\n-# ${voters.slice(0, 15).join(' ')}${voters.length > 15 ? ` +${voters.length - 15}` : ''}` : '';
      return `**${i + 1}. ${option.label}**${winner}\n\`${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}\` ${option.votes} (${percent}%)${who}`;
    });

    const details = [
      poll.anonymous ? '🔒 Anonymous' : '👀 Votes are public',
      poll.multiple ? 'Multiple choice' : 'One choice',
      `${poll.voters} ${poll.voters === 1 ? 'voter' : 'voters'}`
    ].join(' · ');
    const timing = ended
      ? `Ended <t:${Math.floor(poll.endedAt! / 1000)}:R>`
      : poll.endsAt ? `Ends <t:${Math.floor(poll.endsAt / 1000)}:R>` : 'Runs until it is ended';

    const embed = new EmbedBuilder()
      .setColor(ended ? 0x4F545C : 0x5865F2)
      .setTitle(`📊 ${poll.question}`.slice(0, 256))
      .setDescription(`${lines.join('\n\n')}\n\n${timing}`.slice(0, 4096))
      .setFooter({ text: `${details} · by ${poll.creatorName}` });

    if (ended) return { embeds: [embed], components: [] };

    const buttons = poll.options.map((option, i) => new ButtonBuilder()
      .setCustomId(`poll:${poll.id}:vote:${i}`)
      .setLabel(`${i + 1}. ${option.label}`.slice(0, 80))
      .setStyle(ButtonStyle.Secondary));
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`poll:${poll.id}:end`).setLabel('End poll').setEmoji('🏁').setStyle(ButtonStyle.Danger)
    ));
    return { embeds: [embed], components: rows };
  }

  // Adds or removes a vote. With one choice, a new vote replaces the old one.
  vote(id: string, userId: string, option: number): 'added' | 'removed' | 'changed' {
    const current = (statements.userVotes.all(id, userId) as Array<{ option: number }>).map(v => v.option);
    const poll = this.row(id)!;
    let result: 'added' | 'removed' | 'changed' = 'added';

    transaction(db, () => {
      if (current.includes(option)) {
        statements.removeVote.run(id, userId, option);
        result = 'removed';
        return;
      }
      if (!poll.multiple && current.length > 0) {
        statements.clearUserVotes.run(id, userId);
        result = 'changed';
      }
      statements.addVote.run(id, userId, option, Date.now());
    });
    return result;
  }

  // Ends a poll and updates its message. Returns false if it had already ended.
  async end(id: string): Promise<boolean> {
    if (statements.end.run(Date.now(), id).changes === 0) return false;
    const poll = this.get(id)!;
    await this.refreshMessage(poll);

    const channel = await this.client.channels.fetch(poll.channelId).catch(() => null);
    if (channel?.isSendable() && poll.messageId) {
      const top = Math.max(...poll.options.map(o => o.votes));
      const winners = poll.options.filter(o => o.votes === top && top > 0).map(o => `**${o.label}**`);
      const text = winners.length === 0 ? 'Nobody voted.' : winners.length === 1 ? `${winners[0]} won with ${top} ${top === 1 ? 'vote' : 'votes'}.` : `It's a tie between ${winners.join(' and ')} (${top} each).`;
      await channel.send({
        content: `🏁 The poll **${poll.question}** has ended. ${text}`,
        reply: { messageReference: poll.messageId, failIfNotExists: false },
        allowedMentions: { parse: [] }
      }).catch(() => {});
    }
    return true;
  }

  async delete(id: string): Promise<void> {
    const poll = this.get(id);
    transaction(db, () => {
      statements.deleteVotes.run(id);
      statements.delete.run(id);
    });
    if (poll?.messageId) {
      const channel = await this.client.channels.fetch(poll.channelId).catch(() => null);
      if (channel?.isTextBased() && 'messages' in channel) await channel.messages.delete(poll.messageId).catch(() => {});
    }
  }

  private async refreshMessage(poll: PollInfo): Promise<void> {
    if (!poll.messageId) return;
    const channel = await this.client.channels.fetch(poll.channelId).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel)) return;
    const message = await channel.messages.fetch(poll.messageId).catch(() => null);
    await message?.edit(this.render(poll)).catch(() => {});
  }

  private async endDue(): Promise<void> {
    if (!this.client.isReady()) return;
    for (const row of statements.due.all(Date.now()) as unknown as PollRow[]) {
      await this.end(row.id);
    }
  }

  async handleButton(interaction: ButtonInteraction): Promise<void> {
    const [, id, action, value] = interaction.customId.split(':');
    const poll = this.get(id);

    if (!poll || poll.endedAt) {
      await interaction.reply({ content: '🏁 This poll has ended.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (action === 'end') {
      const canEnd = interaction.user.id === poll.creatorId
        || interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)
        || interaction.user.id === process.env.OWNER_ID;
      if (!canEnd) {
        await interaction.reply({ content: '❌ Only the person who started the poll (or someone with Manage Messages) can end it.', flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferUpdate();
      await this.end(id);
      return;
    }

    const option = Number(value);
    if (action !== 'vote' || !Number.isInteger(option) || option < 0 || option >= poll.options.length) return;

    const result = this.vote(id, interaction.user.id, option);
    await interaction.update(this.render(this.get(id)!));
    const label = poll.options[option].label;
    const feedback = result === 'removed' ? `↩️ Removed your vote for **${label}**.` : result === 'changed' ? `🔄 Changed your vote to **${label}**.` : `✅ You voted for **${label}**.`;
    await interaction.followUp({ content: `${feedback}${result !== 'removed' ? ' Click it again to take it back.' : ''}`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }
}
