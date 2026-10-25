import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useMe } from './lib/auth';
import { LiveProvider } from './lib/live';
import { Layout } from './components/Layout';
import { PageLoader } from './components/ui';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';

// Pages other than the dashboard are loaded on demand to keep the first load small.
function page<K extends string, P>(load: () => Promise<Record<K, ComponentType<P>>>, name: K) {
  return lazy(() => load().then(module => ({ default: module[name] })));
}

const MusicPage = page(() => import('./pages/Music'), 'MusicPage');
const PinboardPage = page(() => import('./pages/Pinboard'), 'PinboardPage');
const PinboardBoardPage = page(() => import('./pages/Pinboard'), 'PinboardBoardPage');
const RemindersPage = page(() => import('./pages/Reminders'), 'RemindersPage');
const ServersPage = page(() => import('./pages/Servers'), 'ServersPage');
const CommandsPage = page(() => import('./pages/Commands'), 'CommandsPage');
const MessagesPage = page(() => import('./pages/Messages'), 'MessagesPage');
const PresencePage = page(() => import('./pages/Presence'), 'PresencePage');
const LogsPage = page(() => import('./pages/Logs'), 'LogsPage');
const EmojisPage = page(() => import('./pages/Emojis'), 'EmojisPage');
const LavalinkPage = page(() => import('./pages/Lavalink'), 'LavalinkPage');
const SettingsPage = page(() => import('./pages/Settings'), 'SettingsPage');

function ProtectedApp() {
  const { data, isLoading } = useMe();

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center"><PageLoader /></div>;
  }

  if (!data?.user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <LiveProvider>
      <Layout user={data.user}>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route index element={<DashboardPage />} />
            <Route path="music" element={<MusicPage />} />
            <Route path="pinboard" element={<PinboardPage />} />
            <Route path="pinboard/:boardId" element={<PinboardBoardPage />} />
            <Route path="reminders" element={<RemindersPage />} />
            <Route path="servers" element={<ServersPage />} />
            <Route path="servers/:guildId" element={<ServersPage />} />
            <Route path="commands" element={<CommandsPage />} />
            <Route path="messages" element={<MessagesPage />} />
            <Route path="presence" element={<PresencePage />} />
            <Route path="emojis" element={<EmojisPage />} />
            <Route path="lavalink" element={<LavalinkPage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="settings" element={<SettingsPage user={data.user} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    </LiveProvider>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={<ProtectedApp />} />
    </Routes>
  );
}
