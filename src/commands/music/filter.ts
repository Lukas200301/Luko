import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags
} from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';
import { FilterOptions } from 'shoukaku';

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
    let filters: FilterOptions = {};
    let filterName = '';
    
    try {
      switch (filterType) {
        case 'none':
          filters = {};
          filterName = 'No filter';
          break;
          
        case 'nightcore':
          filters = {
            timescale: { speed: 1.3, pitch: 1.3, rate: 1.0 }
          };
          filterName = 'Nightcore';
          break;
          
        case 'vaporwave':
          filters = {
            timescale: { speed: 0.8, pitch: 0.8, rate: 1.0 },
            equalizer: [
              { band: 0, gain: 0.3 },
              { band: 1, gain: 0.3 }
            ]
          };
          filterName = 'Vaporwave';
          break;
          
        case 'bassboost':
          filters = {
            equalizer: [
              { band: 0, gain: 0.6 },
              { band: 1, gain: 0.67 },
              { band: 2, gain: 0.67 },
              { band: 3, gain: 0.4 }
            ]
          };
          filterName = 'Bassboost';
          break;
          
        case '8d':
          filters = {
            rotation: { rotationHz: 0.2 }
          };
          filterName = '8D Audio';
          break;
          
        case 'karaoke':
          filters = {
            karaoke: {
              level: 1.0,
              monoLevel: 1.0,
              filterBand: 220.0,
              filterWidth: 100.0
            }
          };
          filterName = 'Karaoke';
          break;
          
        case 'tremolo':
          filters = {
            tremolo: {
              frequency: 4.0,
              depth: 0.75
            }
          };
          filterName = 'Tremolo';
          break;
          
        default:
          await interaction.reply({
            content: '❌ Invalid filter type!',
            flags: MessageFlags.Ephemeral
          });
          return;
      }
      
      await queue.player.setFilters(filters);
      
      if (filterType === 'none') {
        await interaction.reply('🎵 Removed all filters!');
      } else {
        await interaction.reply(`🎛️ Applied **${filterName}** filter!`);
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
