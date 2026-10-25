import { ChatInputCommandInteraction, InteractionContextType, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';
import { MONTHS, formatBirthday } from '../../utils/BirthdayManager';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Birthdays on this server')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Save your birthday, so the bot congratulates you')
      .addIntegerOption(option => option.setName('day').setDescription('Day (1-31)').setRequired(true).setMinValue(1).setMaxValue(31))
      .addIntegerOption(option => option
        .setName('month')
        .setDescription('Month')
        .setRequired(true)
        .addChoices(...MONTHS.map((name, i) => ({ name, value: i + 1 }))))
      .addIntegerOption(option => option.setName('year').setDescription('Year of birth (optional, shows your age)').setMinValue(1900).setMaxValue(new Date().getFullYear())))
    .addSubcommand(sub => sub.setName('remove').setDescription('Remove your birthday'))
    .addSubcommand(sub => sub
      .setName('show')
      .setDescription("Show someone's birthday")
      .addUserOption(option => option.setName('user').setDescription('Whose birthday (default: yours)')))
    .addSubcommand(sub => sub.setName('upcoming').setDescription('The next birthdays on this server')),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) return;
    const birthdays = interaction.client.birthdays;
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const day = interaction.options.getInteger('day', true);
      const month = interaction.options.getInteger('month', true);
      const year = interaction.options.getInteger('year');
      try {
        birthdays.set(interaction.guildId, interaction.user.id, interaction.user.displayName, day, month, year);
      } catch (error) {
        await interaction.reply({ content: `❌ ${error instanceof Error ? error.message : error}`, flags: MessageFlags.Ephemeral });
        return;
      }
      const channelSet = !!interaction.client.settings.get().birthdays.channels[interaction.guildId];
      await interaction.reply({
        content: `🎂 Saved your birthday: **${formatBirthday(day, month, year)}**.${channelSet ? '' : '\n-# No birthday channel is set for this server yet, so nobody gets congratulated. An admin can choose one in the panel.'}`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (sub === 'remove') {
      const removed = birthdays.remove(interaction.guildId, interaction.user.id);
      await interaction.reply({ content: removed ? '🗑️ Your birthday was removed.' : "You haven't saved a birthday on this server.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'show') {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const info = birthdays.get(interaction.guildId, user.id);
      if (!info) {
        await interaction.reply({
          content: user.id === interaction.user.id ? "You haven't saved a birthday yet. Use `/birthday set`." : `${user.displayName} hasn't saved a birthday.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      const when = `<t:${Math.floor(info.nextAt / 1000)}:R>`;
      await interaction.reply({
        content: `🎂 **${user.displayName}**: ${formatBirthday(info.day, info.month)}. Next birthday ${when}${info.nextAge ? `, turning **${info.nextAge}**` : ''}.`,
        allowedMentions: { parse: [] }
      });
      return;
    }

    const upcoming = birthdays.list(interaction.guildId).slice(0, 15);
    if (upcoming.length === 0) {
      await interaction.reply({ content: 'No birthdays saved on this server yet. Add yours with `/birthday set`.', flags: MessageFlags.Ephemeral });
      return;
    }
    const lines = upcoming.map(b => `**${formatBirthday(b.day, b.month)}** · <@${b.userId}>${b.nextAge ? ` (${b.nextAge})` : ''} · <t:${Math.floor(b.nextAt / 1000)}:R>`);
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xEB459E).setTitle('🎂 Upcoming birthdays').setDescription(lines.join('\n'))],
      allowedMentions: { parse: [] }
    });
  }
};
