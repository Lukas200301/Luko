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
import { LoadType } from 'shoukaku';
import { QueueTrack } from '../../utils/QueueManager';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search for songs and choose which one to play')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('Song name to search for')
        .setRequired(true)
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
    const node = interaction.client.shoukaku.options.nodeResolver(interaction.client.shoukaku.nodes);
    
    if (!node) {
      await interaction.editReply('❌ No Lavalink nodes are available right now. Please try again later.');
      return;
    }
    
    try {
      const result = await node.rest.resolve(`ytmsearch:${query}`);
      
      if (!result || result.loadType === LoadType.EMPTY || result.loadType === LoadType.ERROR) {
        await interaction.editReply(`❌ No results found for: **${query}**`);
        return;
      }
      
      const tracks = result.loadType === LoadType.SEARCH && Array.isArray(result.data) ? result.data : [];
      
      if (tracks.length === 0) {
        await interaction.editReply(`❌ No results found for: **${query}**`);
        return;
      }
      
      const options = tracks.slice(0, 10).map((track: any, index: number) => {
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
          
          let queue = interaction.client.queueManager.get(interaction.guildId!);
          
          if (!queue) {
            queue = interaction.client.queueManager.create(interaction.guildId!, interaction.channelId);
          }
          
          const queueTrack: QueueTrack = {
            track: selectedTrack,
            requestedBy: interaction.user.tag,
            title: selectedTrack.info.title,
            uri: selectedTrack.info.uri || '',
            duration: selectedTrack.info.length
          };
          
          queue.add(queueTrack);
          
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
          
          if (!queue.player) {
            const existingPlayer = interaction.client.shoukaku.players.get(interaction.guildId!);
            
            if (!existingPlayer) {
              const newPlayer = await interaction.client.shoukaku.joinVoiceChannel({
                guildId: interaction.guildId!,
                channelId: voiceChannel.id,
                shardId: 0
              });
              queue.player = newPlayer;
            } else {
              queue.player = existingPlayer;
            }
            
            const firstTrack = queue.next();
            if (firstTrack && queue.player) {
              await queue.player.playTrack({ track: { encoded: firstTrack.track.encoded } });
            }
          }
          
          if (queue.player) {
            queue.player.removeAllListeners('end');
            queue.player.removeAllListeners('exception');
            setupPlayerEvents(queue, interaction);
          }
          
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

function setupPlayerEvents(queue: any, interaction: ChatInputCommandInteraction): void {
  queue.player.on('end', async () => {
    if (queue.isDestroying) {
      return;
    }
    
    const previousTrack = queue.current;
    const nextTrack = queue.next();
    
    if (nextTrack) {
      await queue.player.playTrack({ track: { encoded: nextTrack.track.encoded } });
      
      const channel = await interaction.client.channels.fetch(queue.textChannelId);
      if (channel?.isTextBased() && 'send' in channel) {
        const embed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('🎵 Now Playing')
          .setDescription(`**[${nextTrack.title}](${nextTrack.uri})**`)
          .addFields(
            { name: 'Duration', value: formatDuration(nextTrack.duration), inline: true },
            { name: 'Requested by', value: nextTrack.requestedBy, inline: true }
          )
          .setThumbnail(nextTrack.track.info.artworkUrl || null);
        
        await channel.send({ embeds: [embed] });
      }
    } else if (queue.autoplay && previousTrack) {
      try {
        const searchQuery = `ytmsearch:${previousTrack.title}`;
        const node = interaction.client.shoukaku.options.nodeResolver(interaction.client.shoukaku.nodes);
        
        if (node) {
          const result = await node.rest.resolve(searchQuery);
          
          if (result && result.loadType === LoadType.SEARCH && Array.isArray(result.data)) {
            const tracks = result.data;
            
            if (tracks.length > 1) {
              const randomIndex = Math.floor(Math.random() * (Math.min(tracks.length, 5) - 1)) + 1;
              const track = tracks[randomIndex];
              
              const queueTrack: QueueTrack = {
                track,
                requestedBy: 'Autoplay',
                title: track.info.title,
                uri: track.info.uri || '',
                duration: track.info.length
              };
              
              queue.current = queueTrack;
              queue.addToHistory(queueTrack);
              await queue.player.playTrack({ track: { encoded: track.encoded } });
              
              const channel = await interaction.client.channels.fetch(queue.textChannelId);
              if (channel?.isTextBased() && 'send' in channel) {
                const embed = new EmbedBuilder()
                  .setColor(0x9B59B6)
                  .setTitle('🔁 Autoplay')
                  .setDescription(`**[${track.info.title}](${track.info.uri})**`)
                  .addFields(
                    { name: 'Duration', value: formatDuration(track.info.length), inline: true }
                  )
                  .setThumbnail(track.info.artworkUrl || null);
                
                await channel.send({ embeds: [embed] });
              }
              return;
            }
          }
        }
      } catch (error) {
        console.error('Autoplay error:', error);
      }
      
      interaction.client.shoukaku.leaveVoiceChannel(interaction.guildId!);
      interaction.client.queueManager.delete(interaction.guildId!);
    } else {
      interaction.client.shoukaku.leaveVoiceChannel(interaction.guildId!);
      interaction.client.queueManager.delete(interaction.guildId!);
    }
  });
  
  queue.player.on('exception', (data: any) => {
    console.error('Player exception:', data);
  });
}

function formatDuration(ms: number): string {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
