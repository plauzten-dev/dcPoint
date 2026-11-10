import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Hash, Lock, Volume2 } from 'lucide-react';
import { ApiError, http } from '../api/client';
import { ChannelType, type Channel } from '../api/types';
import { Button } from '../components/ui/Button';
import { Input, Label, Switch } from '../components/ui/Field';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import { cn } from '../lib/cn';
import { useData } from '../stores/data';

interface Props {
  onClose: () => void;
  guildId: string;
  parentId?: string | null;
  category?: boolean;
}

const TYPES = [
  { type: ChannelType.GuildText, icon: Hash, label: 'Text', hint: 'Schreibe Nachrichten, teile Bilder, Links und Gedanken' },
  { type: ChannelType.GuildVoice, icon: Volume2, label: 'Sprache', hint: 'Unterhalte dich per Sprache, Video und Bildschirmübertragung' },
] as const;

export default function CreateChannelModal({ onClose, guildId, parentId, category }: Props) {
  const navigate = useNavigate();
  const parent = useData((s) => (parentId ? s.channels[guildId]?.[parentId] : undefined));
  const [type, setType] = useState<number>(category ? ChannelType.GuildCategory : ChannelType.GuildText);
  const [name, setName] = useState('');
  const [priv, setPriv] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const isText = type === ChannelType.GuildText;
  const preview = isText ? name.toLowerCase().replace(/\s+/g, '-') : name;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const c = await http.post<Channel>(`/guilds/${guildId}/channels`, { name, type, parent_id: parentId ?? undefined, private: priv });
      useData.getState().upsertChannel(c);
      onClose();
      if (c.type === ChannelType.GuildText) navigate(`/channels/${guildId}/${c.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'NETWORK'));
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} labelledBy="cc-title" className="w-[460px]">
      <form onSubmit={submit}>
        <ModalHeader
          id="cc-title"
          onClose={onClose}
          title={category ? 'Kategorie erstellen' : 'Kanal erstellen'}
          subtitle={!category && parent ? <span className="text-xs">in {parent.name}</span> : undefined}
        />
        <ModalBody>
          {!category && (
            <fieldset className="mb-5">
              <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-header-2">Kanaltyp</legend>
              <div className="space-y-2">
                {TYPES.map((t) => (
                  <label
                    key={t.type}
                    className={cn('flex cursor-pointer items-center gap-3 rounded bg-sidebar px-3 py-2.5 hover:bg-hover', type === t.type && 'bg-selected')}
                  >
                    <t.icon size={24} className="shrink-0 text-icon" />
                    <span className="flex-1">
                      <span className="block text-base font-medium text-header">{t.label}</span>
                      <span className="block text-sm text-muted">{t.hint}</span>
                    </span>
                    <input type="radio" name="type" checked={type === t.type} onChange={() => setType(t.type)} className="size-5 accent-[var(--color-brand)]" />
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <Label htmlFor="channel-name" error={error?.text('name') ?? (error && !error.fields.name ? error.text() : undefined)}>
            {category ? 'Kategoriename' : 'Kanalname'}
          </Label>
          <div className="relative">
            {!category && (
              <span className="pointer-events-none absolute left-2.5 top-2.5 text-icon">{isText ? <Hash size={18} /> : <Volume2 size={18} />}</span>
            )}
            <Input
              id="channel-name"
              data-autofocus
              value={isText ? preview : name}
              onChange={(e) => setName(e.target.value)}
              placeholder={category ? 'Neue Kategorie' : isText ? 'neuer-kanal' : 'Neuer Kanal'}
              maxLength={100}
              className={cn(!category && 'pl-8')}
            />
          </div>
          <div className="mt-5 flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-base font-medium text-header">
                <Lock size={16} /> {category ? 'Private Kategorie' : 'Privater Kanal'}
              </div>
              <p className="mt-1 text-sm text-muted">
                {category
                  ? 'Nur ausgewählte Mitglieder und Rollen können diese Kategorie sehen.'
                  : 'Nur ausgewählte Mitglieder und Rollen können diesen Kanal sehen.'}
              </p>
            </div>
            <Switch checked={priv} onChange={setPriv} label="Privat" />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="link" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            {category ? 'Kategorie erstellen' : 'Kanal erstellen'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
