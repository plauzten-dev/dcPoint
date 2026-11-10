import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Camera, ChevronRight, Plus } from 'lucide-react';
import { ApiError, http } from '../api/client';
import { errorText } from '../api/errors';
import type { GuildPayload } from '../api/types';
import { Button } from '../components/ui/Button';
import { Input, Label } from '../components/ui/Field';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import { displayName } from '../lib/cdn';
import { fileToImageDataUri, pickImage } from '../lib/image';
import { firstTextChannel } from '../lib/navigation';
import { useData } from '../stores/data';

type Step = 'start' | 'create' | 'join';

function parseInvite(input: string): string {
  const t = input.trim();
  const m = t.match(/\/invite\/([A-Za-z0-9]+)/);
  return m ? m[1] : t.replace(/^.*\//, '');
}

export default function CreateGuildModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const me = useData((s) => s.me);
  const [step, setStep] = useState<Step>('start');
  const [name, setName] = useState(me ? `Server von ${displayName(me)}` : '');
  const [icon, setIcon] = useState<string | null>(null);
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = (g: GuildPayload) => {
    useData.getState().upsertGuild(g);
    onClose();
    navigate(`/channels/${g.id}/${firstTextChannel(g.id) ?? ''}`);
  };

  const chooseIcon = async () => {
    const file = await pickImage();
    if (!file) return;
    try {
      setIcon(await fileToImageDataUri(file, 512, 512));
    } catch (e) {
      setError(errorText((e as Error).message));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === 'create') finish(await http.post<GuildPayload>('/guilds', { name, icon: icon ?? undefined }));
      else finish(await http.post<GuildPayload>(`/invites/${encodeURIComponent(parseInvite(invite))}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.text() ?? null : errorText('NETWORK'));
      setBusy(false);
    }
  };

  if (step === 'start') {
    return (
      <Modal onClose={onClose} labelledBy="cg-title">
        <ModalHeader id="cg-title" center onClose={onClose} title="Erstelle deinen Server" subtitle="Ein Server ist euer gemeinsamer Treffpunkt. Leg in wenigen Sekunden deinen eigenen an." />
        <ModalBody className="pt-6">
          <button
            onClick={() => setStep('create')}
            data-testid="create-own-guild"
            className="flex w-full items-center gap-3 rounded-lg border border-divider p-3 text-left hover:bg-hover"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-brand text-white">
              <Plus size={26} />
            </span>
            <span className="flex-1 text-base font-semibold text-header">Eigenen erstellen</span>
            <ChevronRight className="text-icon" />
          </button>
        </ModalBody>
        <ModalFooter className="flex-col !items-stretch gap-2 text-center">
          <h3 className="text-xl font-semibold text-header">Hast du schon eine Einladung?</h3>
          <Button variant="secondary" grow onClick={() => setStep('join')}>
            Einem Server beitreten
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} labelledBy="cg-title">
      <form onSubmit={submit}>
        {step === 'create' ? (
          <>
            <ModalHeader id="cg-title" center onClose={onClose} title="Dein neuer Server" subtitle="Wähle einen Namen und ein Symbol – beides lässt sich jederzeit ändern." />
            <ModalBody className="pt-6">
              <div className="mb-6 flex justify-center">
                <button
                  type="button"
                  onClick={chooseIcon}
                  aria-label="Server-Symbol hochladen"
                  className="relative flex size-20 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-icon-muted text-icon"
                >
                  {icon ? <img src={icon} alt="" className="size-full object-cover" /> : (
                    <span className="flex flex-col items-center text-[10px] font-bold uppercase">
                      <Camera size={24} />
                      Upload
                    </span>
                  )}
                  <span className="absolute right-0 top-0 flex size-6 items-center justify-center rounded-full bg-brand text-white">
                    <Plus size={16} />
                  </span>
                </button>
              </div>
              <Label htmlFor="guild-name" error={error ?? undefined}>
                Servername
              </Label>
              <Input id="guild-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} data-autofocus />
              <p className="mt-2 text-xs text-muted">Mit dem Erstellen stimmst du den Community-Richtlinien von dcPoint zu.</p>
            </ModalBody>
          </>
        ) : (
          <>
            <ModalHeader id="cg-title" center onClose={onClose} title="Einem Server beitreten" subtitle="Füge einen Einladungslink oder -code ein." />
            <ModalBody className="pt-6">
              <Label htmlFor="invite" required error={error ?? undefined}>
                Einladungslink
              </Label>
              <Input id="invite" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder={`${location.origin}/invite/hTKzmak`} data-autofocus />
              <h4 className="mb-2 mt-4 text-xs font-bold uppercase text-header-2">Beispiele</h4>
              <p className="text-sm text-text">hTKzmak</p>
              <p className="text-sm text-text">{location.origin}/invite/hTKzmak</p>
            </ModalBody>
          </>
        )}
        <ModalFooter className="justify-between">
          <Button type="button" variant="link" onClick={() => (setStep('start'), setError(null))}>
            Zurück
          </Button>
          <Button type="submit" loading={busy} disabled={step === 'create' ? name.trim().length < 2 : !invite.trim()}>
            {step === 'create' ? 'Erstellen' : 'Server beitreten'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
