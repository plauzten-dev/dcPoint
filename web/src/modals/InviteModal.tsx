import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { http } from '../api/client';
import type { Invite } from '../api/types';
import { Button } from '../components/ui/Button';
import { Input, Label } from '../components/ui/Field';
import { Modal, ModalBody, ModalHeader } from '../components/ui/Modal';
import { cn } from '../lib/cn';
import { copyText } from '../lib/format';
import { useChannel } from '../lib/hooks';
import { useData } from '../stores/data';

const AGES = [
  { v: 1800, label: '30 Minuten' },
  { v: 3600, label: '1 Stunde' },
  { v: 21600, label: '6 Stunden' },
  { v: 43200, label: '12 Stunden' },
  { v: 86400, label: '1 Tag' },
  { v: 604800, label: '7 Tage' },
  { v: 0, label: 'Nie' },
];
const USES = [0, 1, 5, 10, 25, 50, 100];

export function inviteUrl(code: string) {
  return `${location.origin}/invite/${code}`;
}

export default function InviteModal({ onClose, guildId, channelId }: { onClose: () => void; guildId: string; channelId: string }) {
  const guild = useData((s) => s.guilds[guildId]);
  const channel = useChannel(channelId);
  const [settings, setSettings] = useState({ max_age: 604800, max_uses: 0 });
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const invite = useQuery({
    queryKey: ['invite-create', channelId, settings],
    queryFn: () => http.post<Invite>(`/channels/${channelId}/invites`, settings),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  });
  const url = invite.data ? inviteUrl(invite.data.code) : '';
  const copy = async () => {
    await copyText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };
  const ageLabel = AGES.find((a) => a.v === settings.max_age)?.label ?? '';

  return (
    <Modal onClose={onClose} labelledBy="inv-title">
      <ModalHeader id="inv-title" onClose={onClose} title={`Freunde zu ${guild?.name ?? 'diesem Server'} einladen`} subtitle={channel && <span className="text-sm">Empfänger landen in #{channel.name}</span>} />
      <ModalBody>
        {editing ? (
          <div className="space-y-4">
            <div>
              <Label htmlFor="inv-age">Ablauf nach</Label>
              <select
                id="inv-age"
                value={settings.max_age}
                onChange={(e) => setSettings((s) => ({ ...s, max_age: Number(e.target.value) }))}
                className="h-10 w-full rounded-[3px] bg-input-strong px-2 text-text outline-none"
              >
                {AGES.map((a) => (
                  <option key={a.v} value={a.v}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="inv-uses">Maximale Anzahl an Verwendungen</Label>
              <select
                id="inv-uses"
                value={settings.max_uses}
                onChange={(e) => setSettings((s) => ({ ...s, max_uses: Number(e.target.value) }))}
                className="h-10 w-full rounded-[3px] bg-input-strong px-2 text-text outline-none"
              >
                {USES.map((u) => (
                  <option key={u} value={u}>
                    {u === 0 ? 'Keine Begrenzung' : `${u} Verwendung${u === 1 ? '' : 'en'}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setEditing(false)}>Fertig</Button>
            </div>
          </div>
        ) : (
          <>
            <Label>Oder sende anderen einen Server-Einladungslink</Label>
            <div className="flex items-center rounded-[3px] bg-input-strong p-1">
              <Input readOnly value={invite.isPending ? 'Einladung wird erstellt …' : url} data-testid="invite-url" className="h-8 bg-transparent" />
              <Button size="sm" variant={copied ? 'success' : 'brand'} disabled={!invite.data} onClick={copy} className={cn('shrink-0')}>
                {copied ? 'Kopiert' : 'Kopieren'}
              </Button>
            </div>
            {invite.isError && <p className="mt-2 text-sm text-[#fa777c]">Einladung konnte nicht erstellt werden.</p>}
            <p className="mt-2 text-xs text-muted">
              {settings.max_age ? `Deine Einladung läuft in ${ageLabel} ab.` : 'Deine Einladung läuft nie ab.'}{' '}
              <button onClick={() => setEditing(true)} className="text-link hover:underline">
                Einladungslink bearbeiten.
              </button>
            </p>
          </>
        )}
      </ModalBody>
    </Modal>
  );
}
