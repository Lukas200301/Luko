import { Shoukaku, Player } from 'shoukaku';
import { Track } from 'shoukaku';

export interface QueueTrack {
  track: Track;
  requestedBy: string;
  title: string;
  uri: string;
  duration: number;
}

export class MusicQueue {
  public tracks: QueueTrack[] = [];
  public current: QueueTrack | null = null;
  public player: Player | null = null;
  public textChannelId: string;
  public loop: boolean = false;
  public queueLoop: boolean = false;
  public history: QueueTrack[] = [];
  public volume: number = 100;
  public autoplay: boolean = false;
  public isDestroying: boolean = false;

  constructor(textChannelId: string) {
    this.textChannelId = textChannelId;
  }

  add(track: QueueTrack): void {
    this.tracks.push(track);
  }

  remove(index: number): QueueTrack | undefined {
    return this.tracks.splice(index, 1)[0];
  }

  clear(): void {
    this.tracks = [];
  }

  shuffle(): void {
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }
  }

  move(from: number, to: number): boolean {
    if (from < 0 || from >= this.tracks.length || to < 0 || to >= this.tracks.length) {
      return false;
    }
    const [track] = this.tracks.splice(from, 1);
    this.tracks.splice(to, 0, track);
    return true;
  }

  jumpTo(index: number): QueueTrack | null {
    if (index < 0 || index >= this.tracks.length) {
      return null;
    }
    this.tracks.splice(0, index);
    return this.next();
  }

  addToHistory(track: QueueTrack): void {
    this.history.push(track);
    if (this.history.length > 50) {
      this.history.shift();
    }
  }

  getPrevious(): QueueTrack | null {
    if (this.history.length === 0) {
      return null;
    }
    const previous = this.history.pop()!;
    if (this.current) {
      this.tracks.unshift(this.current);
    }
    return previous;
  }

  next(): QueueTrack | null {
    if (this.current && !this.loop) {
      this.addToHistory(this.current);
    }

    if (this.loop && this.current) {
      return this.current;
    }

    if (this.queueLoop && this.tracks.length === 0 && this.current) {
      this.tracks = [...this.history];
      this.history = [];
    }
    
    this.current = this.tracks.shift() || null;
    return this.current;
  }

  size(): number {
    return this.tracks.length;
  }

  isEmpty(): boolean {
    return this.tracks.length === 0;
  }
}

export class QueueManager {
  private queues: Map<string, MusicQueue> = new Map();

  get(guildId: string): MusicQueue | undefined {
    return this.queues.get(guildId);
  }

  create(guildId: string, textChannelId: string): MusicQueue {
    const queue = new MusicQueue(textChannelId);
    this.queues.set(guildId, queue);
    return queue;
  }

  delete(guildId: string): boolean {
    return this.queues.delete(guildId);
  }

  has(guildId: string): boolean {
    return this.queues.has(guildId);
  }

  size(): number {
    return this.queues.size;
  }
}
