import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { ApiError, http } from '../api/client';
import { errorText } from '../api/errors';
import type { GuildBase, Invite } from '../api/types';
import { GuildIcon } from '../components/GuildIcon';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Input, Label, TextArea } from '../components/ui/Field';
import { reportError } from '../lib/actions';
import { displayName } from '../lib/cdn';
import { formatDate } from '../lib/format';
import { useCan } from '../lib/hooks';
import { fileToImageDataUri, pickImage } from '../lib/image';
import { P } from '../lib/permissions';
import { useData } from '../stores/data';
import { openModal } from '../stores/overlay';
import { SaveBar, SectionTitle, SettingsLayout, type NavEntry } from './SettingsLayout';

function Overview({ guildId }: { guildId: string }) {
  const guild = useData((s) => s.guilds[guildId])!;
  const initial = useMemo(() => ({ name: guild.name, description: guild.description ?? '', icon: undefined as string | null | undefined }), [guild]);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(initial);
  }, [initial]);
  const dirty = draft.name !== initial.name || draft.description !== initial.description || draft.icon !== undefined;

  const choose = async () => {
    const file = await pickImage();
    if (!file) return;
    try {
      const icon = await fileToImageDataUri(file, 512, 512);
      setDraft((d) => ({ ...d, icon }));
    } catch (e) {
      setError(errorText((e as Error).message));
    }
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name: draft.name, description: draft.description.trim() || null };
      if (draft.icon !== undefined) body.icon = draft.icon;
      useData.getState().updateGuild(await http.patch<GuildBase>(`/guilds/${guildId}`, body));
    } catch (err) {
      setError(err instanceof ApiError ? err.text() ?? null : errorText('NETWORK'));
    } finally {
      setBusy(false);
    }
  };
  const iconPreview = draft.icon === undefined ? guild : { ...guild, icon: null };

  return (
    <>
      <SectionTitle>Serverübersicht</SectionTitle>
      <div className="flex gap-8 max-md:flex-col max-md:gap-5">
        <div className="flex gap-4">
          <div className="relative">
            {draft.icon ? <img src={draft.icon} alt="" className="size-[100px] rounded-full object-cover" /> : <GuildIcon guild={iconPreview} size={100} className="rounded-full text-3xl" />}
          </div>
          <div className="w-[180px]">
            <p className="mb-2 text-sm text-muted">Wir empfehlen ein Bild mit mindestens 512 × 512 Pixeln.</p>
            <Button variant="outline" size="sm" onClick={choose}>
              Bild hochladen
            </Button>
            {(draft.icon ?? guild.icon) && (
              <button className="mt-1 block text-sm text-link hover:underline" onClick={() => setDraft((d) => ({ ...d, icon: null }))}>
                Entfernen
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 space-y-5">
          <div>
            <Label htmlFor="g-name">Servername</Label>
            <Input id="g-name" maxLength={100} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="g-desc">Beschreibung</Label>
            <TextArea id="g-desc" rows={4} maxLength={300} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
          </div>
        </div>
      </div>
      <SaveBar visible={dirty || !!error} busy={busy} error={error} onReset={() => (setDraft(initial), setError(null))} onSave={save} />
    </>
  );
}

function Invites({ guildId }: { guildId: string }) {
  const qc = useQueryClient();
  const invites = useQuery({ queryKey: ['guild-invites', guildId], queryFn: () => http.get<Invite[]>(`/guilds/${guildId}/invites`), staleTime: 0 });
  const revoke = useMutation({
    mutationFn: (code: string) => http.delete(`/invites/${code}`),
    onSuccess: (_, code) => qc.setQueryData<Invite[]>(['guild-invites', guildId], (old) => old?.filter((i) => i.code !== code)),
    onError: reportError,
  });
  return (
    <>
      <SectionTitle>Einladungen</SectionTitle>
      <p className="mb-5 text-sm text-muted">Hier siehst du alle aktiven Einladungslinks. Du kannst sie jederzeit widerrufen.</p>
      <div className="overflow-x-auto">
      <div className="min-w-[520px]">
      <div className="grid grid-cols-[1fr_120px_100px_120px_32px] gap-x-2 border-b border-divider pb-2 text-xs font-bold uppercase text-header-2">
        <span>Einladender</span>
        <span>Code</span>
        <span>Verwendungen</span>
        <span>Läuft ab</span>
        <span />
      </div>
      {invites.isPending && <p className="py-4 text-sm text-muted">Lädt …</p>}
      {invites.data?.length === 0 && <p className="py-6 text-center text-sm text-muted">Keine aktiven Einladungen.</p>}
      {invites.data?.map((i) => (
        <div key={i.code} className="group grid grid-cols-[1fr_120px_100px_120px_32px] items-center gap-x-2 border-b border-divider py-2.5 text-sm text-text">
          <span className="flex min-w-0 items-center gap-2">
            {i.inviter && <Avatar user={i.inviter} size={24} />}
            <span className="truncate">{i.inviter ? displayName(i.inviter) : 'Unbekannt'}</span>
          </span>
          <span className="font-mono">{i.code}</span>
          <span>
            {i.uses}
            {i.max_uses ? ` / ${i.max_uses}` : ''}
          </span>
          <span>{i.expires_at ? formatDate(i.expires_at) : '∞'}</span>
          <button
            aria-label="Einladung widerrufen"
            onClick={() => revoke.mutate(i.code)}
            className="invisible flex size-6 items-center justify-center rounded-full bg-danger text-white group-hover:visible [@media(hover:none)]:visible"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      </div>
      </div>
    </>
  );
}

export default function GuildSettings({ onClose, guildId, section }: { onClose: () => void; guildId: string; section?: string }) {
  const navigate = useNavigate();
  const guild = useData((s) => s.guilds[guildId]);
  const isOwner = useData((s) => s.me?.id === s.guilds[guildId]?.owner_id);
  const canManage = useCan(guildId, P.MANAGE_GUILD);
  const [active, setActive] = useState(section ?? 'overview');
  useEffect(() => {
    if (!guild) onClose();
  }, [guild, onClose]);
  if (!guild) return null;

  const nav: NavEntry[] = [
    { id: 'h', label: guild.name, header: true },
    { id: 'overview', label: 'Übersicht' },
    ...(canManage ? [{ id: 'invites', label: 'Einladungen' }] : []),
    ...(isOwner
      ? [
          { id: 's', label: '', separator: true },
          {
            id: 'delete',
            label: 'Server löschen',
            danger: true,
            onClick: () =>
              openModal({
                type: 'confirm',
                title: `„${guild.name}“ löschen`,
                body: 'Willst du diesen Server wirklich löschen? Alle Kanäle, Rollen und Einladungen gehen unwiderruflich verloren.',
                confirm: 'Server löschen',
                danger: true,
                onConfirm: async () => {
                  await http.delete(`/guilds/${guildId}`);
                  useData.getState().removeGuild(guildId);
                  onClose();
                  navigate('/channels/@me');
                },
              }),
          },
        ]
      : []),
  ];
  return (
    <SettingsLayout nav={nav} active={active} onSelect={setActive} onClose={onClose}>
      {active === 'overview' && <Overview guildId={guildId} />}
      {active === 'invites' && <Invites guildId={guildId} />}
    </SettingsLayout>
  );
}
