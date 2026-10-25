import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ComponentType
} from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';
import {
  formatDuration,
  MUSIC_SOURCE_CHOICES,
  MusicSource,
  resolveTracks,
  startPlayback,
  toQueueTrack
} from '../../utils/MusicService';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search for songs across platforms and choose which one to play')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('Song name to search for')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('source')
        .setDescription('Platform to search on (default: Auto)')
        .setRequired(false)
        .addChoices(...MUSIC_SOURCE_CHOICES)
    ),
  
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.guild?.members.cache.get(interaction.user.id);
    const voiceChannel = member?.voice.channel;
    
    if (!voiceChannel) {
      await interaction.reply({
        content: '❌ You need to be in a voice channel to search for music!',
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    
    await interaction.deferReply();
    
    const query = interaction.options.getString('query', true);
    const source = (interaction.options.getString('source') as MusicSource | null) ?? 'auto';
    if (!interaction.client.shoukaku) {
      await interaction.editReply('❌ The music system is currently unavailable.');
      return;
    }
    
    const node = interaction.client.shoukaku.getIdealNode();
    
    if (!node) {
      await interaction.editReply('❌ No Lavalink nodes are available right now. Please try again later.');
      return;
    }
    
    try {
      const resolved = await resolveTracks(interaction.client, query, source);
      
      if (!resolved || resolved.tracks.length === 0) {
        await interaction.editReply(`❌ No results found for: **${query}**`);
        return;
      }
      
      const tracks = resolved.tracks;
      
      const options = tracks.slice(0, 10).map((track, index) => {
        let label = track.info.title;
        let description = track.info.author || 'Unknown artist';
        
        const duration = formatDuration(track.info.length);
        description += ` • ${duration}`;
        
        if (label.length > 100) {
          label = label.substring(0, 97) + '...';
        }
        if (description.length > 100) {
          description = description.substring(0, 97) + '...';
        }
        
        return new StringSelectMenuOptionBuilder()
          .setLabel(label)
          .setDescription(description)
          .setValue(index.toString())
          .setEmoji('🎵');
      });
      
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('search-select')
        .setPlaceholder('Choose a song to play')
        .addOptions(options);
      
      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
      
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🔍 Search Results')
        .setDescription(`Found **${tracks.length}** results for: **${query}**\n\nSelect a song from the menu below:`)
        .setFooter({ text: 'Selection expires in 60 seconds' });
      
      const response = await interaction.editReply({
        embeds: [embed],
        components: [row]
      });
      
      try {
        const collector = response.createMessageComponentCollector({
          componentType: ComponentType.StringSelect,
          time: 60000
        });
        
        collector.on('collect', async (i) => {
          if (i.user.id !== interaction.user.id) {
            await i.reply({
              content: '❌ This search menu is not for you!',
              flags: MessageFlags.Ephemeral
            });
            return;
          }
          
          const selectedIndex = parseInt(i.values[0]);
          const selectedTrack = tracks[selectedIndex];
          
          const { queue } = await startPlayback(interaction.client, {
            guildId: interaction.guildId!,
            shardId: interaction.guild!.shardId,
            voiceChannelId: voiceChannel.id,
            textChannelId: interaction.channelId,
            tracks: [toQueueTrack(selectedTrack, interaction.user.tag, interaction.user.id)]
          });
          
          const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Added to Queue')
            .setDescription(`**[${selectedTrack.info.title}](${selectedTrack.info.uri})**`)
            .addFields(
              { name: 'Duration', value: formatDuration(selectedTrack.info.length), inline: true },
              { name: 'Position', value: `${queue.size()}`, inline: true },
              { name: 'Requested by', value: interaction.user.tag, inline: true }
            )
            .setThumbnail(selectedTrack.info.artworkUrl || null)
            .setTimestamp();
          
          await i.update({ embeds: [embed], components: [] });
          
          collector.stop();
        });
        
        collector.on('end', async (collected) => {
          if (collected.size === 0) {
            await interaction.editReply({
              content: '⏱️ Search timed out. Please use `/search` again.',
              embeds: [],
              components: []
            });
          }
        });
      } catch (error) {
        console.error('Selection error:', error);
        await interaction.editReply({
          content: '❌ An error occurred while processing your selection.',
          embeds: [],
          components: []
        });
      }
    } catch (error) {
      console.error('Error searching:', error);
      await interaction.editReply('❌ An error occurred while searching for tracks.');
    }
  }
};
