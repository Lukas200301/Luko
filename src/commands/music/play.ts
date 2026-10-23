import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  EmbedBuilder,
  AutocompleteInteraction
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
    .setName('play')
    .setDescription('Play music from YouTube, Spotify, SoundCloud, Apple Music, Deezer, Bandcamp, or any URL')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('Song name or URL (Spotify, YouTube, SoundCloud, Apple Music, Deezer, etc.)')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option
        .setName('source')
        .setDescription('Preferred search platform when searching by name (default: Auto)')
        .setRequired(false)
        .addChoices(...MUSIC_SOURCE_CHOICES)
    ),

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focusedValue = interaction.options.getFocused();
    const source = (interaction.options.getString('source') as MusicSource | null) ?? 'auto';

    if (!focusedValue || focusedValue.length < 2 || focusedValue.startsWith('http') || !interaction.client.shoukaku) {
      await interaction.respond([]);
      return;
    }

    try {
      const resolved = await resolveTracks(interaction.client, focusedValue, source);

      if (!resolved) {
        await interaction.respond([]);
        return;
      }

      const choices = resolved.tracks.slice(0, 10).map((track) => {
        let name = track.info.title;
        if (track.info.author) {
          name = `${track.info.title} - ${track.info.author}`;
        }
        if (name.length > 100) {
          name = name.substring(0, 97) + '...';
        }

        return {
          name: name,
          value: (track.info.uri || track.info.title).slice(0, 100)
        };
      });

      await interaction.respond(choices);
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
    const source = (interaction.options.getString('source') as MusicSource | null) ?? 'auto';
    if (!interaction.client.shoukaku) {
      await interaction.editReply('❌ The music system is currently unavailable.');
      return;
    }

    if (!interaction.client.shoukaku.getIdealNode()) {
      await interaction.editReply('❌ No Lavalink nodes are available right now. Please try again later.');
      return;
    }

    try {
      const resolved = await resolveTracks(interaction.client, query, source);

      if (!resolved || resolved.tracks.length === 0) {
        await interaction.editReply(`❌ No results found for: **${query}**\n\n💡 **Tip:** Try using a direct YouTube/Spotify URL for best results.`);
        return;
      }

      const tracksToAdd = resolved.playlistName ? resolved.tracks : [resolved.tracks[0]];

      const { queue } = await startPlayback(interaction.client, {
        guildId: interaction.guildId!,
        shardId: interaction.guild!.shardId,
        voiceChannelId: voiceChannel.id,
        textChannelId: interaction.channelId,
        tracks: tracksToAdd.map(track => toQueueTrack(track, interaction.user.tag))
      });

      if (resolved.playlistName) {
        const embed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('📃 Playlist Added')
          .setDescription(`Added **${tracksToAdd.length}** tracks from **${resolved.playlistName}**`)
          .setFooter({ text: `Requested by ${interaction.user.tag}` })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } else {
        const track = tracksToAdd[0];
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
