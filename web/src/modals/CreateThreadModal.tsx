import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, http } from '../api/client';
import type { Channel } from '../api/types';
import { Button } from '../components/ui/Button';
import { Input, Label } from '../components/ui/Field';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import { showChat } from '../lib/mobile';
import { useData } from '../stores/data';

export default function CreateThreadModal({ onClose, channelId, messageId, defaultName }: { onClose: () => void; channelId: string; messageId?: string; defaultName?: string }) {
  const navigate = useNavigate();
  const [name, setName] = useState(defaultName ?? '');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const thread = await http.post<Channel>(`/channels/${channelId}/threads`, { name, message_id: messageId });
      useData.getState().upsertChannel(thread);
      onClose();
      navigate(`/channels/${thread.guild_id}/${thread.id}`);
      showChat();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'NETWORK'));
      setBusy(false);
    }
  };
  return (
    <Modal onClose={onClose} labelledBy="ct-title">
      <form onSubmit={submit}>
        <ModalHeader id="ct-title" onClose={onClose} title="Thread erstellen" subtitle="Threads halten Nebengespräche zusammen, ohne den Kanal zu überfluten." />
        <ModalBody>
          <Label htmlFor="thread-name" error={error?.text('name') ?? (error && !error.fields.name ? error.text() : undefined)}>
            Thread-Name
          </Label>
          <Input id="thread-name" data-autofocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Worum geht es?" />
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="link" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            Erstellen
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
