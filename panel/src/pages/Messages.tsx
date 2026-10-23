import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ExternalLink, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuthConfig } from '../lib/auth';
import { useLive } from '../lib/live';
import type { EmbedPayload } from '../lib/types';
import {
  Avatar,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  PageHeader,
  SettingRow,
  Switch,
  Textarea,
  useToast
} from '../components/ui';
import { ChannelSelect, GuildSelect } from '../components/pickers';

const EMPTY_EMBED: EmbedPayload = {
  title: '',
  description: '',
  url: '',
  color: '#5865f2',
  authorName: '',
  authorIconUrl: '',
  footerText: '',
  imageUrl: '',
  thumbnailUrl: '',
  timestamp: false,
  fields: []
};

function EmbedPreview({ embed }: { embed: EmbedPayload }) {
  const hasContent = embed.title || embed.description || embed.authorName || embed.footerText || embed.imageUrl || (embed.fields ?? []).some(f => f.name && f.value);
  if (!hasContent) return null;

  return (
    <div className="mt-1 max-w-lg overflow-hidden rounded border-l-4 bg-[#2b2d31] text-[#dbdee1]" style={{ borderColor: embed.color || '#1e1f22' }}>
      <div className="flex gap-4 p-3 pr-4">
        <div className="min-w-0 flex-1 space-y-2">
          {embed.authorName && (
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              {embed.authorIconUrl && <img src={embed.authorIconUrl} alt="" className="size-6 rounded-full" />}
              {embed.authorName}
            </div>
          )}
          {embed.title && <div className={embed.url ? 'font-semibold text-[#00a8fc]' : 'font-semibold text-white'}>{embed.title}</div>}
          {embed.description && <div className="text-sm whitespace-pre-wrap">{embed.description}</div>}
          {(embed.fields ?? []).filter(f => f.name && f.value).length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {(embed.fields ?? []).filter(f => f.name && f.value).map((field, i) => (
                <div key={i} className={field.inline ? 'col-span-1' : 'col-span-3'}>
                  <div className="text-xs font-semibold text-white">{field.name}</div>
                  <div className="text-sm whitespace-pre-wrap">{field.value}</div>
                </div>
              ))}
            </div>
          )}
          {embed.imageUrl && <img src={embed.imageUrl} alt="" className="mt-1 max-h-72 rounded" />}
          {(embed.footerText || embed.timestamp) && (
            <div className="text-xs text-[#b5bac1]">
              {embed.footerText}{embed.footerText && embed.timestamp ? ' • ' : ''}{embed.timestamp ? 'Today at ' + new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
            </div>
          )}
        </div>
        {embed.thumbnailUrl && <img src={embed.thumbnailUrl} alt="" className="size-20 shrink-0 rounded object-cover" />}
      </div>
    </div>
  );
}

export function MessagesPage() {
  const toast = useToast();
  const { overview } = useLive();
  const { data: config } = useAuthConfig();
  const [guildId, setGuildId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [content, setContent] = useState('');
  const [useEmbed, setUseEmbed] = useState(true);
  const [embed, setEmbed] = useState<EmbedPayload>(EMPTY_EMBED);
  const [allowMentions, setAllowMentions] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () => api.post<{ url: string }>('/api/messages', { channelId, content, embed: useEmbed ? embed : undefined, allowMentions }),
    onSuccess: (result) => {
      toast.success('Message sent');
      setLastUrl(result.url);
    },
    onError: (error) => toast.error(error)
  });

  const set = <K extends keyof EmbedPayload>(key: K, value: EmbedPayload[K]) => setEmbed(e => ({ ...e, [key]: value }));
  const fields = embed.fields ?? [];
  const botName = overview?.bot.tag?.split('#')[0] ?? config?.botName ?? 'Luko';

  return (
    <div>
      <PageHeader
        title="Messages"
        description="Send announcements and embeds as the bot"
        actions={lastUrl && <a href={lastUrl} target="_blank" rel="noreferrer"><Button variant="outline"><ExternalLink className="size-4" />Open last message</Button></a>}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Destination" />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Server"><GuildSelect value={guildId} onChange={(id) => { setGuildId(id); setChannelId(''); }} /></Field>
              <Field label="Channel"><ChannelSelect guildId={guildId} kind="text" value={channelId} onChange={setChannelId} /></Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Message" />
            <CardBody className="space-y-4">
              <Field label="Text" hint={`${content.length}/2000`}>
                <Textarea value={content} onChange={(e) => setContent(e.target.value)} maxLength={2000} placeholder="Plain message text (supports Discord markdown)" />
              </Field>
              <SettingRow title="Allow mentions" description="When off, @everyone, @here, roles and users in the message don't ping anyone">
                <Switch checked={allowMentions} onChange={setAllowMentions} label="Allow mentions" />
              </SettingRow>
              <SettingRow title="Include an embed">
                <Switch checked={useEmbed} onChange={setUseEmbed} label="Include an embed" />
              </SettingRow>
            </CardBody>
          </Card>

          {useEmbed && (
            <Card>
              <CardHeader
                title="Embed builder"
                actions={<Button size="sm" variant="ghost" onClick={() => setEmbed(EMPTY_EMBED)}><RotateCcw className="size-3.5" />Reset</Button>}
              />
              <CardBody className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                  <Field label="Title"><Input value={embed.title} onChange={(e) => set('title', e.target.value)} maxLength={256} /></Field>
                  <Field label="Color">
                    <div className="flex gap-2">
                      <input type="color" value={embed.color} onChange={(e) => set('color', e.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-surface" />
                      <Input value={embed.color} onChange={(e) => set('color', e.target.value)} className="w-28 font-mono" />
                    </div>
                  </Field>
                </div>
                <Field label="Title link (optional)"><Input value={embed.url} onChange={(e) => set('url', e.target.value)} placeholder="https://…" /></Field>
                <Field label="Description" hint={`${(embed.description ?? '').length}/4096`}>
                  <Textarea value={embed.description} onChange={(e) => set('description', e.target.value)} maxLength={4096} className="min-h-32" />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Author name"><Input value={embed.authorName} onChange={(e) => set('authorName', e.target.value)} /></Field>
                  <Field label="Author icon URL"><Input value={embed.authorIconUrl} onChange={(e) => set('authorIconUrl', e.target.value)} placeholder="https://…" /></Field>
                  <Field label="Image URL"><Input value={embed.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://…" /></Field>
                  <Field label="Thumbnail URL"><Input value={embed.thumbnailUrl} onChange={(e) => set('thumbnailUrl', e.target.value)} placeholder="https://…" /></Field>
                </div>
                <Field label="Footer"><Input value={embed.footerText} onChange={(e) => set('footerText', e.target.value)} maxLength={2048} /></Field>
                <SettingRow title="Show timestamp"><Switch checked={!!embed.timestamp} onChange={(v) => set('timestamp', v)} label="Show timestamp" /></SettingRow>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium">Fields · {fields.length}/25</span>
                    <Button size="sm" variant="secondary" disabled={fields.length >= 25} onClick={() => set('fields', [...fields, { name: '', value: '', inline: true }])}>
                      <Plus className="size-3.5" />Add field
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {fields.map((field, index) => (
                      <div key={index} className="rounded-lg border border-border p-3">
                        <div className="flex gap-2">
                          <Input value={field.name} placeholder="Field name" onChange={(e) => set('fields', fields.map((f, i) => i === index ? { ...f, name: e.target.value } : f))} />
                          <Button variant="ghost" size="icon" onClick={() => set('fields', fields.filter((_, i) => i !== index))} aria-label="Remove field"><Trash2 className="size-4" /></Button>
                        </div>
                        <Textarea value={field.value} placeholder="Field value" className="mt-2 min-h-16" onChange={(e) => set('fields', fields.map((f, i) => i === index ? { ...f, value: e.target.value } : f))} />
                        <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                          <Switch checked={field.inline} onChange={(inline) => set('fields', fields.map((f, i) => i === index ? { ...f, inline } : f))} label="Inline" />
                          Show inline
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="xl:sticky xl:top-20 xl:self-start">
          <Card>
            <CardHeader title="Preview" description="Roughly how the message will look in Discord" />
            <CardBody className="rounded-b-xl bg-[#313338]">
              <div className="flex gap-3">
                <Avatar src={overview?.bot.avatarUrl ?? config?.botAvatarUrl} name={botName} className="size-10" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-white">{botName}</span>
                    <span className="rounded bg-[#5865f2] px-1 text-[10px] font-semibold text-white">APP</span>
                    <span className="text-xs text-[#949ba4]">Today</span>
                  </div>
                  {content && <div className="text-sm whitespace-pre-wrap text-[#dbdee1]">{content}</div>}
                  {useEmbed && <EmbedPreview embed={embed} />}
                  {!content && !useEmbed && <div className="text-sm text-[#949ba4] italic">Nothing to send yet</div>}
                </div>
              </div>
            </CardBody>
          </Card>

          <Button className="mt-4 w-full justify-center" disabled={!channelId} loading={send.isPending} onClick={() => send.mutate()}>
            <Send className="size-4" />Send message
          </Button>
        </div>
      </div>
    </div>
  );
}
