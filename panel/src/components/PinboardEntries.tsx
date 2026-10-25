import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ExternalLink, Hash, MessageSquare, Pin, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTime, timeAgo } from '../lib/utils';
import type { PinboardBoardStatus, PinboardEntry, PinboardEntryDetail } from '../lib/types';
import { Avatar, Badge, Button, Dialog, PageLoader, useConfirm, useToast } from './ui';
import { EmojiPreview } from './EmojiPicker';

export function useRemoveEntry(onDone?: () => void) {
  const toast = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entry: PinboardEntry) => api.delete(`/api/pinboard/entries/${entry.boardId}/${entry.originalMessageId}`),
    onSuccess: () => {
      toast.success('Removed from the pinboard');
      queryClient.invalidateQueries({ queryKey: ['pinboard'] });
      queryClient.invalidateQueries({ queryKey: ['pinboard-entries'] });
      queryClient.invalidateQueries({ queryKey: ['pinboard-stats'] });
      onDone?.();
    },
    onError: (error) => toast.error(error)
  });
}

function postUrl(board: PinboardBoardStatus | undefined, entry: PinboardEntry): string | null {
  return board ? `https://discord.com/channels/${board.guildId}/${board.channelId}/${entry.pinboardMessageId}` : null;
}

function originalUrl(board: PinboardBoardStatus | undefined, entry: PinboardEntry): string | null {
  return board && entry.channelId ? `https://discord.com/channels/${board.guildId}/${entry.channelId}/${entry.originalMessageId}` : null;
}

export function EntryEmoji({ entry }: { entry: PinboardEntry }) {
  if (entry.count === undefined) return null;
  const emoji = entry.emojiDisplay || entry.emoji;
  return (
    <Badge tone="warning" className="gap-1">
      {emoji ? <EmojiPreview value={emoji} className="size-3.5 text-xs" /> : '★'}
      {entry.count}
    </Badge>
  );
}

export function EntryCard({ entry, board, showBoard, onOpen }: {
  entry: PinboardEntry;
  board?: PinboardBoardStatus;
  showBoard?: boolean;
  onOpen?: (entry: PinboardEntry) => void;
}) {
  const confirm = useConfirm();
  const remove = useRemoveEntry();
  const text = entry.content ?? entry.excerpt;
  const url = postUrl(board, entry);

  return (
    <div
      className={`flex flex-col rounded-xl border border-border bg-surface-2/50 p-4 ${onOpen ? 'cursor-pointer transition hover:border-accent/40' : ''}`}
      onClick={() => onOpen?.(entry)}
    >
      <div className="mb-2 flex items-center gap-2">
        <Avatar src={entry.authorAvatarUrl} name={entry.authorName ?? '?'} className="size-7" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{entry.authorName ?? 'Unknown author'}</div>
          {entry.channelName && <div className="truncate text-[11px] text-muted">#{entry.channelName}</div>}
        </div>
        <EntryEmoji entry={entry} />
      </div>
      {text ? (
        <p className="line-clamp-4 text-sm break-words whitespace-pre-line text-fg/90">{text}</p>
      ) : (
        <p className="text-xs text-muted italic">{entry.imageUrl ? 'Image' : entry.content === '' ? 'No text' : 'Preview not loaded yet'}</p>
      )}
      {entry.imageUrl && <img src={entry.imageUrl} alt="" loading="lazy" className="mt-2 max-h-40 w-full rounded-lg object-cover" />}
      <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-xs text-muted">
        <span className="truncate">{showBoard && `${board?.name ?? 'Deleted board'} · `}{entry.pinnedAt ? timeAgo(entry.pinnedAt) : ''}</span>
        <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
          {url && <a href={url} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm"><ExternalLink className="size-3.5" />Open</Button></a>}
          <Button
            variant="ghost"
            size="sm"
            loading={remove.isPending}
            onClick={async () => {
              if (await confirm({ title: 'Remove from pinboard?', description: 'The pinboard post is deleted. The original message stays.', confirmLabel: 'Remove', danger: true })) {
                remove.mutate(entry);
              }
            }}
          >
            {!remove.isPending && <Trash2 className="size-3.5" />}Remove
          </Button>
        </div>
      </div>
    </div>
  );
}

export function EntrySkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex animate-pulse flex-col gap-3 rounded-xl border border-border bg-surface-2/50 p-4">
          <div className="flex items-center gap-2"><div className="size-7 rounded-full bg-border" /><div className="h-3 w-28 rounded bg-border" /></div>
          <div className="h-3 w-full rounded bg-border" />
          <div className="h-3 w-4/5 rounded bg-border" />
          <div className="mt-2 h-3 w-16 rounded bg-border" />
        </div>
      ))}
    </>
  );
}

// Full message with every reaction, dates and links.
export function EntryDialog({ entry, board, onClose }: { entry: PinboardEntry | null; board?: PinboardBoardStatus; onClose: () => void }) {
  const confirm = useConfirm();
  const remove = useRemoveEntry(onClose);
  const { data: detail, isLoading } = useQuery({
    queryKey: ['pinboard-entry', entry?.boardId, entry?.originalMessageId],
    queryFn: () => api.get<PinboardEntryDetail>(`/api/pinboard/boards/${entry!.boardId}/entries/${entry!.originalMessageId}`),
    enabled: !!entry
  });

  const shown = detail ?? entry;
  const original = shown ? originalUrl(board, shown) : null;
  const post = shown ? postUrl(board, shown) : null;

  return (
    <Dialog
      open={!!entry}
      onClose={onClose}
      size="lg"
      title={shown ? (
        <span className="flex items-center gap-2">
          <Avatar src={shown.authorAvatarUrl} name={shown.authorName ?? '?'} className="size-7" />
          {shown.authorName ?? 'Unknown author'}
        </span>
      ) : ''}
      footer={shown && (
        <>
          <Button
            variant="ghost"
            className="mr-auto text-danger hover:text-danger"
            loading={remove.isPending}
            onClick={async () => {
              if (await confirm({ title: 'Remove from pinboard?', description: 'The pinboard post is deleted. The original message stays.', confirmLabel: 'Remove', danger: true })) {
                remove.mutate(shown);
              }
            }}
          >
            <Trash2 className="size-4" />Remove
          </Button>
          {post && <a href={post} target="_blank" rel="noreferrer"><Button variant="secondary"><Pin className="size-4" />Pinboard post</Button></a>}
          {original && <a href={original} target="_blank" rel="noreferrer"><Button><MessageSquare className="size-4" />Original message</Button></a>}
        </>
      )}
    >
      {!shown ? null : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
            {shown.channelName && <span className="flex items-center gap-1"><Hash className="size-3.5" />{shown.channelName}</span>}
            {shown.messageCreatedAt && <span className="flex items-center gap-1"><MessageSquare className="size-3.5" />Sent {formatDateTime(shown.messageCreatedAt)}</span>}
            {shown.pinnedAt && <span className="flex items-center gap-1"><CalendarClock className="size-3.5" />Pinned {formatDateTime(shown.pinnedAt)}</span>}
          </div>

          {(shown.content ?? shown.excerpt) ? (
            <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{shown.content ?? shown.excerpt}</p>
          ) : (
            <p className="text-sm text-muted italic">No text</p>
          )}
          {shown.imageUrl && <img src={shown.imageUrl} alt="" className="max-h-96 w-full rounded-lg object-contain" />}

          <div>
            <div className="mb-2 text-xs font-medium">Reactions</div>
            {isLoading ? <PageLoader /> : detail && detail.reactions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {detail.reactions.map(r => (
                  <span key={r.emoji} className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-sm">
                    <EmojiPreview value={r.display || r.emoji} className="size-5" />
                    <span className="font-medium tabular-nums">{r.count}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted">Not recorded for this pin yet. It's filled in the next time someone reacts.</p>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
