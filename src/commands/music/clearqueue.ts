import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags
} from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('clearqueue')
    .setDescription('Clear all tracks from the queue (keeps current track playing)'),
  
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
    
    if (queue.size() === 0) {
      await interaction.reply({
        content: '❌ The queue is already empty!',
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
    
    const count = queue.size();
    queue.clear();
    
    await interaction.reply(`🗑️ Cleared **${count}** track${count === 1 ? '' : 's'} from the queue!`);
  }
};
