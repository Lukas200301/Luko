import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  GuildMember,
  EmbedBuilder,
  MessageFlags
} from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';
import { LoadType } from 'shoukaku';
import { QueueTrack } from '../../utils/QueueManager';

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song from YouTube, Spotify, or SoundCloud')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('Song name or URL')
        .setRequired(true)
        .setAutocomplete(true)
    ),
  
  async autocomplete(interaction: any): Promise<void> {
    const focusedValue = interaction.options.getFocused();
    
    if (!focusedValue || focusedValue.length < 2 || focusedValue.startsWith('http')) {
      await interaction.respond([]);
      return;
    }
    
    try {
      const node = interaction.client.shoukaku.options.nodeResolver(interaction.client.shoukaku.nodes);
      
      if (!node) {
        await interaction.respond([]);
        return;
      }
      
      const result = await node.rest.resolve(`ytmsearch:${focusedValue}`);
      
      if (result && result.loadType === LoadType.SEARCH && Array.isArray(result.data)) {
        const choices = result.data.slice(0, 10).map((track: any) => {
          let name = track.info.title;
          if (track.info.author) {
            name = `${track.info.title} - ${track.info.author}`;
          }
          if (name.length > 100) {
            name = name.substring(0, 97) + '...';
          }
          
          return {
            name: name,
            value: track.info.uri || track.info.title
          };
        });
        
        await interaction.respond(choices);
      } else {
        await interaction.respond([]);
      }
    } catch (error) {
      console.error('Autocomplete error:', error);
      await interaction.respond([]);
    }
  },
  
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();
    
    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel;
    
    if (!voiceChannel) {
      await interaction.editReply('❌ You need to be in a voice channel to play music!');
      return;
    }
    
    const permissions = voiceChannel.permissionsFor(interaction.client.user!);
    if (!permissions?.has(['Connect', 'Speak'])) {
      await interaction.editReply('❌ I need permissions to join and speak in your voice channel!');
      return;
    }
    
    const query = interaction.options.getString('query', true);
    const node = interaction.client.shoukaku.options.nodeResolver(interaction.client.shoukaku.nodes);
    
    if (!node) {
      await interaction.editReply('❌ No Lavalink nodes are available right now. Please try again later.');
      return;
    }
    
    let searchQuery = query;
    if (!query.startsWith('http')) {
      searchQuery = `ytmsearch:${query}`; 
    }
    
    try {
      const result = await node.rest.resolve(searchQuery);
      
      if (!result || result.loadType === LoadType.EMPTY || result.loadType === LoadType.ERROR) {
        await interaction.editReply(`❌ No results found for: **${query}**\n\n💡 **Tip:** Try using a direct YouTube/Spotify URL for best results.`);
        return;
      }
      
      const tracks = result.loadType === LoadType.PLAYLIST ? result.data.tracks : 
                     result.loadType === LoadType.SEARCH ? result.data : 
                     result.loadType === LoadType.TRACK ? [result.data] : [];
      
      if (tracks.length === 0) {
        await interaction.editReply(`❌ No results found for: **${query}**`);
        return;
      }
      
      let queue = interaction.client.queueManager.get(interaction.guildId!);
      
      if (!queue) {
        queue = interaction.client.queueManager.create(interaction.guildId!, interaction.channelId);
      }
      
      if (result.loadType === LoadType.PLAYLIST) {
        for (const track of tracks) {
          const queueTrack: QueueTrack = {
            track,
            requestedBy: interaction.user.tag,
            title: track.info.title,
            uri: track.info.uri || '',
            duration: track.info.length
          };
          queue.add(queueTrack);
        }
        
        const embed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('📃 Playlist Added')
          .setDescription(`Added **${tracks.length}** tracks from **${result.data.info.name}**`)
          .setFooter({ text: `Requested by ${interaction.user.tag}` })
          .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
      } else {
        const track = tracks[0];
        const queueTrack: QueueTrack = {
          track,
          requestedBy: interaction.user.tag,
          title: track.info.title,
          uri: track.info.uri || '',
          duration: track.info.length
        };
        
        queue.add(queueTrack);
        
        const embed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('✅ Added to Queue')
          .setDescription(`**[${track.info.title}](${track.info.uri})**`)
          .addFields(
            { name: 'Duration', value: formatDuration(track.info.length), inline: true },
            { name: 'Position', value: `${queue.size()}`, inline: true },
            { name: 'Requested by', value: interaction.user.tag, inline: true }
          )
          .setThumbnail(track.info.artworkUrl || null)
          .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
      }
      
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
        
        queue.player.on('end', async (reason: any) => {
          console.log('🎵 Track ended. Reason:', reason);
          console.log('🔄 Autoplay enabled:', queue!.autoplay);
          console.log('📝 Queue size:', queue!.size());
          console.log('🚫 Is destroying:', queue!.isDestroying);
          
          if (queue!.isDestroying) {
            console.log('⏹️ Queue is being destroyed, skipping track end logic');
            return;
          }
          
          const previousTrack = queue!.current;
          const nextTrack = queue!.next();
          
          if (nextTrack) {
            console.log('▶️ Playing next track:', nextTrack.title);
            await queue!.player!.playTrack({ track: { encoded: nextTrack.track.encoded } });
            
            const channel = await interaction.client.channels.fetch(queue!.textChannelId);
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
          } else if (queue!.autoplay && previousTrack) {
            console.log('🔁 Attempting autoplay for:', previousTrack.title);
            try {
              const searchQuery = `ytmsearch:${previousTrack.title}`;
              const node = interaction.client.shoukaku.options.nodeResolver(interaction.client.shoukaku.nodes);
              
              if (!node) {
                console.log('❌ No Lavalink node available for autoplay');
                interaction.client.shoukaku.leaveVoiceChannel(interaction.guildId!);
                interaction.client.queueManager.delete(interaction.guildId!);
                return;
              }
              
              console.log('🔍 Searching for autoplay track...');
              const result = await node.rest.resolve(searchQuery);
              console.log('📊 Search result loadType:', result?.loadType);
              
              if (result && result.loadType === LoadType.SEARCH && Array.isArray(result.data)) {
                const tracks = result.data;
                console.log('📋 Found', tracks.length, 'tracks for autoplay');
                
                if (tracks.length > 1) {
                  const randomIndex = Math.floor(Math.random() * (Math.min(tracks.length, 5) - 1)) + 1;
                  const track = tracks[randomIndex];
                  
                  console.log('✅ Selected autoplay track:', track.info.title);
                  
                  const queueTrack: QueueTrack = {
                    track,
                    requestedBy: 'Autoplay',
                    title: track.info.title,
                    uri: track.info.uri || '',
                    duration: track.info.length
                  };
                  
                  queue!.current = queueTrack;
                  queue!.addToHistory(queueTrack);
                  await queue!.player!.playTrack({ track: { encoded: track.encoded } });
                  
                  const channel = await interaction.client.channels.fetch(queue!.textChannelId);
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
                } else {
                  console.log('⚠️ Not enough tracks for autoplay');
                }
              } else {
                console.log('❌ Invalid search result for autoplay');
              }
            } catch (error) {
              console.error('❌ Autoplay error:', error);
            }
            
            console.log('👋 Autoplay failed, leaving voice channel');
            interaction.client.shoukaku.leaveVoiceChannel(interaction.guildId!);
            interaction.client.queueManager.delete(interaction.guildId!);
          } else {
            console.log('👋 Queue empty, leaving voice channel');
            interaction.client.shoukaku.leaveVoiceChannel(interaction.guildId!);
            interaction.client.queueManager.delete(interaction.guildId!);
          }
        });
        
        queue.player.on('exception', (data: any) => {
          console.error('Player exception:', data);
        });
      }
    } catch (error) {
      console.error('Error playing track:', error);
      
      let errorMsg = '❌ An error occurred while trying to play the track.';
      
      if (error instanceof Error) {
        const errorString = error.message || error.toString();
        
        if (errorString.includes('AllClientsFailedException') || errorString.includes('signature') || errorString.includes('sig function')) {
          errorMsg = '⚠️ **YouTube is currently having issues.**\n\n';
          errorMsg += '**Temporary Solutions:**\n';
          errorMsg += '• Use a **SoundCloud** link instead\n';
          errorMsg += '• Try a different song\n';
          errorMsg += '• Use a direct YouTube URL (may work better)\n\n';
          errorMsg += '**For Developers:**\n';
          errorMsg += '• Update YouTube plugin to latest version\n';
          errorMsg += '• Check `YOUTUBE_FIX.md` for details';
        } else if (errorString.includes('429') || errorString.includes('rate limit')) {
          errorMsg = '⚠️ **Rate limited by YouTube.**\n\n';
          errorMsg += 'Please wait a few minutes and try again, or use SoundCloud links instead.';
        } else if (errorString.includes('EMPTY') || errorString.includes('No matches')) {
          errorMsg = '❌ No results found for: **' + query + '**\n\n';
          errorMsg += '💡 **Tips:**\n';
          errorMsg += '• Check your spelling\n';
          errorMsg += '• Try using a direct URL\n';
          errorMsg += '• Use SoundCloud: paste a soundcloud.com link';
        }
      }
      
      await interaction.editReply(errorMsg);
    }
  }
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
