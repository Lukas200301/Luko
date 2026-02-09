import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags
} from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Toggle loop mode')
    .addStringOption(option =>
      option
        .setName('mode')
        .setDescription('Loop mode')
        .setRequired(false)
        .addChoices(
          { name: 'Track - Loop current track', value: 'track' },
          { name: 'Queue - Loop entire queue', value: 'queue' },
          { name: 'Off - Disable loop', value: 'off' }
        )
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
    
    if (!queue || !queue.player) {
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
    
    const mode = interaction.options.getString('mode');
    
    if (mode === 'track') {
      queue.loop = true;
      queue.queueLoop = false;
      await interaction.reply('🔂 **Track loop** enabled. The current track will repeat.');
    } else if (mode === 'queue') {
      queue.loop = false;
      queue.queueLoop = true;
      await interaction.reply('🔁 **Queue loop** enabled. The queue will repeat.');
    } else if (mode === 'off') {
      queue.loop = false;
      queue.queueLoop = false;
      await interaction.reply('➡️ Loop mode **disabled**.');
    } else {
      queue.loop = !queue.loop;
      if (queue.loop) {
        queue.queueLoop = false;
      }
      await interaction.reply(
        queue.loop 
          ? '🔂 **Track loop** enabled. The current track will repeat.' 
          : '➡️ Loop mode **disabled**.'
      );
    }
  }
};
