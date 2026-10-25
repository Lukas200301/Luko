import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder
} from 'discord.js';
import { Track } from 'shoukaku';
import { SlashCommand } from '../../interfaces/Command';
import { formatDuration, resolveTracks, startPlayback, toQueueTrack } from '../../utils/MusicService';
import { MAX_PLAYLIST_TRACKS } from '../../utils/PlaylistManager';
import { PlaylistSummary } from '../../shared/types';

const nameOption = (description: string) => (option: import('discord.js').SlashCommandStringOption) =>
  option.setName('name').setDescription(description).setRequired(true).setAutocomplete(true).setMaxLength(50);

// The creator, the bot owner and panel admins may change a playlist.
function canEdit(interaction: ChatInputCommandInteraction, playlist: PlaylistSummary): boolean {
  const id = interaction.user.id;
  return id === playlist.ownerId || id === process.env.OWNER_ID || interaction.client.settings.get().panel.adminIds.includes(id);
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Saved playlists everyone on the bot can play')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(sub => sub
      .setName('play')
      .setDescription('Play a saved playlist')
      .addStringOption(nameOption('Which playlist'))
      .addBooleanOption(option => option.setName('shuffle').setDescription('Shuffle the songs')))
    .addSubcommand(sub => sub
      .setName('save')
      .setDescription('Save the current queue (with the song playing now) as a playlist')
      .addStringOption(nameOption('Name of the playlist (an existing one of yours is replaced)')))
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a song (or a whole playlist URL) to a playlist')
      .addStringOption(nameOption('Which playlist'))
      .addStringOption(option => option.setName('song').setDescription('Song name or URL').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create an empty playlist')
      .addStringOption(option => option.setName('name').setDescription('Name of the playlist').setRequired(true).setMaxLength(50)))
    .addSubcommand(sub => sub
      .setName('show')
      .setDescription('Show the songs of a playlist')
      .addStringOption(nameOption('Which playlist')))
    .addSubcommand(sub => sub.setName('list').setDescription('All saved playlists'))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a song from a playlist')
      .addStringOption(nameOption('Which playlist'))
      .addIntegerOption(option => option.setName('position').setDescription('Number of the song (see /playlist show)').setRequired(true).setMinValue(1)))
    .addSubcommand(sub => sub
      .setName('delete')
      .setDescription('Delete a playlist')
      .addStringOption(nameOption('Which playlist'))),

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused();
    const matches = interaction.client.playlists.search(focused).slice(0, 25);
    await interaction.respond(matches.map(p => ({ name: p.name, value: p.name })));
  },

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const playlists = interaction.client.playlists;
    const sub = interaction.options.getSubcommand();
    const name = interaction.options.getString('name') ?? '';
    const ephemeral = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

    if (sub === 'list') {
      const all = playlists.list();
      if (all.length === 0) {
        await ephemeral('No playlists yet. Create one with `/playlist create` or save the current queue with `/playlist save`.');
        return;
      }
      const lines = all.slice(0, 25).map(p => `**${p.name}** · ${p.trackCount} songs · ${formatDuration(p.duration)} · by ${p.ownerName ?? 'someone'}`);
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🎶 Playlists').setDescription(lines.join('\n')).setFooter({ text: `${all.length} playlists · /playlist play <name>` })],
        allowedMentions: { parse: [] }
      });
      return;
    }

    if (sub === 'create') {
      try {
        const created = playlists.create(name, interaction.user.id, interaction.user.displayName);
        await ephemeral(`✅ Created **${created.name}**. Add songs with \`/playlist add\`.`);
      } catch (error) {
        await ephemeral(`❌ ${error instanceof Error ? error.message : error}`);
      }
      return;
    }

    if (sub === 'save') {
      const queue = interaction.client.queueManager.get(interaction.guildId!);
      const tracks: Track[] = queue ? [queue.current, ...queue.tracks].filter(t => !!t).map(t => t!.track) : [];
      if (tracks.length === 0) {
        await ephemeral('❌ Nothing is playing, so there is nothing to save.');
        return;
      }
      let playlist = playlists.findByName(name);
      if (playlist && !canEdit(interaction, playlist)) {
        await ephemeral(`❌ **${playlist.name}** belongs to ${playlist.ownerName ?? 'someone else'}. Pick another name.`);
        return;
      }
      try {
        playlist ??= playlists.create(name, interaction.user.id, interaction.user.displayName);
      } catch (error) {
        await ephemeral(`❌ ${error instanceof Error ? error.message : error}`);
        return;
      }
      const saved = playlists.replaceTracks(playlist.id, tracks);
      await interaction.reply(`💾 Saved **${saved}** songs as **${playlist.name}**${saved < tracks.length ? ` (playlists hold up to ${MAX_PLAYLIST_TRACKS})` : ''}.`);
      return;
    }

    const playlist = playlists.findByName(name);
    if (!playlist) {
      await ephemeral(`❌ There is no playlist called **${name}**. See \`/playlist list\`.`);
      return;
    }

    if (sub === 'show') {
      const detail = playlists.get(playlist.id)!;
      const lines = detail.tracks.slice(0, 20).map((t, i) => `\`${i + 1}.\` [${t.title}](${t.uri ?? ''}) · ${formatDuration(t.duration)}`);
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(`🎶 ${detail.name}`)
          .setDescription(lines.length ? `${lines.join('\n')}${detail.tracks.length > 20 ? `\n…and ${detail.tracks.length - 20} more` : ''}` : 'No songs yet.')
          .setThumbnail(detail.artworkUrl)
          .setFooter({ text: `${detail.trackCount} songs · ${formatDuration(detail.duration)} · by ${detail.ownerName ?? 'someone'}` })],
        allowedMentions: { parse: [] }
      });
      return;
    }

    if (sub === 'play') {
      const member = interaction.member as GuildMember;
      const voiceChannel = member.voice.channel;
      if (!voiceChannel) {
        await ephemeral('❌ Join a voice channel first.');
        return;
      }
      if (!voiceChannel.permissionsFor(interaction.client.user!)?.has(['Connect', 'Speak'])) {
        await ephemeral('❌ I need permission to join and speak in your voice channel.');
        return;
      }
      if (!interaction.client.shoukaku?.getIdealNode()) {
        await ephemeral('❌ The music system is not available right now. Try again later.');
        return;
      }
      let tracks = playlists.loadTracks(playlist.id);
      if (tracks.length === 0) {
        await ephemeral(`❌ **${playlist.name}** has no songs yet.`);
        return;
      }
      if (interaction.options.getBoolean('shuffle')) tracks = shuffle(tracks);

      await interaction.deferReply();
      await startPlayback(interaction.client, {
        guildId: interaction.guildId!,
        shardId: interaction.guild!.shardId,
        voiceChannelId: voiceChannel.id,
        textChannelId: interaction.channelId,
        tracks: tracks.map(track => toQueueTrack(track, interaction.user.tag, interaction.user.id))
      });
      await interaction.editReply(`🎶 Added **${tracks.length}** songs from **${playlist.name}**${interaction.options.getBoolean('shuffle') ? ' (shuffled)' : ''}.`);
      return;
    }

    if (!canEdit(interaction, playlist)) {
      await ephemeral(`❌ Only ${playlist.ownerName ?? 'the creator'} can change **${playlist.name}**.`);
      return;
    }

    if (sub === 'add') {
      if (!interaction.client.shoukaku?.getIdealNode()) {
        await ephemeral('❌ The music system is not available right now, so songs cannot be looked up.');
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const query = interaction.options.getString('song', true);
      const resolved = await resolveTracks(interaction.client, query);
      if (!resolved || resolved.tracks.length === 0) {
        await interaction.editReply(`❌ No results for **${query}**.`);
        return;
      }
      const tracks = resolved.playlistName ? resolved.tracks : [resolved.tracks[0]];
      const added = playlists.addTracks(playlist.id, tracks);
      await interaction.editReply(added === 0
        ? `❌ **${playlist.name}** is full (${MAX_PLAYLIST_TRACKS} songs).`
        : resolved.playlistName ? `✅ Added ${added} songs from **${resolved.playlistName}** to **${playlist.name}**.` : `✅ Added **${tracks[0].info.title}** to **${playlist.name}**.`);
      return;
    }

    if (sub === 'remove') {
      const position = interaction.options.getInteger('position', true);
      const track = playlists.get(playlist.id)!.tracks[position - 1];
      if (!track) {
        await ephemeral(`❌ **${playlist.name}** has no song number ${position}.`);
        return;
      }
      playlists.removeTrack(playlist.id, track.id);
      await ephemeral(`🗑️ Removed **${track.title}** from **${playlist.name}**.`);
      return;
    }

    if (sub === 'delete') {
      playlists.delete(playlist.id);
      await ephemeral(`🗑️ Deleted the playlist **${playlist.name}**.`);
    }
  }
};
