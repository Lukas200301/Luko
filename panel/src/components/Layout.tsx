import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import {
  AudioWaveform,
  BarChart3,
  Bell,
  Cake,
  Command,
  FileText,
  ListMusic,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Music,
  Pin,
  Radio,
  Server,
  Settings,
  Smile,
  Sun,
  Vote,
  Wrench,
  Wifi,
  WifiOff,
  X
} from 'lucide-react';
import { useLive } from '../lib/live';
import { logout, useAuthConfig } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { cn } from '../lib/utils';
import type { PanelUser } from '../lib/types';
import { Avatar, Badge, Button, StatusDot } from './ui';

const NAV = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }]
  },
  {
    label: 'Features',
    items: [
      { to: '/music', label: 'Music', icon: Music },
      { to: '/playlists', label: 'Playlists', icon: ListMusic },
      { to: '/music/stats', label: 'Music stats', icon: BarChart3 },
      { to: '/pinboard', label: 'Pinboard', icon: Pin },
      { to: '/reminders', label: 'Reminders', icon: Bell },
      { to: '/birthdays', label: 'Birthdays', icon: Cake },
      { to: '/polls', label: 'Polls', icon: Vote }
    ]
  },
  {
    label: 'Manage',
    items: [
      { to: '/servers', label: 'Servers', icon: Server },
      { to: '/commands', label: 'Commands', icon: Command },
      { to: '/messages', label: 'Messages', icon: MessageSquare },
      { to: '/presence', label: 'Presence', icon: Radio },
      { to: '/emojis', label: 'Emojis', icon: Smile }
    ]
  },
  {
    label: 'System',
    items: [
      { to: '/lavalink', label: 'Lavalink', icon: AudioWaveform },
      { to: '/logs', label: 'Logs & Activity', icon: FileText },
      { to: '/maintenance', label: 'Maintenance', icon: Wrench },
      { to: '/settings', label: 'Settings', icon: Settings }
    ]
  }
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { overview } = useLive();
  const { data: config } = useAuthConfig();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 py-5">
        <Avatar src={overview?.bot.avatarUrl ?? config?.botAvatarUrl} name={config?.botName ?? 'Luko'} className="size-9" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{overview?.bot.tag?.split('#')[0] ?? config?.botName ?? 'Luko'}</div>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <StatusDot online={!!overview?.bot.ready} className="scale-75" />
            {overview?.bot.ready ? 'Online' : 'Offline'}
            {overview?.maintenance && <Badge tone="warning">Maintenance</Badge>}
          </div>
        </div>
      </div>

      <nav className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {NAV.map(group => (
          <div key={group.label}>
            <div className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-muted/80 uppercase">{group.label}</div>
            <div className="space-y-0.5">
              {group.items.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/' || item.to === '/music'}
                  onClick={onNavigate}
                  className={({ isActive }) => cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition',
                    isActive ? 'bg-accent/12 font-medium text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg'
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {config?.mode === 'local' && (
        <div className="mx-3 mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
          <div className="mb-0.5 font-semibold text-warning">Local network mode</div>
          No domain is configured, so the panel and login only work via the server's IP from devices on the same network.
        </div>
      )}
    </div>
  );
}

export function Layout({ user, children }: { user: PanelUser; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { connected } = useLive();
  const { theme, toggle } = useTheme();
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border bg-surface lg:block">
        <Sidebar />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%] border-r border-border bg-surface shadow-xl">
            <Button variant="ghost" size="icon" className="absolute top-4 right-3" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="size-4" />
            </Button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur sm:px-6">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
          <Menu className="size-5" />
        </Button>
        <div className="flex items-center gap-2 text-xs text-muted">
          {connected ? <Wifi className="size-3.5 text-success" /> : <WifiOff className="size-3.5 text-danger" />}
          <span className="hidden sm:inline">{connected ? 'Live connection' : 'Reconnecting…'}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <div className="flex items-center gap-2 rounded-lg py-1 pr-1 pl-2">
            <div className="hidden text-right sm:block">
              <div className="text-xs font-medium">{user.username}</div>
              <div className="text-[11px] text-muted capitalize">{user.role}</div>
            </div>
            <Avatar src={user.avatarUrl} name={user.username} className="size-8" />
          </div>
          <Button variant="ghost" size="icon" onClick={logout} aria-label="Log out" title="Log out">
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}
