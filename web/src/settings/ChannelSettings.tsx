import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, http } from '../api/client';
import { errorText } from '../api/errors';
import { ChannelType, type Channel } from '../api/types';
import { Divider, Input, Label, Switch, TextArea } from '../components/ui/Field';
import { confirmDeleteChannel } from '../lib/actions';
import { useChannel } from '../lib/hooks';
import { useData } from '../stores/data';
import { SaveBar, SectionTitle, SettingsLayout, type NavEntry } from './SettingsLayout';

export default function ChannelSettings({ onClose, channelId }: { onClose: () => void; channelId: string }) {
  const navigate = useNavigate();
  const channel = useChannel(channelId);
  useEffect(() => {
    if (!channel) onClose();
  }, [channel, onClose]);
  if (!channel) return null;
  const category = channel.type === ChannelType.GuildCategory;
  const nav: NavEntry[] = [
    { id: 'h', label: category ? 'Kategorie' : `# ${channel.name}`, header: true },
    { id: 'overview', label: 'Übersicht' },
    { id: 's', label: '', separator: true },
    { id: 'delete', label: category ? 'Kategorie löschen' : 'Kanal löschen', danger: true, onClick: () => confirmDeleteChannel(channel.id, navigate) },
  ];
  return (
    <SettingsLayout nav={nav} active="overview" onSelect={() => {}} onClose={onClose}>
      <Overview channel={channel} />
    </SettingsLayout>
  );
}

function Overview({ channel }: { channel: Channel }) {
  const initial = useMemo(
    () => ({ name: channel.name, topic: channel.topic ?? '', nsfw: channel.nsfw, bitrate: channel.bitrate ?? 64000, user_limit: channel.user_limit ?? 0 }),
    [channel],
  );
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(initial);
  }, [initial]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const text = channel.type === ChannelType.GuildText;
  const voice = channel.type === ChannelType.GuildVoice;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name: draft.name };
      if (text) Object.assign(body, { topic: draft.topic.trim() || null, nsfw: draft.nsfw });
      if (voice) Object.assign(body, { bitrate: draft.bitrate, user_limit: draft.user_limit });
      useData.getState().upsertChannel(await http.patch<Channel>(`/channels/${channel.id}`, body));
    } catch (err) {
      setError(err instanceof ApiError ? err.text() ?? null : errorText('NETWORK'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle>Übersicht</SectionTitle>
      <Label htmlFor="c-name">{channel.type === ChannelType.GuildCategory ? 'Kategoriename' : 'Kanalname'}</Label>
      <Input id="c-name" maxLength={100} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: text ? e.target.value.toLowerCase().replace(/\s/g, '-') : e.target.value }))} />
      {text && (
        <>
          <Divider className="my-6" />
          <Label htmlFor="c-topic">Kanalthema</Label>
          <div className="relative">
            <TextArea id="c-topic" rows={4} maxLength={1024} placeholder="Erzähle allen, wie dieser Kanal genutzt werden soll!" value={draft.topic} onChange={(e) => setDraft((d) => ({ ...d, topic: e.target.value }))} />
            <span className="absolute bottom-2 right-3 text-xs text-muted">{1024 - draft.topic.length}</span>
          </div>
          <Divider className="my-6" />
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-base font-medium text-header">Altersbeschränkter Kanal</div>
              <p className="mt-1 text-sm text-muted">Nutzer müssen bestätigen, dass sie volljährig sind, um Inhalte in diesem Kanal zu sehen.</p>
            </div>
            <Switch checked={draft.nsfw} onChange={(nsfw) => setDraft((d) => ({ ...d, nsfw }))} label="Altersbeschränkung" />
          </div>
        </>
      )}
      {voice && (
        <>
          <Divider className="my-6" />
          <Label htmlFor="c-bitrate">Bitrate – {Math.round(draft.bitrate / 1000)} kbps</Label>
          <input id="c-bitrate" type="range" min={8000} max={96000} step={1000} value={draft.bitrate} onChange={(e) => setDraft((d) => ({ ...d, bitrate: Number(e.target.value) }))} className="w-full accent-[var(--color-brand)]" />
          <Divider className="my-6" />
          <Label htmlFor="c-limit">Benutzerlimit – {draft.user_limit === 0 ? '∞' : draft.user_limit}</Label>
          <input id="c-limit" type="range" min={0} max={99} value={draft.user_limit} onChange={(e) => setDraft((d) => ({ ...d, user_limit: Number(e.target.value) }))} className="w-full accent-[var(--color-brand)]" />
        </>
      )}
      <SaveBar visible={dirty || !!error} busy={busy} error={error} onReset={() => (setDraft(initial), setError(null))} onSave={save} />
    </>
  );
}
