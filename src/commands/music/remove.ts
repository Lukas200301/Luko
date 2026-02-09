import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags
} from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a track from the queue')
    .addIntegerOption(option =>
      option
        .setName('position')
        .setDescription('Position of the track in the queue (1 = next track)')
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
    
    const position = interaction.options.getInteger('position', true);
    const index = position - 1; 
    
    if (index < 0 || index >= queue.size()) {
      await interaction.reply({
        content: `❌ Invalid position! The queue has **${queue.size()}** track${queue.size() === 1 ? '' : 's'}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    
    const removed = queue.remove(index);
    
    if (removed) {
      await interaction.reply(`🗑️ Removed **${removed.title}** from the queue!`);
    } else {
      await interaction.reply({
        content: '❌ Failed to remove track!',
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
