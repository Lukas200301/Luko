import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  GuildMember,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ComponentType
} from 'discord.js';
import { SlashCommand } from '../../interfaces/Command';
import { QueueTrack } from '../../utils/QueueManager';
import { LoadType } from 'shoukaku';

interface MusicBrainzRecording {
  id: string;
  title: string;
  'artist-credit': Array<{
    artist: {
      name: string;
    };
  }>;
  'first-release-date'?: string;
}

interface MusicBrainzResponse {
  recordings: MusicBrainzRecording[];
  count: number;
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const subGenres: Record<string, Array<{ label: string; value: string; description: string }>> = {
  rock: [
    { label: 'Classic Rock', value: 'classic rock', description: '60s-80s rock legends' },
    { label: 'Alternative Rock', value: 'alternative rock', description: '90s-2000s alternative' },
    { label: 'Indie Rock', value: 'indie rock', description: 'Independent rock music' },
    { label: 'Punk Rock', value: 'punk rock', description: 'Fast, aggressive rock' },
    { label: 'Hard Rock', value: 'hard rock', description: 'Heavy, amplified sound' },
    { label: 'Progressive Rock', value: 'progressive rock', description: 'Complex compositions' },
    { label: 'Grunge', value: 'grunge', description: '90s Seattle sound' },
    { label: 'Post-Rock', value: 'post-rock', description: 'Experimental rock' }
  ],
  pop: [
    { label: 'Pop Rock', value: 'pop rock', description: 'Rock with pop sensibilities' },
    { label: 'Synth Pop', value: 'synth pop', description: 'Synthesizer-driven pop' },
    { label: 'Dance Pop', value: 'dance pop', description: 'Upbeat, danceable pop' },
    { label: 'Indie Pop', value: 'indie pop', description: 'Independent pop music' },
    { label: 'K-Pop', value: 'k-pop', description: 'Korean pop music' },
    { label: 'J-Pop', value: 'j-pop', description: 'Japanese pop music' },
    { label: 'Electropop', value: 'electropop', description: 'Electronic pop fusion' },
    { label: 'Teen Pop', value: 'teen pop', description: 'Youth-oriented pop' }
  ],
  electronic: [
    { label: 'Techno', value: 'techno', description: 'Repetitive electronic beats' },
    { label: 'Hard Techno', value: 'hard techno', description: 'Harder, faster techno' },
    { label: 'Uptempo', value: 'uptempo', description: '160+ BPM electronic' },
    { label: 'House', value: 'house', description: '4/4 beat dance music' },
    { label: 'Trance', value: 'trance', description: 'Euphoric electronic' },
    { label: 'Drum & Bass', value: 'drum and bass', description: 'Fast breakbeats' },
    { label: 'Dubstep', value: 'dubstep', description: 'Wobble bass electronic' }
  ],
  'hip-hop': [
    { label: 'Trap', value: 'trap', description: 'Heavy 808s and hi-hats' },
    { label: 'Boom Bap', value: 'boom bap', description: 'Classic hip-hop beats' },
    { label: 'West Coast', value: 'west coast hip-hop', description: 'California hip-hop' },
    { label: 'East Coast', value: 'east coast hip-hop', description: 'NY/East hip-hop' },
    { label: 'Cloud Rap', value: 'cloud rap', description: 'Ethereal, dreamy rap' },
    { label: 'Drill', value: 'drill', description: 'Dark, aggressive rap' },
    { label: 'Underground Hip-Hop', value: 'underground hip-hop', description: 'Independent rap' },
    { label: 'Conscious Hip-Hop', value: 'conscious hip-hop', description: 'Socially aware rap' }
  ],
  jazz: [
    { label: 'Bebop', value: 'bebop', description: 'Fast tempo jazz' },
    { label: 'Smooth Jazz', value: 'smooth jazz', description: 'Mellow, radio-friendly' },
    { label: 'Jazz Fusion', value: 'jazz fusion', description: 'Jazz meets rock/funk' },
    { label: 'Free Jazz', value: 'free jazz', description: 'Experimental jazz' },
    { label: 'Swing', value: 'swing', description: '30s-40s dance jazz' },
    { label: 'Latin Jazz', value: 'latin jazz', description: 'Latin rhythm jazz' },
    { label: 'Cool Jazz', value: 'cool jazz', description: 'Relaxed, subdued jazz' },
    { label: 'Modal Jazz', value: 'modal jazz', description: 'Scale-based jazz' }
  ],
  metal: [
    { label: 'Heavy Metal', value: 'heavy metal', description: 'Classic metal sound' },
    { label: 'Thrash Metal', value: 'thrash metal', description: 'Fast, aggressive metal' },
    { label: 'Death Metal', value: 'death metal', description: 'Extreme metal' },
    { label: 'Black Metal', value: 'black metal', description: 'Dark, atmospheric metal' },
    { label: 'Power Metal', value: 'power metal', description: 'Epic, melodic metal' },
    { label: 'Progressive Metal', value: 'progressive metal', description: 'Complex metal' },
    { label: 'Metalcore', value: 'metalcore', description: 'Metal and hardcore punk' },
    { label: 'Doom Metal', value: 'doom metal', description: 'Slow, heavy metal' }
  ],
  classical: [
    { label: 'Baroque', value: 'baroque', description: '1600-1750 era' },
    { label: 'Romantic', value: 'romantic classical', description: '1800s emotional music' },
    { label: 'Modern Classical', value: 'modern classical', description: 'Contemporary classical' },
    { label: 'Chamber Music', value: 'chamber music', description: 'Small ensemble music' },
    { label: 'Symphony', value: 'symphony', description: 'Orchestral compositions' },
    { label: 'Opera', value: 'opera', description: 'Classical vocal drama' },
    { label: 'Minimalist', value: 'minimalist', description: 'Repetitive patterns' },
    { label: 'Contemporary Classical', value: 'contemporary classical', description: 'Modern compositions' }
  ]
};

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('songoftheday')
    .setDescription('📅 Discover and play a song from music history!'),

  execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
    if (!interaction.guild || !interaction.guildId) {
      await interaction.reply({ content: '❌ This command can only be used in a server!', ephemeral: true });
      return;
    }

    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      await interaction.reply({
        content: '❌ You need to be in a voice channel to use this command!',
        ephemeral: true
      });
      return;
    }

    const permissions = voiceChannel.permissionsFor(interaction.client.user);
    if (!permissions?.has(['Connect', 'Speak'])) {
      await interaction.reply({
        content: '❌ I need permissions to join and speak in your voice channel!',
        ephemeral: true
      });
      return;
    }

    const genreMenu = new StringSelectMenuBuilder()
      .setCustomId('genre_select')
      .setPlaceholder('🎼 Select a music genre...')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('✨ Surprise Me (Random)')
          .setDescription('Let fate decide your song!')
          .setValue('random')
          .setEmoji('🎲'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Rock')
          .setDescription('Classic rock, alternative, indie')
          .setValue('rock')
          .setEmoji('🎸'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Pop')
          .setDescription('Popular music, mainstream hits')
          .setValue('pop')
          .setEmoji('🎤'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Electronic')
          .setDescription('EDM, techno, house')
          .setValue('electronic')
          .setEmoji('🎧'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Hip-Hop')
          .setDescription('Rap, hip-hop, trap')
          .setValue('hip-hop')
          .setEmoji('🎵'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Jazz')
          .setDescription('Smooth jazz, bebop, fusion')
          .setValue('jazz')
          .setEmoji('🎷'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Metal')
          .setDescription('Heavy metal, thrash, progressive')
          .setValue('metal')
          .setEmoji('🤘'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Classical')
          .setDescription('Orchestral, baroque, romantic')
          .setValue('classical')
          .setEmoji('🎻')
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(genreMenu);

    const menuEmbed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📅 Song of the Day')
      .setDescription('Choose a genre to discover a song from music history!\n\nOr pick "Surprise Me" for a random genre.')
      .setFooter({ text: 'Menu expires in 30 seconds' })
      .setTimestamp();

    await interaction.reply({
      embeds: [menuEmbed],
      components: [row]
    });

    const collector = interaction.channel?.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id && i.customId === 'genre_select',
      componentType: ComponentType.StringSelect,
      time: 30000
    });

    if (!collector) {
      await interaction.editReply({ content: '❌ Failed to create menu collector!', embeds: [], components: [] });
      return;
    }

    async function searchAndPlay(
      interaction: ChatInputCommandInteraction,
      voiceChannel: any,
      genreToSearch: string,
      isRandom: boolean,
      genreLabel: string,
      mainGenre?: string
    ) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setDescription(`🔍 ${isRandom ? `Searching for a random ${genreLabel} song` : `Searching for ${genreLabel} songs`} from music history...`)
        ],
        components: []
      });

      try {
        const tagName = genreToSearch.toLowerCase();
        const query = `tag:"${tagName}"`;
        const musicBrainzUrl = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=100&offset=${Math.floor(Math.random() * 200)}`;
        
        console.log('🔍 MusicBrainz Query:', musicBrainzUrl);
        console.log('🎸 Searching for genre:', genreToSearch);

        const response = await fetch(musicBrainzUrl, {
          headers: {
            'User-Agent': 'LukoDiscordBot/1.0 (https://github.com/Lukas200301/luko)'
          }
        });

        if (!response.ok) {
          throw new Error(`MusicBrainz API error: ${response.status}`);
        }

        const data = await response.json() as MusicBrainzResponse;

        if (!data.recordings || data.recordings.length === 0) {
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xFF0000)
                .setDescription(`❌ No ${genreLabel} songs found. Try a different genre!`)
            ]
          });
          return;
        }

        const randomIndex = Math.floor(Math.random() * Math.min(data.recordings.length, 100));
        const selectedSong = data.recordings[randomIndex];

        const songTitle = selectedSong.title;
        const artistName = selectedSong['artist-credit']?.[0]?.artist?.name || 'Unknown Artist';
        const releaseDate = selectedSong['first-release-date'];
        const releaseYear = releaseDate ? releaseDate.split('-')[0] : 'Unknown';
        const searchQuery = `${artistName} ${songTitle}`;

        console.log('🎵 Selected song:', searchQuery);

        const node = interaction.client.shoukaku.options.nodeResolver(interaction.client.shoukaku.nodes);
        if (!node) {
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xFF0000)
                .setDescription('❌ Music system is not available. Please try again later.')
            ]
          });
          return;
        }

        const result = await node.rest.resolve(`ytmsearch:${searchQuery}`);

        if (!result || result.loadType === LoadType.EMPTY || result.loadType === LoadType.ERROR) {
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('🎵 Song Not Available')
                .setDescription(`Found **${songTitle}** by **${artistName}**, but couldn't find a playable version on YouTube.`)
                .addFields({
                  name: '💡 Suggestion',
                  value: `Try searching manually: \`/play ${searchQuery}\``
                })
            ]
          });
          return;
        }

        const tracks = result.loadType === LoadType.SEARCH ? result.data : 
                       result.loadType === LoadType.TRACK ? [result.data] : [];

        if (tracks.length === 0) {
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xFF0000)
                .setDescription(`❌ Found **${songTitle}** by **${artistName}**, but couldn't find a playable version.`)
            ]
          });
          return;
        }

        let queue = interaction.client.queueManager.get(interaction.guildId!);
        if (!queue) {
          queue = interaction.client.queueManager.create(interaction.guildId!, interaction.channelId);
        }

        const track = tracks[0];
        const queueTrack: QueueTrack = {
          track,
          requestedBy: interaction.user.tag,
          title: track.info.title,
          uri: track.info.uri || '',
          duration: track.info.length
        };
        queue.add(queueTrack);

        if (!queue.player) {
          const existingPlayer = interaction.client.shoukaku.players.get(interaction.guildId!);
          
          if (!existingPlayer) {
            try {
              const newPlayer = await interaction.client.shoukaku.joinVoiceChannel({
                guildId: interaction.guildId!,
                channelId: voiceChannel.id,
                shardId: 0
              });
              queue.player = newPlayer;
            } catch (error: any) {
              console.error('Failed to join voice channel:', error);
              await interaction.editReply({
                embeds: [
                  new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setDescription('❌ Failed to join voice channel!')
                ]
              });
              return;
            }
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
            
            if (queue!.isDestroying) {
              console.log('⏹️ Queue is being destroyed, skipping track end logic');
              return;
            }
            
            const previousTrack = queue!.current;
            const nextTrack = queue!.next();

            if (nextTrack) {
              try {
                await queue!.player!.playTrack({ track: { encoded: nextTrack.track.encoded } });
                
                const channel = await interaction.client.channels.fetch(queue!.textChannelId);
                if (channel?.isTextBased() && 'send' in channel) {
                  await channel.send({
                    embeds: [
                      new EmbedBuilder()
                        .setColor(0x5865F2)
                        .setDescription(`▶️ Now playing: **${nextTrack.title}**`)
                        .addFields({
                          name: 'Duration',
                          value: formatDuration(nextTrack.duration)
                        })
                    ]
                  });
                }
              } catch (error) {
                console.error('Failed to play next track:', error);
              }
            } else if (queue!.autoplay && previousTrack) {
              try {
                const node = interaction.client.shoukaku.options.nodeResolver(interaction.client.shoukaku.nodes);
                if (!node) return;

                const autoplayResult = await node.rest.resolve(`ytmsearch:${previousTrack.title}`);
                
                if (autoplayResult && autoplayResult.loadType === LoadType.SEARCH && autoplayResult.data.length > 1) {
                  const relatedTrack = autoplayResult.data[1];
                  
                  const autoplayTrack: QueueTrack = {
                    track: relatedTrack,
                    requestedBy: previousTrack.requestedBy,
                    title: relatedTrack.info.title,
                    uri: relatedTrack.info.uri || '',
                    duration: relatedTrack.info.length
                  };
                  
                  queue!.add(autoplayTrack);

                  const nextAutoTrack = queue!.next();
                  if (nextAutoTrack) {
                    await queue!.player!.playTrack({ track: { encoded: nextAutoTrack.track.encoded } });
                    
                    const channel = await interaction.client.channels.fetch(queue!.textChannelId);
                    if (channel?.isTextBased() && 'send' in channel) {
                      await channel.send({
                        embeds: [
                          new EmbedBuilder()
                            .setColor(0x5865F2)
                            .setDescription(`🔄 Autoplay: **${nextAutoTrack.title}**`)
                        ]
                      });
                    }
                  }
                }
              } catch (error) {
                console.error('Autoplay failed:', error);
              }
            }
          });

          queue.player.on('exception', (error: any) => {
            console.error('Player exception:', error);
          });
        }

        const successEmbed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('📅 **Luko\'s Song of the Day**')
          .setDescription(
            isRandom
              ? `🎲 **Surprise Pick!** A random ${genreLabel} song${mainGenre ? ` (${mainGenre})` : ''}:`
              : `🎸 **Genre:** ${genreLabel}${mainGenre ? ` (${mainGenre})` : ''}`
          )
          .addFields(
            { name: '🎵 Song', value: songTitle, inline: true },
            { name: '👤 Artist', value: artistName, inline: true },
            { name: '📅 Year', value: releaseYear, inline: true },
            { name: '⏱️ Duration', value: formatDuration(track.info.length), inline: true },
            { name: '📍 Position', value: !queue.current && queue.size() === 1 ? 'Now playing!' : `#${queue.size()} in queue`, inline: true }
          )
          .setThumbnail(track.info.artworkUrl || null)
          .setFooter({ text: 'Powered by MusicBrainz' })
          .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

      } catch (error: any) {
        console.error('Song of the day error:', error);
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xFF0000)
              .setDescription(`❌ An error occurred: ${error.message || 'Unknown error'}`)
          ],
          components: []
        });
      }
    }

    collector.on('collect', async (menuInteraction) => {
      await menuInteraction.deferUpdate();
      
      const selectedGenre = menuInteraction.values[0];
      collector.stop('selected');

      if (selectedGenre === 'random') {
        const allSubGenres = Object.values(subGenres).flat();
        const randomSubGenre = allSubGenres[Math.floor(Math.random() * allSubGenres.length)];
        const genreToSearch = randomSubGenre.value;
        
        await searchAndPlay(interaction, voiceChannel, genreToSearch, true, randomSubGenre.label);
        return;
      }

      const subGenreOptions = subGenres[selectedGenre];
      if (!subGenreOptions) {
        await interaction.editReply({
          content: '❌ Invalid genre selection!',
          embeds: [],
          components: []
        });
        return;
      }

      const subGenreMenu = new StringSelectMenuBuilder()
        .setCustomId('subgenre_select')
        .setPlaceholder(`🎼 Select a ${selectedGenre} sub-genre...`)
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel('✨ Surprise Me')
            .setDescription(`Random ${selectedGenre} sub-genre`)
            .setValue('random')
            .setEmoji('🎲'),
          ...subGenreOptions.map(sg => 
            new StringSelectMenuOptionBuilder()
              .setLabel(sg.label)
              .setDescription(sg.description)
              .setValue(sg.value)
          )
        );

      const subGenreRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(subGenreMenu);

      const subGenreEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`🎸 ${selectedGenre.charAt(0).toUpperCase() + selectedGenre.slice(1)} Sub-Genres`)
        .setDescription('Choose a specific style or pick "Surprise Me" for a random one!')
        .setFooter({ text: 'Menu expires in 30 seconds' })
        .setTimestamp();

      await interaction.editReply({
        embeds: [subGenreEmbed],
        components: [subGenreRow]
      });

      const subGenreCollector = interaction.channel?.createMessageComponentCollector({
        filter: (i) => i.user.id === interaction.user.id && i.customId === 'subgenre_select',
        componentType: ComponentType.StringSelect,
        time: 30000
      });

      if (!subGenreCollector) {
        await interaction.editReply({ content: '❌ Failed to create sub-genre menu!', embeds: [], components: [] });
        return;
      }

      subGenreCollector.on('collect', async (subMenuInteraction) => {
        await subMenuInteraction.deferUpdate();
        
        const selectedSubGenre = subMenuInteraction.values[0];
        subGenreCollector.stop('selected');

        if (selectedSubGenre === 'random') {
          const randomSub = subGenreOptions[Math.floor(Math.random() * subGenreOptions.length)];
          await searchAndPlay(interaction, voiceChannel, randomSub.value, true, randomSub.label, selectedGenre);
        } else {
          const subGenreLabel = subGenreOptions.find(sg => sg.value === selectedSubGenre)?.label || selectedSubGenre;
          await searchAndPlay(interaction, voiceChannel, selectedSubGenre, false, subGenreLabel, selectedGenre);
        }
      });

      subGenreCollector.on('end', async (collected, reason) => {
        if (reason === 'time') {
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(0x5865F2)
                .setDescription(`⏱️ Menu expired. Use \`/songoftheday\` again to try!`)
            ],
            components: []
          });
        }
      });
    });

    collector.on('end', async (collected, reason) => {
      if (reason === 'time') {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865F2)
              .setDescription(`⏱️ Menu expired. Use \`/songoftheday\` again to try!`)
          ],
          components: []
        });
      }
    });
  }
};

export default command;
