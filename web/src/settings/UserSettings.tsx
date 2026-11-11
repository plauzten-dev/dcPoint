import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { renderSVG } from 'uqr';
import { Check } from 'lucide-react';
import { ApiError, http } from '../api/client';
import { errorText } from '../api/errors';
import type { PrivateUser } from '../api/types';
import { ProfileCard } from '../components/ProfileCard';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Divider, Input, Label, TextArea } from '../components/ui/Field';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import { bannerUrl, colorToHex, defaultAvatarColor, displayName } from '../lib/cdn';
import { cn } from '../lib/cn';
import { fileToImageDataUri, pickImage } from '../lib/image';
import { logout } from '../lib/session';
import { SHORTCUTS } from '../lib/shortcuts';
import { useData } from '../stores/data';
import { openModal } from '../stores/overlay';
import { useUi } from '../stores/ui';
import { Row, SaveBar, SectionTitle, SettingsLayout, type NavEntry } from './SettingsLayout';

type Section = 'account' | 'profiles' | 'appearance' | 'keybinds';

function useMe(): PrivateUser {
  return useData((s) => s.me)!;
}

async function patchMe(body: Record<string, unknown>): Promise<PrivateUser> {
  const me = await http.patch<PrivateUser>('/users/@me', body);
  useData.getState().setMe(me);
  return me;
}

function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  return `${'*'.repeat(Math.max(3, local.length))}@${domain}`;
}

/** Small modal form used for username / password changes. */
function FormModal({
  title,
  fields,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  fields: Array<{ name: string; label: string; type?: string; initial?: string }>;
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  onClose: () => void;
}) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.name, f.initial ?? ''])));
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'NETWORK'));
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[150]">
      <Modal onClose={onClose} nested>
        <form onSubmit={submit}>
          <ModalHeader center title={title} onClose={onClose} />
          <ModalBody className="space-y-4 pt-5">
            {fields.map((f, i) => (
              <div key={f.name}>
                <Label htmlFor={`fm-${f.name}`} error={error?.text(f.name) ?? (i === 0 && error && !Object.keys(error.fields).length ? error.text() : undefined)}>
                  {f.label}
                </Label>
                <Input
                  id={`fm-${f.name}`}
                  type={f.type ?? 'text'}
                  value={values[f.name]}
                  data-autofocus={i === 0 ? true : undefined}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                />
              </div>
            ))}
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="link" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit" loading={busy}>
              {submitLabel}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}

function TwoFactor({ me }: { me: PrivateUser }) {
  const [step, setStep] = useState<'idle' | 'password' | 'scan' | 'disable'>('idle');
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const qr = useMemo(() => (setup ? renderSVG(setup.uri, { border: 2 }) : ''), [setup]);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      useData.getState().setMe(await http.post<PrivateUser>('/users/@me/mfa/totp/confirm', { secret: setup!.secret, code }));
      setStep('idle');
      setSetup(null);
      setCode('');
    } catch (err) {
      setError(err instanceof ApiError ? err.text() ?? null : errorText('NETWORK'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10" data-testid="mfa-section">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-header-2">Zwei-Faktor-Authentifizierung</h3>
      {me.mfa_enabled ? (
        <>
          <p className="mb-4 flex items-center gap-2 text-sm text-online">
            <Check size={16} /> Zwei-Faktor-Authentifizierung ist aktiviert.
          </p>
          <Button variant="outline" size="sm" onClick={() => setStep('disable')} className="!border-danger !text-[#f23f43]">
            2FA entfernen
          </Button>
        </>
      ) : (
        <>
          <p className="mb-4 max-w-[540px] text-sm text-muted">Schütze dein Konto mit einer zusätzlichen Sicherheitsebene. Nach der Einrichtung brauchst du beim Anmelden dein Passwort und einen Code aus deiner Authenticator-App.</p>
          <Button size="sm" onClick={() => setStep('password')}>
            Zwei-Faktor-Auth aktivieren
          </Button>
        </>
      )}
      {step === 'password' && (
        <FormModal
          title="Passwort bestätigen"
          fields={[{ name: 'password', label: 'Passwort', type: 'password' }]}
          submitLabel="Weiter"
          onClose={() => setStep((s) => (s === 'password' ? 'idle' : s))}
          onSubmit={async (v) => {
            setSetup(await http.post<{ secret: string; uri: string }>('/users/@me/mfa/totp/enable', v));
            setStep('scan');
          }}
        />
      )}
      {step === 'scan' && setup && (
        <div className="fixed inset-0 z-[150]">
          <Modal onClose={() => setStep('idle')} className="w-[540px]" nested>
            <form onSubmit={confirm}>
              <ModalHeader title="Authenticator-App einrichten" onClose={() => setStep('idle')} />
              <ModalBody>
                <div className="flex gap-5">
                  <div className="size-[150px] shrink-0 overflow-hidden rounded bg-white p-1" dangerouslySetInnerHTML={{ __html: qr }} />
                  <div className="text-sm text-text">
                    <p>1. Scanne den QR-Code mit einer Authenticator-App (z. B. Aegis, 2FAS, Google Authenticator).</p>
                    <p className="mt-2">Oder gib diesen Schlüssel manuell ein:</p>
                    <code data-testid="totp-secret" className="mt-1 block select-all break-all rounded bg-input-strong p-2 font-mono text-xs text-header">
                      {setup.secret}
                    </code>
                    <p className="mt-3">2. Gib den 6-stelligen Code aus der App ein.</p>
                  </div>
                </div>
                <div className="mt-5">
                  <Label htmlFor="totp-code" error={error ?? undefined}>
                    Code
                  </Label>
                  <Input id="totp-code" data-autofocus inputMode="numeric" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} />
                </div>
              </ModalBody>
              <ModalFooter>
                <Button type="submit" loading={busy} disabled={code.replace(/\s/g, '').length !== 6}>
                  Aktivieren
                </Button>
              </ModalFooter>
            </form>
          </Modal>
        </div>
      )}
      {step === 'disable' && (
        <FormModal
          title="2FA entfernen"
          fields={[{ name: 'code', label: 'Authentifizierungscode' }]}
          submitLabel="2FA entfernen"
          onClose={() => setStep('idle')}
          onSubmit={async (v) => useData.getState().setMe(await http.post<PrivateUser>('/users/@me/mfa/totp/disable', v))}
        />
      )}
    </section>
  );
}

function AccountSection({ goProfiles }: { goProfiles: () => void }) {
  const me = useMe();
  const [showEmail, setShowEmail] = useState(false);
  const [dialog, setDialog] = useState<'username' | 'password' | null>(null);
  const banner = bannerUrl(me);
  return (
    <>
      <SectionTitle>Mein Account</SectionTitle>
      <div className="overflow-hidden rounded-lg bg-panel">
        <div
          className="h-[100px] bg-cover bg-center"
          style={banner ? { backgroundImage: `url(${banner})` } : { background: me.accent_color !== null ? colorToHex(me.accent_color) : defaultAvatarColor(me.id) }}
        />
        <div className="flex flex-wrap items-end gap-x-4 px-4">
          <div className="-mt-10 rounded-full bg-panel p-1.5">
            <Avatar user={me} size={80} status={me.status} ring="var(--panel)" />
          </div>
          <div className="mb-2 min-w-0 flex-1 truncate text-xl font-semibold text-header">{displayName(me)}</div>
          <Button size="sm" className="mb-3" onClick={goProfiles}>
            Benutzerprofil bearbeiten
          </Button>
        </div>
        <div className="m-4 mt-2 rounded-lg bg-sidebar p-4">
          <Row label="Anzeigename" value={me.display_name ?? <span className="text-muted">Du hast noch keinen Anzeigenamen festgelegt.</span>} action={<Button variant="secondary" size="sm" onClick={goProfiles}>Bearbeiten</Button>} />
          <Row label="Benutzername" value={me.username} action={<Button variant="secondary" size="sm" onClick={() => setDialog('username')}>Bearbeiten</Button>} />
          <Row
            label="E-Mail"
            value={
              <>
                {showEmail ? me.email : maskEmail(me.email)}{' '}
                <button className="text-sm text-link hover:underline" onClick={() => setShowEmail((s) => !s)}>
                  {showEmail ? 'Verbergen' : 'Anzeigen'}
                </button>
              </>
            }
          />
        </div>
      </div>
      <Divider className="my-10" />
      <h2 className="mb-5 text-xl font-semibold text-header">Passwort und Authentifizierung</h2>
      <Button size="sm" onClick={() => setDialog('password')}>
        Passwort ändern
      </Button>
      <TwoFactor me={me} />
      {dialog === 'username' && (
        <FormModal
          title="Benutzernamen ändern"
          fields={[
            { name: 'username', label: 'Benutzername', initial: me.username },
            { name: 'password', label: 'Aktuelles Passwort', type: 'password' },
          ]}
          submitLabel="Fertig"
          onClose={() => setDialog(null)}
          onSubmit={async (v) => void (await patchMe(v))}
        />
      )}
      {dialog === 'password' && (
        <FormModal
          title="Passwort ändern"
          fields={[
            { name: 'password', label: 'Aktuelles Passwort', type: 'password' },
            { name: 'new_password', label: 'Neues Passwort', type: 'password' },
          ]}
          submitLabel="Fertig"
          onClose={() => setDialog(null)}
          onSubmit={async (v) => void (await http.post('/users/@me/password', v))}
        />
      )}
    </>
  );
}

function ProfilesSection() {
  const me = useMe();
  const initial = useMemo(
    () => ({ display_name: me.display_name ?? '', pronouns: me.pronouns, bio: me.bio, accent_color: me.accent_color, avatar: undefined as string | null | undefined, banner: undefined as string | null | undefined }),
    [me],
  );
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(initial);
  }, [initial]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const choose = async (kind: 'avatar' | 'banner') => {
    const file = await pickImage();
    if (!file) return;
    try {
      const uri = kind === 'avatar' ? await fileToImageDataUri(file, 256, 256) : await fileToImageDataUri(file, 960, 384);
      setDraft((d) => ({ ...d, [kind]: uri }));
    } catch (e) {
      setError(errorText((e as Error).message));
    }
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { display_name: draft.display_name.trim() || null, pronouns: draft.pronouns, bio: draft.bio, accent_color: draft.accent_color };
      if (draft.avatar !== undefined) body.avatar = draft.avatar;
      if (draft.banner !== undefined) body.banner = draft.banner;
      await patchMe(body);
    } catch (err) {
      setError(err instanceof ApiError ? err.text() ?? null : errorText('NETWORK'));
    } finally {
      setBusy(false);
    }
  };

  const preview = {
    ...me,
    display_name: draft.display_name || null,
    pronouns: draft.pronouns,
    bio: draft.bio,
    accent_color: draft.accent_color,
  };
  const previewAvatar = draft.avatar;
  const previewBanner = draft.banner;

  return (
    <>
      <SectionTitle>Profile</SectionTitle>
      <div className="flex gap-8 max-lg:flex-col">
        <div className="min-w-0 flex-1 space-y-6">
          <div>
            <Label htmlFor="p-display">Anzeigename</Label>
            <Input id="p-display" maxLength={32} value={draft.display_name} onChange={(e) => setDraft((d) => ({ ...d, display_name: e.target.value }))} />
          </div>
          <Divider />
          <div>
            <Label htmlFor="p-pronouns">Pronomen</Label>
            <Input id="p-pronouns" maxLength={40} placeholder="Füge deine Pronomen hinzu" value={draft.pronouns} onChange={(e) => setDraft((d) => ({ ...d, pronouns: e.target.value }))} />
          </div>
          <Divider />
          <div>
            <Label>Avatar</Label>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => choose('avatar')}>
                Avatar ändern
              </Button>
              {(draft.avatar ?? me.avatar) && (
                <Button size="sm" variant="link" onClick={() => setDraft((d) => ({ ...d, avatar: null }))}>
                  Avatar entfernen
                </Button>
              )}
            </div>
          </div>
          <Divider />
          <div>
            <Label>Profilbanner</Label>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => choose('banner')}>
                Banner ändern
              </Button>
              {(draft.banner ?? me.banner) && (
                <Button size="sm" variant="link" onClick={() => setDraft((d) => ({ ...d, banner: null }))}>
                  Banner entfernen
                </Button>
              )}
            </div>
          </div>
          <Divider />
          <div>
            <Label htmlFor="p-color">Bannerfarbe</Label>
            <input
              id="p-color"
              type="color"
              value={colorToHex(draft.accent_color ?? 0x6c5cf6)}
              onChange={(e) => setDraft((d) => ({ ...d, accent_color: parseInt(e.target.value.slice(1), 16) }))}
              className="h-12 w-[70px] cursor-pointer rounded border-0 bg-transparent"
            />
          </div>
          <Divider />
          <div>
            <Label htmlFor="p-bio">Über mich</Label>
            <p className="mb-2 text-sm text-muted">Du kannst Markdown und Links verwenden (Darstellung ab Phase 2).</p>
            <div className="relative">
              <TextArea id="p-bio" rows={5} maxLength={190} value={draft.bio} onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))} />
              <span className="absolute bottom-2 right-3 text-xs text-muted">{190 - draft.bio.length}</span>
            </div>
          </div>
        </div>
        <div className="w-[300px] max-w-full shrink-0">
          <Label>Vorschau</Label>
          <div className="overflow-hidden rounded-lg bg-floating shadow-elevation">
            <PreviewCard user={preview} avatar={previewAvatar} banner={previewBanner} status={me.status} />
          </div>
        </div>
      </div>
      <SaveBar visible={dirty || !!error} busy={busy} error={error} onReset={() => (setDraft(initial), setError(null))} onSave={save} />
    </>
  );
}

/** ProfileCard preview that can show unsaved data URIs for avatar/banner. */
function PreviewCard({ user, avatar, banner, status }: { user: PrivateUser; avatar?: string | null; banner?: string | null; status: PrivateUser['status'] }) {
  if (avatar === undefined && banner === undefined) return <ProfileCard user={user} status={status} customStatus={user.custom_status} />;
  return (
    <div className="relative">
      <ProfileCard user={{ ...user, avatar: avatar === null ? null : user.avatar, banner: banner === null ? null : user.banner }} status={status} customStatus={user.custom_status} />
      {banner && <img src={banner} alt="" className="absolute left-0 top-0 h-[105px] w-full rounded-t-lg object-cover" />}
      {avatar && <img src={avatar} alt="" className="absolute left-[22px] size-20 rounded-full object-cover" style={{ top: (banner ?? user.banner) ? 66 : 22 }} />}
    </div>
  );
}

function AppearanceSection() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const options = [
    { id: 'dark' as const, label: 'Dunkel', bg: '#313338' },
    { id: 'light' as const, label: 'Hell', bg: '#ffffff' },
  ];
  return (
    <>
      <SectionTitle>Darstellung</SectionTitle>
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-header-2">Design</h3>
      <div className="flex gap-6">
        {options.map((o) => (
          <button key={o.id} onClick={() => setTheme(o.id)} aria-pressed={theme === o.id} className="flex flex-col items-center gap-2">
            <span
              className={cn('flex size-[60px] items-center justify-center rounded-full border border-[#80848e]', theme === o.id && 'ring-2 ring-brand ring-offset-2 ring-offset-chat')}
              style={{ background: o.bg }}
            >
              {theme === o.id && (
                <span className="flex size-6 items-center justify-center rounded-full bg-brand text-white">
                  <Check size={16} strokeWidth={3} />
                </span>
              )}
            </span>
            <span className="text-sm text-text">{o.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function KeybindsSection() {
  return (
    <>
      <SectionTitle>Tastaturkürzel</SectionTitle>
      <div className="divide-y divide-divider">
        {SHORTCUTS.map((s) => (
          <div key={s.label} className="flex items-center justify-between py-3">
            <span className="text-base text-text">{s.label}</span>
            <span className="flex gap-1">
              {s.keys.map((k) => (
                <kbd key={k} className="min-w-6 rounded border-b-2 border-black/30 bg-input-strong px-1.5 py-0.5 text-center text-xs font-semibold text-header">
                  {k}
                </kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

export default function UserSettings({ onClose, section }: { onClose: () => void; section?: string }) {
  const navigate = useNavigate();
  const [active, setActive] = useState<Section>((section as Section) ?? 'account');
  const nav: NavEntry[] = [
    { id: 'h-user', label: 'Benutzereinstellungen', header: true },
    { id: 'account', label: 'Mein Account' },
    { id: 'profiles', label: 'Profile' },
    { id: 's1', label: '', separator: true },
    { id: 'h-app', label: 'App-Einstellungen', header: true },
    { id: 'appearance', label: 'Darstellung' },
    { id: 'keybinds', label: 'Tastaturkürzel' },
    { id: 's2', label: '', separator: true },
    {
      id: 'logout',
      label: 'Abmelden',
      danger: true,
      onClick: () =>
        openModal({
          type: 'confirm',
          title: 'Abmelden',
          body: 'Bist du sicher, dass du dich abmelden möchtest?',
          confirm: 'Abmelden',
          danger: true,
          onConfirm: async () => {
            await logout();
            navigate('/login');
          },
        }),
    },
  ];
  return (
    <SettingsLayout nav={nav} active={active} onSelect={(id) => setActive(id as Section)} onClose={onClose} footer="dcPoint 0.1.0 · Phase 1">
      {active === 'account' && <AccountSection goProfiles={() => setActive('profiles')} />}
      {active === 'profiles' && <ProfilesSection />}
      {active === 'appearance' && <AppearanceSection />}
      {active === 'keybinds' && <KeybindsSection />}
    </SettingsLayout>
  );
}
