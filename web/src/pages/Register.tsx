import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError, http } from '../api/client';
import type { PrivateUser } from '../api/types';
import { Button } from '../components/ui/Button';
import { Input, Label } from '../components/ui/Field';
import { startSession } from '../lib/session';
import { AuthLayout } from './AuthLayout';

export default function Register() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ email: '', display_name: '', username: '', password: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await http.post<{ token: string; user: PrivateUser }>('/auth/register', {
        ...form,
        display_name: form.display_name.trim() || undefined,
      });
      startSession(res.token);
      navigate(params.get('redirect') || '/channels/@me', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'NETWORK'));
    } finally {
      setLoading(false);
    }
  };

  const general = error && !Object.keys(error.fields).length ? error.text() : undefined;
  return (
    <AuthLayout>
      <form onSubmit={submit} className="flex flex-col">
        <h1 className="mb-5 text-center text-2xl font-semibold text-header">Ein Konto erstellen</h1>
        {general && <p className="mb-4 rounded bg-danger/15 p-2 text-sm text-[#fa777c]">{general}</p>}
        <Label htmlFor="email" required error={error?.text('email')}>
          E-Mail
        </Label>
        <Input id="email" type="email" autoFocus autoComplete="email" value={form.email} onChange={set('email')} invalid={!!error?.fields.email} />
        <div className="h-5" />
        <Label htmlFor="display_name" error={error?.text('display_name')}>
          Anzeigename
        </Label>
        <Input id="display_name" autoComplete="nickname" value={form.display_name} onChange={set('display_name')} maxLength={32} />
        <p className="mt-1.5 text-xs text-muted">So sehen dich andere. Du kannst Sonderzeichen und Emojis verwenden.</p>
        <div className="h-5" />
        <Label htmlFor="username" required error={error?.text('username')}>
          Benutzername
        </Label>
        <Input
          id="username"
          autoComplete="username"
          value={form.username}
          onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.toLowerCase().replace(/\s/g, '') }))}
          invalid={!!error?.fields.username}
          maxLength={32}
        />
        <p className="mt-1.5 text-xs text-muted">Nur Kleinbuchstaben, Zahlen, _ und Punkte.</p>
        <div className="h-5" />
        <Label htmlFor="password" required error={error?.text('password')}>
          Passwort
        </Label>
        <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} invalid={!!error?.fields.password} />
        <Button type="submit" size="lg" grow loading={loading} className="mt-6">
          Weiter
        </Button>
        <p className="mt-2 text-xs text-muted">Mit der Registrierung stimmst du den Nutzungsbedingungen und der Datenschutzerklärung von dcPoint zu.</p>
        <Link to={`/login${params.size ? `?${params}` : ''}`} className="mt-5 self-start text-sm text-link hover:underline">
          Hast du bereits ein Konto?
        </Link>
      </form>
    </AuthLayout>
  );
}
