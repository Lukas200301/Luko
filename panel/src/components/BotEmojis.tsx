import { useRef, useState, type DragEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ImagePlus, Pencil, Smile, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { emojiNameFromFile, useBotEmojis, useUploadEmoji } from '../lib/emojis';
import type { EmojiInfo } from '../lib/types';
import { Button, Card, CardHeader, EmptyState, Input, Notice, PageLoader, useConfirm, useToast } from './ui';

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/avif';

function EmojiTile({ emoji }: { emoji: EmojiInfo }) {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(emoji.name);

  const rename = useMutation({
    mutationFn: () => api.put<EmojiInfo>(`/api/emojis/${emoji.id}`, { name }),
    onSuccess: () => {
      toast.success(`Renamed to :${name}:`);
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['bot-emojis'] });
    },
    onError: (error) => toast.error(error)
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/api/emojis/${emoji.id}`),
    onSuccess: () => {
      toast.success(`Deleted :${emoji.name}:`);
      queryClient.invalidateQueries({ queryKey: ['bot-emojis'] });
    },
    onError: (error) => toast.error(error)
  });

  return (
    <div className="group flex flex-col items-center gap-2 rounded-xl border border-border bg-surface-2/40 p-3">
      <img src={emoji.url} alt={emoji.name} className="size-12 object-contain" />
      {editing ? (
        <form className="flex w-full gap-1" onSubmit={(e) => { e.preventDefault(); rename.mutate(); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-7 px-2 text-xs" autoFocus maxLength={32} />
          <Button type="submit" size="icon" variant="ghost" className="size-7 justify-center" loading={rename.isPending} aria-label="Save name"><Check className="size-3.5" /></Button>
          <Button size="icon" variant="ghost" className="size-7 justify-center" onClick={() => { setEditing(false); setName(emoji.name); }} aria-label="Cancel"><X className="size-3.5" /></Button>
        </form>
      ) : (
        <div className="w-full truncate text-center font-mono text-xs" title={`:${emoji.name}:`}>:{emoji.name}:</div>
      )}
      {!editing && (
        <div className="flex gap-0.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
          <Button size="icon" variant="ghost" className="size-7 justify-center" title="Copy for messages" onClick={() => { navigator.clipboard.writeText(emoji.display); toast.success(`Copied ${emoji.display}`); }}>
            <Copy className="size-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="size-7 justify-center" title="Rename" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 justify-center"
            title="Delete"
            loading={remove.isPending}
            onClick={async () => {
              if (await confirm({ title: `Delete :${emoji.name}:?`, description: 'Messages and pinboard posts that use it will show the name instead.', confirmLabel: 'Delete', danger: true })) {
                remove.mutate();
              }
            }}
          >
            {!remove.isPending && <Trash2 className="size-3.5" />}
          </Button>
        </div>
      )}
    </div>
  );
}

// Manages the bot's application emojis (Developer Portal → your app → Emojis).
export function BotEmojis({ compact }: { compact?: boolean }) {
  const { data: emojis = [], isLoading, isError } = useBotEmojis();
  const upload = useUploadEmoji();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const uploadFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      await upload.mutateAsync({ file, name: emojiNameFromFile(file.name) }).catch(() => {});
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) uploadFiles(event.dataTransfer.files);
  };

  return (
    <Card>
      <CardHeader
        title={`Bot emojis · ${emojis.length}`}
        description="The bot's own emojis. It can use them in every server, so they're ideal for the pinboard."
        icon={<Smile className="size-4" />}
        actions={
          <Button size="sm" onClick={() => fileRef.current?.click()} loading={upload.isPending} disabled={isError}>
            <ImagePlus className="size-3.5" />Upload
          </Button>
        }
      />
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ''; }}
      />
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn('p-5 transition', dragging && 'bg-accent/8 ring-2 ring-accent ring-inset')}
      >
        {isLoading ? <PageLoader /> : isError ? (
          <Notice tone="warning">Bot emojis can only be loaded while the bot is connected to Discord.</Notice>
        ) : emojis.length === 0 ? (
          <EmptyState
            icon={<ImagePlus className="size-5" />}
            title="No bot emojis yet"
            description="Drop images here or click Upload. PNG, JPEG, GIF, WebP or AVIF, up to 256 KB. The file name becomes the emoji name."
          />
        ) : (
          <>
            <div className={cn('grid gap-3', compact ? 'grid-cols-3 sm:grid-cols-5 lg:grid-cols-8' : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8')}>
              {emojis.map(emoji => <EmojiTile key={emoji.id} emoji={emoji} />)}
            </div>
            <p className="mt-4 text-xs text-muted">Drop image files anywhere in this box to upload them. The file name becomes the emoji name.</p>
          </>
        )}
      </div>
    </Card>
  );
}
