import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { ApiError, http } from '../api/client';
import type { PrivateUser } from '../api/types';
import { Button } from '../components/ui/Button';
import { Input, Label } from '../components/ui/Field';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import { cn } from '../lib/cn';
import { useData } from '../stores/data';

const EMOJIS = ['😀', '😎', '🎮', '🎧', '💻', '📚', '☕', '🍕', '🌙', '🔥', '✈️', '🏖️', '🤒', '🎉', '🚀', '💤'];
const CLEAR_AFTER = [
  { v: 'today', label: 'Heute' },
  { v: '4h', label: '4 Stunden' },
  { v: '1h', label: '1 Stunde' },
  { v: '30m', label: '30 Minuten' },
  { v: 'never', label: 'Nicht löschen' },
] as const;

function expiry(v: (typeof CLEAR_AFTER)[number]['v']): string | null {
  const now = new Date();
  switch (v) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
    case '4h':
      return new Date(now.getTime() + 4 * 3600_000).toISOString();
    case '1h':
      return new Date(now.getTime() + 3600_000).toISOString();
    case '30m':
      return new Date(now.getTime() + 1800_000).toISOString();
    default:
      return null;
  }
}

export default function CustomStatusModal({ onClose }: { onClose: () => void }) {
  const me = useData((s) => s.me);
  const [text, setText] = useState(me?.custom_status?.text ?? '');
  const [emoji, setEmoji] = useState<string | null>(me?.custom_status?.emoji ?? null);
  const [clear, setClear] = useState<(typeof CLEAR_AFTER)[number]['v']>('today');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const custom_status = text.trim() || emoji ? { text: text.trim() || null, emoji, expires_at: expiry(clear) } : null;
      useData.getState().setMe(await http.patch<PrivateUser>('/users/@me/settings', { custom_status }));
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.text() ?? null : null);
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} labelledBy="cs-title">
      <form onSubmit={submit}>
        <ModalHeader id="cs-title" center onClose={onClose} title="Benutzerdefinierten Status festlegen" />
        <ModalBody className="pt-5">
          <Label htmlFor="cs-text" error={error ?? undefined}>
            Was ist los, {me?.display_name || me?.username}?
          </Label>
          <div className="relative flex items-center rounded-[3px] bg-input-strong">
            <button type="button" aria-label="Emoji wählen" onClick={() => setPickerOpen((o) => !o)} className="flex size-10 shrink-0 items-center justify-center text-xl">
              {emoji ?? '🙂'}
            </button>
            <Input id="cs-text" data-autofocus value={text} onChange={(e) => setText(e.target.value)} maxLength={128} placeholder="Unterwegs" className="bg-transparent px-0" />
            {(text || emoji) && (
              <button type="button" aria-label="Leeren" onClick={() => (setText(''), setEmoji(null))} className="px-2 text-icon hover:text-icon-hover">
                <X size={18} />
              </button>
            )}
            {pickerOpen && (
              <div className="absolute left-0 top-11 z-10 grid w-64 grid-cols-8 gap-1 rounded-lg bg-floating p-2 shadow-elevation">
                {EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => (setEmoji(em), setPickerOpen(false))}
                    className={cn('flex size-7 items-center justify-center rounded text-lg hover:bg-hover', em === emoji && 'bg-selected')}
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-5">
            <Label htmlFor="cs-clear">Löschen nach</Label>
            <select
              id="cs-clear"
              value={clear}
              onChange={(e) => setClear(e.target.value as typeof clear)}
              className="h-10 w-full rounded-[3px] bg-input-strong px-2 text-text outline-none"
            >
              {CLEAR_AFTER.map((c) => (
                <option key={c.v} value={c.v}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="link" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" loading={busy}>
            Speichern
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
