import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags
} from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Seek to a specific timestamp in the current track')
    .addStringOption(option =>
      option
        .setName('time')
        .setDescription('Time to seek to (format: mm:ss or seconds)')
        .setRequired(true)
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
    
    if (!queue || !queue.player || !queue.current) {
      await interaction.reply({
        content: '❌ There is no music playing right now!',
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
    
    const timeInput = interaction.options.getString('time', true);
    let milliseconds: number;
    
    if (timeInput.includes(':')) {
      const parts = timeInput.split(':').map(p => parseInt(p));
      if (parts.length === 2) {
        milliseconds = (parts[0] * 60 + parts[1]) * 1000;
      } else if (parts.length === 3) {
        milliseconds = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
      } else {
        await interaction.reply({
          content: '❌ Invalid time format! Use mm:ss, hh:mm:ss, or seconds.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
    } else {
      const seconds = parseInt(timeInput);
      if (isNaN(seconds)) {
        await interaction.reply({
          content: '❌ Invalid time format! Use mm:ss, hh:mm:ss, or seconds.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      milliseconds = seconds * 1000;
    }
    
    if (milliseconds < 0 || milliseconds > queue.current.duration) {
      await interaction.reply({
        content: `❌ Invalid seek position! Track duration is ${formatDuration(queue.current.duration)}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    
    try {
      await queue.player.seekTo(milliseconds);
      await interaction.reply(`⏩ Seeked to **${formatDuration(milliseconds)}**`);
    } catch (error) {
      console.error('Seek error:', error);
      await interaction.reply({
        content: '❌ Failed to seek! This track may not support seeking.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
};

function formatDuration(ms: number): string {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
