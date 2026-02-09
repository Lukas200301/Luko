import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags
} from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move a track to a different position in the queue')
    .addIntegerOption(option =>
      option
        .setName('from')
        .setDescription('Current position of the track')
        .setRequired(true)
        .setMinValue(1)
    )
    .addIntegerOption(option =>
      option
        .setName('to')
        .setDescription('New position for the track')
        .setRequired(true)
        .setMinValue(1)
    ),
  
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel;
    
    if (!voiceChannel) {
      await interaction.reply({ 
        content: '❌ You need to be in a voice channel to use this command!',
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    
    const queue = interaction.client.queueManager.get(interaction.guildId!);
    
    if (!queue) {
      await interaction.reply({
        content: '❌ There is no queue!',
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    
    const botVoiceChannel = interaction.guild?.members.me?.voice.channel;
    if (botVoiceChannel && voiceChannel.id !== botVoiceChannel.id) {
      await interaction.reply({
        content: '❌ You need to be in the same voice channel as me!',
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    
    const from = interaction.options.getInteger('from', true) - 1; 
    const to = interaction.options.getInteger('to', true) - 1; 
    
    if (from < 0 || from >= queue.size() || to < 0 || to >= queue.size()) {
      await interaction.reply({
        content: `❌ Invalid position! The queue has **${queue.size()}** track${queue.size() === 1 ? '' : 's'}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    
    const track = queue.tracks[from];
    const success = queue.move(from, to);
    
    if (success) {
      await interaction.reply(`✅ Moved **${track.title}** from position **${from + 1}** to **${to + 1}**!`);
    } else {
      await interaction.reply({
        content: '❌ Failed to move track!',
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
