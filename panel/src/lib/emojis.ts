import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { EmojiInfo } from './types';
import { useToast } from '../components/ui';

export const MAX_EMOJI_BYTES = 256 * 1024;

export function useBotEmojis() {
  return useQuery({ queryKey: ['bot-emojis'], queryFn: () => api.get<EmojiInfo[]>('/api/emojis'), staleTime: 60_000, retry: false });
}

// Turns a file name like "Pog Champ!.png" into a valid emoji name ("Pog_Champ").
export function emojiNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return (base.length >= 2 ? base : `emoji_${base}`).slice(0, 32);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

export function useUploadEmoji() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: async ({ file, name }: { file: File; name: string }) => {
      if (file.size > MAX_EMOJI_BYTES) {
        throw new Error(`${file.name} is ${Math.round(file.size / 1024)} KB. Emojis can be at most 256 KB.`);
      }
      return api.post<EmojiInfo>('/api/emojis', { name, image: await readAsDataUrl(file) });
    },
    onSuccess: (emoji) => {
      toast.success(`Uploaded :${emoji.name}:`);
      queryClient.invalidateQueries({ queryKey: ['bot-emojis'] });
    },
    onError: (error) => toast.error(error)
  });
}

// Image URL for a stored emoji value: a bare emoji ID or a "<:name:id>" / "<a:name:id>" string.
// Returns null for Unicode emojis, which are shown as text.
export function emojiImageUrl(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{15,25}$/.test(trimmed)) {
    return `https://cdn.discordapp.com/emojis/${trimmed}.webp?size=48`;
  }
  const match = /^<(a?):\w+:(\d+)>$/.exec(trimmed);
  if (match) {
    return `https://cdn.discordapp.com/emojis/${match[2]}.${match[1] ? 'gif' : 'webp'}?size=48`;
  }
  return null;
}
