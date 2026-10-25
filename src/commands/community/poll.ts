import { ChatInputCommandInteraction, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';
import { MAX_POLL_OPTIONS } from '../../utils/PollManager';
import { parseDuration } from '../../utils/time';

const MAX_DURATION = 30 * 24 * 60 * 60 * 1000;

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Start a poll with buttons and live results')
    .setContexts(InteractionContextType.Guild)
    .addStringOption(option => option.setName('question').setDescription('What to ask').setRequired(true).setMaxLength(200))
    .addStringOption(option => option
      .setName('options')
      .setDescription(`2-${MAX_POLL_OPTIONS} answers, separated by | (for example: Pizza | Burger | Sushi)`)
      .setRequired(true)
      .setMaxLength(1000))
    .addStringOption(option => option.setName('duration').setDescription('How long it runs, e.g. 30m, 2h, 1d (default: until ended)'))
    .addBooleanOption(option => option.setName('multiple').setDescription('Allow picking more than one answer (default: no)'))
    .addBooleanOption(option => option.setName('anonymous').setDescription('Hide who voted for what (default: yes)')),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const question = interaction.options.getString('question', true).trim();
    const raw = interaction.options.getString('options', true);
    const options = [...new Set((raw.includes('|') ? raw.split('|') : raw.split(',')).map(o => o.trim()).filter(Boolean))]
      .map(o => o.slice(0, 70));

    if (options.length < 2 || options.length > MAX_POLL_OPTIONS) {
      await interaction.reply({ content: `❌ A poll needs 2 to ${MAX_POLL_OPTIONS} different answers, separated by \`|\`.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const durationText = interaction.options.getString('duration');
    const duration = durationText ? parseDuration(durationText) : null;
    if (durationText && (!duration || duration < 60_000 || duration > MAX_DURATION)) {
      await interaction.reply({ content: '❌ Use a duration between 1 minute and 30 days, like `30m`, `2h` or `1d`.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (!interaction.channel?.isSendable()) {
      await interaction.reply({ content: "❌ I can't post in this channel.", flags: MessageFlags.Ephemeral });
      return;
    }

    const polls = interaction.client.polls;
    const poll = polls.create({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      question,
      options,
      multiple: interaction.options.getBoolean('multiple') ?? false,
      anonymous: interaction.options.getBoolean('anonymous') ?? true,
      creatorId: interaction.user.id,
      creatorName: interaction.user.displayName,
      endsAt: duration ? Date.now() + duration : null
    });

    const reply = await interaction.reply({ ...polls.render(poll), withResponse: true });
    if (reply.resource?.message) polls.setMessage(poll.id, reply.resource.message.id);
  }
};
