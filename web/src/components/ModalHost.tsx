import { lazy, Suspense } from 'react';
import { useOverlay, type ModalSpec } from '../stores/overlay';

const loaders = {
  createGuild: () => import('../modals/CreateGuildModal'),
  createChannel: () => import('../modals/CreateChannelModal'),
  invite: () => import('../modals/InviteModal'),
  confirm: () => import('../modals/ConfirmModal'),
  customStatus: () => import('../modals/CustomStatusModal'),
  quickSwitcher: () => import('../modals/QuickSwitcher'),
  userSettings: () => import('../settings/UserSettings'),
  guildSettings: () => import('../settings/GuildSettings'),
  channelSettings: () => import('../settings/ChannelSettings'),
  createThread: () => import('../modals/CreateThreadModal'),
};

const CreateGuildModal = lazy(loaders.createGuild);
const CreateChannelModal = lazy(loaders.createChannel);
const InviteModal = lazy(loaders.invite);
const ConfirmModal = lazy(loaders.confirm);
const CustomStatusModal = lazy(loaders.customStatus);
const QuickSwitcher = lazy(loaders.quickSwitcher);
const UserSettings = lazy(loaders.userSettings);
const GuildSettings = lazy(loaders.guildSettings);
const ChannelSettings = lazy(loaders.channelSettings);
const CreateThreadModal = lazy(loaders.createThread);

/** Warms the lazy chunks once the app is idle so modals open instantly. */
export function preloadModals() {
  const run = () => Object.values(loaders).forEach((load) => void load());
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1500);
}

function render(spec: ModalSpec, close: () => void) {
  switch (spec.type) {
    case 'createGuild':
      return <CreateGuildModal onClose={close} />;
    case 'createChannel':
      return <CreateChannelModal onClose={close} guildId={spec.guildId} parentId={spec.parentId} category={spec.category} />;
    case 'invite':
      return <InviteModal onClose={close} guildId={spec.guildId} channelId={spec.channelId} />;
    case 'confirm':
      return <ConfirmModal onClose={close} {...spec} />;
    case 'customStatus':
      return <CustomStatusModal onClose={close} />;
    case 'quickSwitcher':
      return <QuickSwitcher onClose={close} />;
    case 'userSettings':
      return <UserSettings onClose={close} section={spec.section} />;
    case 'guildSettings':
      return <GuildSettings onClose={close} guildId={spec.guildId} section={spec.section} />;
    case 'channelSettings':
      return <ChannelSettings onClose={close} channelId={spec.channelId} />;
    case 'createThread':
      return <CreateThreadModal onClose={close} channelId={spec.channelId} messageId={spec.messageId} defaultName={spec.defaultName} />;
  }
}

export function ModalHost() {
  const modals = useOverlay((s) => s.modals);
  const closeModal = useOverlay((s) => s.closeModal);
  return (
    <Suspense fallback={null}>
      {modals.map((m) => (
        <div key={m.id}>{render(m.spec, () => closeModal(m.id))}</div>
      ))}
    </Suspense>
  );
}
