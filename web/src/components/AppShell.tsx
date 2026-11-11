import { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { auth } from '../api/client';
import { gateway } from '../api/gateway';
import { ChannelType } from '../api/types';
import { useChannel } from '../lib/hooks';
import { useIsMobile } from '../lib/mobile';
import { defaultChannel } from '../lib/navigation';
import { endSession, startSession } from '../lib/session';
import { useGlobalShortcuts } from '../lib/shortcuts';
import { useData } from '../stores/data';
import { useUi } from '../stores/ui';
import { ChannelSidebar } from './layout/ChannelSidebar';
import { ChatArea, NoChannel } from './layout/ChatArea';
import { GuildBar } from './layout/GuildBar';
import { HomeMain, HomeSidebar } from './layout/Home';
import { MemberList } from './layout/MemberList';
import { MobileShell } from './layout/MobileShell';
import { ModalHost, preloadModals } from './ModalHost';
import { ContextMenuHost } from './ui/ContextMenu';
import { LogoMark } from './ui/Logo';
import { Toasts } from './ui/Toasts';

const TIPS = [
  'Mit Strg+K springst du blitzschnell zu jedem Kanal.',
  'Alt+↑/↓ wechselt zwischen Kanälen, Strg+Alt+↑/↓ zwischen Servern.',
  'Kanäle und Kategorien lassen sich per Drag & Drop sortieren.',
  'Rechtsklick öffnet fast überall ein Kontextmenü.',
];

function LoadingScreen() {
  const tip = TIPS[Math.floor(Date.now() / 10_000) % TIPS.length];
  return (
    <div className="flex h-full flex-col items-center justify-center bg-chat text-center">
      <LogoMark size={88} className="animate-pulse text-brand [--logo-dot:var(--chat)]" />
      <p className="mt-6 text-xs font-bold uppercase tracking-wide text-header">Wusstest du schon?</p>
      <p className="mt-2 max-w-sm text-base text-text">{tip}</p>
    </div>
  );
}

function ReconnectBanner() {
  const connection = useData((s) => s.connection);
  if (connection !== 'reconnecting') return null;
  return (
    <div role="status" className="absolute inset-x-0 top-0 z-50 bg-idle py-1 text-center text-sm font-medium text-black">
      Verbindung verloren – wird wiederhergestellt …
    </div>
  );
}

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const me = useData((s) => s.me);
  const mobile = useIsMobile();
  useGlobalShortcuts(navigate);

  useEffect(() => {
    gateway.onAuthFailed = () => {
      endSession();
      navigate('/login', { replace: true });
    };
    if (auth.token && !gateway.active) startSession(auth.token);
  }, [navigate]);

  const ready = !!me;
  useEffect(() => {
    if (ready) preloadModals();
  }, [ready]);

  if (!auth.token) return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  if (!me) return <LoadingScreen />;

  return (
    <div className="relative flex h-full">
      <ReconnectBanner />
      {!mobile && <GuildBar />}
      <Outlet />
      <ModalHost />
      <ContextMenuHost />
      <Toasts />
    </div>
  );
}

export function HomeView() {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <MobileShell
        nav={
          <>
            <GuildBar />
            <HomeSidebar />
          </>
        }
        chat={<HomeMain />}
      />
    );
  }
  return (
    <>
      <HomeSidebar />
      <HomeMain />
    </>
  );
}

export function GuildView() {
  const { guildId = '', channelId } = useParams();
  const guild = useData((s) => s.guilds[guildId]);
  const channel = useChannel(channelId);
  const memberListOpen = useUi((s) => s.memberListOpen);
  const mobile = useIsMobile();
  const setLastChannel = useUi((s) => s.setLastChannel);
  const valid = !!channel && channel.guild_id === guildId && channel.type === ChannelType.GuildText;

  useEffect(() => {
    if (valid && channelId) setLastChannel(guildId, channelId);
  }, [valid, guildId, channelId, setLastChannel]);

  if (!guild) return <Navigate to="/channels/@me" replace />;
  if (!valid) {
    const fallback = defaultChannel(guildId);
    if (fallback && fallback !== channelId) return <Navigate to={`/channels/${guildId}/${fallback}`} replace />;
  }
  if (mobile) {
    return (
      <MobileShell
        nav={
          <>
            <GuildBar />
            <ChannelSidebar guildId={guildId} />
          </>
        }
        chat={valid ? <ChatArea key={channel.id} channel={channel} /> : <NoChannel />}
        members={valid ? <MemberList guildId={guildId} /> : undefined}
      />
    );
  }
  return (
    <>
      <ChannelSidebar guildId={guildId} />
      {valid ? (
        <div className="flex min-w-0 flex-1">
          <ChatArea key={channel.id} channel={channel} />
          {memberListOpen && <MemberList guildId={guildId} />}
        </div>
      ) : (
        <NoChannel />
      )}
    </>
  );
}
