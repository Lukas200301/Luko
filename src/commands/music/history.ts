import { ChatInputCommandInteraction, EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';
import { formatDuration } from '../../utils/MusicService';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Recently played songs and the most played ones on this server')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.client.settings.get().features.musicHistory) {
      await interaction.reply({ content: 'The music history is switched off.', flags: MessageFlags.Ephemeral });
      return;
    }

    const history = interaction.client.musicHistory;
    const recent = history.page({ range: 'all', guildId: interaction.guildId!, limit: 10, offset: 0 });
    if (recent.total === 0) {
      await interaction.reply({ content: 'Nothing has been played on this server yet.', flags: MessageFlags.Ephemeral });
      return;
    }

    const link = (title: string, uri: string | null) => (uri ? `[${title}](${uri})` : title);
    const top = history.topTracks('30d', interaction.guildId!, 5);

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🕘 Music history')
        .addFields(
          {
            name: 'Recently played',
            value: recent.plays.map(p => `<t:${Math.floor(p.playedAt / 1000)}:R> ${link(p.title, p.uri)} · ${formatDuration(p.duration)}`).join('\n').slice(0, 1024)
          },
          {
            name: 'Most played (30 days)',
            value: top.map((t, i) => `\`${i + 1}.\` ${link(t.title, t.uri)} · ${t.plays}×`).join('\n').slice(0, 1024) || 'Nothing yet'
          }
        )
        .setFooter({ text: `${recent.total.toLocaleString()} songs played on this server` })],
      allowedMentions: { parse: [] }
    });
  }
};
