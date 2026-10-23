import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Network } from 'lucide-react';
import { api } from '../lib/api';
import { useAuthConfig, useMe } from '../lib/auth';
import { Avatar, Button, Input, Notice, PageLoader } from '../components/ui';

const ERRORS: Record<string, string> = {
  forbidden: 'Your Discord account is not on the admin list for this bot.',
  state: 'The login session expired. Please try again.',
  oauth: 'Discord login failed. Check DISCORD_CLIENT_SECRET and the redirect URL in the Discord Developer Portal.',
  cancelled: 'Login was cancelled.',
  discord_disabled: 'Discord login is not configured on this bot.'
};

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.2.37-.44.85-.6 1.23a18.3 18.3 0 0 0-5.5 0 12.6 12.6 0 0 0-.61-1.23.08.08 0 0 0-.08-.04 19.7 19.7 0 0 0-4.88 1.52.07.07 0 0 0-.04.03C.53 9.05-.32 13.6.1 18.08c0 .02.01.04.03.06a19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-1.99a.08.08 0 0 0-.04-.1 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1 0-.12l.37-.29a.07.07 0 0 1 .08-.01c3.93 1.8 8.18 1.8 12.07 0a.07.07 0 0 1 .08 0l.37.3a.08.08 0 0 1 0 .12c-.6.35-1.22.65-1.87.9a.08.08 0 0 0-.04.1c.36.7.77 1.36 1.22 1.99a.08.08 0 0 0 .09.03 19.8 19.8 0 0 0 6-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.69-3.55-13.68a.06.06 0 0 0-.03-.03ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Z" />
    </svg>
  );
}

export function LoginPage() {
  const { data: me, isLoading: meLoading } = useMe();
  const { data: config, isLoading } = useAuthConfig();
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(ERRORS[params.get('error') ?? ''] ?? null);
  const [submitting, setSubmitting] = useState(false);
  const queryClient = useQueryClient();

  if (meLoading || isLoading) {
    return <div className="flex min-h-screen items-center justify-center"><PageLoader /></div>;
  }

  if (me?.user) {
    return <Navigate to="/" replace />;
  }

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/api/auth/password', { password });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  const noMethod = config && !config.discord && !config.password;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[48rem] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />

      <div className="relative w-full max-w-sm space-y-4">
        <div className="rounded-2xl border border-border bg-surface p-7 shadow-xl">
          <div className="mb-6 flex flex-col items-center text-center">
            <Avatar src={config?.botAvatarUrl} name={config?.botName ?? 'Luko'} className="mb-3 size-14" />
            <h1 className="text-lg font-semibold">{config?.botName ?? 'Luko'} Admin Panel</h1>
            <p className="mt-1 text-sm text-muted">Sign in to manage the bot</p>
          </div>

          {error && <Notice tone="danger" className="mb-4">{error}</Notice>}

          <div className="space-y-3">
            {config?.discord && (
              <a
                href="/auth/discord"
                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#5865F2] text-sm font-medium text-white shadow-sm transition hover:brightness-110"
              >
                <DiscordIcon />
                Continue with Discord
              </a>
            )}

            {config?.discord && config?.password && (
              <div className="flex items-center gap-3 text-[11px] text-muted uppercase">
                <span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" />
              </div>
            )}

            {config?.password && (
              <form onSubmit={submitPassword} className="space-y-3">
                <Input
                  type="password"
                  placeholder="Panel password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <Button type="submit" variant={config.discord ? 'secondary' : 'primary'} className="w-full justify-center" loading={submitting}>
                  <KeyRound className="size-4" />
                  Sign in with password
                </Button>
              </form>
            )}

            {noMethod && (
              <Notice tone="warning" title="No login method configured">
                Set <code>DISCORD_CLIENT_SECRET</code> (Discord login) and/or <code>PANEL_PASSWORD</code> in the bot's
                <code> .env</code> file, then restart the bot.
              </Notice>
            )}
          </div>
        </div>

        {config?.mode === 'local' && (
          <div className="rounded-2xl border border-warning/30 bg-surface p-5 text-sm shadow-sm">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <Network className="size-4 text-warning" />
              Local network mode
            </div>
            <p className="text-xs leading-relaxed text-muted">
              No domain is configured for this panel. With the current local setup, the panel and the login only work
              via the server's IP address, and only from devices on the same network.
            </p>
            {config.lanUrls.length > 0 && (
              <div className="mt-3 space-y-1">
                {config.lanUrls.map(url => (
                  <code key={url} className="block rounded-md bg-surface-2 px-2 py-1 text-xs">{url}</code>
                ))}
              </div>
            )}
            {config.discord && (
              <p className="mt-3 text-xs leading-relaxed text-muted">
                For Discord login, add this redirect URL in the Discord Developer Portal (OAuth2 → Redirects):
                <code className="mt-1 block rounded-md bg-surface-2 px-2 py-1 break-all">{config.redirectUri}</code>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
