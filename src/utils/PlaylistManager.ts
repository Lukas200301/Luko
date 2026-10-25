import { Track } from 'shoukaku';
import { db, transaction } from './Database';
import { PlaylistDetail, PlaylistSummary, PlaylistTrackInfo } from '../shared/types';

// Saved playlists, shared by everyone who uses the bot. Only the creator (or a panel admin)
// may change or delete one. Songs are stored as Lavalink tracks, so they play without searching again.

export const MAX_PLAYLIST_TRACKS = 500;

interface PlaylistRow {
  id: number;
  name: string;
  owner_id: string;
  owner_name: string | null;
  created_at: number;
  updated_at: number;
  track_count: number;
  duration: number;
  artwork_url: string | null;
}

interface TrackRow {
  id: number;
  title: string;
  author: string | null;
  uri: string | null;
  duration: number;
  artwork_url: string | null;
  track: string;
}

const SUMMARY = `
  SELECT p.*, COUNT(t.id) AS track_count, COALESCE(SUM(t.duration), 0) AS duration,
    (SELECT artwork_url FROM playlist_tracks WHERE playlist_id = p.id AND artwork_url IS NOT NULL ORDER BY position LIMIT 1) AS artwork_url
  FROM playlists p LEFT JOIN playlist_tracks t ON t.playlist_id = p.id
`;

const statements = {
  list: db.prepare(`${SUMMARY} GROUP BY p.id ORDER BY p.updated_at DESC`),
  byId: db.prepare(`${SUMMARY} WHERE p.id = ? GROUP BY p.id`),
  byName: db.prepare(`${SUMMARY} WHERE p.name = ? GROUP BY p.id`),
  search: db.prepare("SELECT id, name FROM playlists WHERE name LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 25"),
  insert: db.prepare('INSERT INTO playlists (name, owner_id, owner_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'),
  rename: db.prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?'),
  touch: db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?'),
  delete: db.prepare('DELETE FROM playlists WHERE id = ?'),
  tracks: db.prepare('SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY position, id'),
  maxPosition: db.prepare('SELECT COALESCE(MAX(position), -1) AS n FROM playlist_tracks WHERE playlist_id = ?'),
  insertTrack: db.prepare('INSERT INTO playlist_tracks (playlist_id, position, title, author, uri, duration, artwork_url, track) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  deleteTrack: db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND id = ?'),
  deleteTracks: db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?'),
  setPosition: db.prepare('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND id = ?')
};

function toSummary(row: PlaylistRow): PlaylistSummary {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    trackCount: row.track_count,
    duration: row.duration,
    artworkUrl: row.artwork_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toTrackInfo(row: TrackRow): PlaylistTrackInfo {
  return { id: row.id, title: row.title, author: row.author, uri: row.uri, duration: row.duration, artworkUrl: row.artwork_url };
}

export function validPlaylistName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 1 || trimmed.length > 50) throw new Error('Playlist names have 1 to 50 characters.');
  return trimmed;
}

export class PlaylistManager {
  list(): PlaylistSummary[] {
    return (statements.list.all() as unknown as PlaylistRow[]).map(toSummary);
  }

  get(id: number): PlaylistDetail | null {
    const row = statements.byId.get(id) as PlaylistRow | undefined;
    if (!row) return null;
    return { ...toSummary(row), tracks: (statements.tracks.all(id) as unknown as TrackRow[]).map(toTrackInfo) };
  }

  // Names are unique, ignoring upper/lower case.
  findByName(name: string): PlaylistSummary | null {
    const row = statements.byName.get(name.trim()) as PlaylistRow | undefined;
    return row ? toSummary(row) : null;
  }

  search(text: string): { id: number; name: string }[] {
    return statements.search.all(`%${text.replace(/[\\%_]/g, c => `\\${c}`)}%`) as { id: number; name: string }[];
  }

  create(name: string, ownerId: string, ownerName: string): PlaylistSummary {
    const clean = validPlaylistName(name);
    if (this.findByName(clean)) throw new Error(`A playlist called "${clean}" already exists.`);
    const now = Date.now();
    const { lastInsertRowid } = statements.insert.run(clean, ownerId, ownerName, now, now);
    return this.get(Number(lastInsertRowid))!;
  }

  rename(id: number, name: string): void {
    const clean = validPlaylistName(name);
    const existing = this.findByName(clean);
    if (existing && existing.id !== id) throw new Error(`A playlist called "${clean}" already exists.`);
    statements.rename.run(clean, Date.now(), id);
  }

  delete(id: number): void {
    transaction(db, () => {
      statements.deleteTracks.run(id);
      statements.delete.run(id);
    });
  }

  // Appends tracks (up to the limit); returns how many were added.
  addTracks(id: number, tracks: Track[]): number {
    const current = this.get(id);
    if (!current) throw new Error('Playlist not found.');
    const room = Math.max(0, MAX_PLAYLIST_TRACKS - current.trackCount);
    const toAdd = tracks.slice(0, room);

    transaction(db, () => {
      let position = (statements.maxPosition.get(id) as { n: number }).n;
      for (const track of toAdd) {
        statements.insertTrack.run(
          id,
          ++position,
          track.info.title,
          track.info.author || null,
          track.info.uri || null,
          track.info.length || 0,
          track.info.artworkUrl ?? null,
          JSON.stringify(track)
        );
      }
      statements.touch.run(Date.now(), id);
    });
    return toAdd.length;
  }

  replaceTracks(id: number, tracks: Track[]): number {
    transaction(db, () => statements.deleteTracks.run(id));
    return this.addTracks(id, tracks);
  }

  removeTrack(id: number, trackId: number): boolean {
    const removed = statements.deleteTrack.run(id, trackId).changes > 0;
    if (removed) statements.touch.run(Date.now(), id);
    return removed;
  }

  // Puts the tracks in the given order (IDs that aren't in the playlist are ignored).
  reorder(id: number, trackIds: number[]): void {
    transaction(db, () => {
      trackIds.forEach((trackId, position) => statements.setPosition.run(position, id, trackId));
      statements.touch.run(Date.now(), id);
    });
  }

  // The stored Lavalink tracks, ready to queue.
  loadTracks(id: number): Track[] {
    return (statements.tracks.all(id) as unknown as TrackRow[]).flatMap((row): Track[] => {
      try {
        return [JSON.parse(row.track) as Track];
      } catch {
        return [];
      }
    });
  }
}
