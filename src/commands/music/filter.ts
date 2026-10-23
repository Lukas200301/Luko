import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags
} from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';
import { FILTER_PRESETS } from '../../utils/MusicService';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('filter')
    .setDescription('Apply audio filters to the music')
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Filter to apply')
        .setRequired(true)
        .addChoices(
          { name: 'None - Remove all filters', value: 'none' },
          { name: 'Nightcore - Speed up and pitch up', value: 'nightcore' },
          { name: 'Vaporwave - Slow down and pitch down', value: 'vaporwave' },
          { name: 'Bassboost - Enhance bass frequencies', value: 'bassboost' },
          { name: '8D Audio - Rotating audio effect', value: '8d' },
          { name: 'Karaoke - Reduce vocals', value: 'karaoke' },
          { name: 'Tremolo - Vibrato effect', value: 'tremolo' }
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
    
    const filterType = interaction.options.getString('type', true);
    const preset = FILTER_PRESETS[filterType];
    
    if (!preset) {
      await interaction.reply({
        content: '❌ Invalid filter type!',
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    
    try {
      await queue.player.setFilters(preset.filters);
      queue.filter = filterType;
      
      if (filterType === 'none') {
        await interaction.reply('🎵 Removed all filters!');
      } else {
        await interaction.reply(`🎛️ Applied **${preset.label}** filter!`);
      }
    } catch (error) {
      console.error('Filter error:', error);
      await interaction.reply({
        content: '❌ Failed to apply filter! Make sure your Lavalink server supports filters.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
