import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError, http } from '../api/client';
import type { AuthResponse } from '../api/types';
import { Button } from '../components/ui/Button';
import { Input, Label } from '../components/ui/Field';
import { startSession } from '../lib/session';
import { AuthLayout } from './AuthLayout';

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') || '/channels/@me';
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  const finish = (res: AuthResponse) => {
    if ('mfa' in res) {
      setTicket(res.ticket);
      return;
    }
    startSession(res.token);
    navigate(redirect, { replace: true });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      finish(
        ticket
          ? await http.post<AuthResponse>('/auth/mfa/totp', { ticket, code })
          : await http.post<AuthResponse>('/auth/login', { login, password }),
      );
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError(0, 'NETWORK');
      if (apiErr.code === 'INVALID_MFA_TICKET') setTicket(null);
      setError(apiErr);
    } finally {
      setLoading(false);
    }
  };

  if (ticket) {
    return (
      <AuthLayout>
        <form onSubmit={submit} className="flex flex-col">
          <h1 className="text-center text-2xl font-semibold text-header">Zwei-Faktor-Authentifizierung</h1>
          <p className="mb-5 mt-2 text-center text-base text-header-2">Gib den 6-stelligen Code aus deiner Authenticator-App ein.</p>
          <Label htmlFor="code" required error={error?.text('code') ?? (error && !Object.keys(error.fields).length ? error.text() : undefined)}>
            Authentifizierungscode
          </Label>
          <Input
            id="code"
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-stelliger Code"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
          />
          <Button type="submit" size="lg" grow loading={loading} disabled={code.replace(/\s/g, '').length !== 6} className="mt-5">
            Anmelden
          </Button>
          <button type="button" onClick={() => setTicket(null)} className="mt-3 self-start text-sm text-link hover:underline">
            Zurück zur Anmeldung
          </button>
        </form>
      </AuthLayout>
    );
  }

  const loginError = error?.text('login') ?? (error && !Object.keys(error.fields).length ? error.text() : undefined);
  return (
    <AuthLayout>
      <form onSubmit={submit} className="flex flex-col">
        <h1 className="text-center text-2xl font-semibold text-header">Schön, dass du wieder da bist!</h1>
        <p className="mb-5 mt-2 text-center text-base text-header-2">Melde dich an, um weiterzuschreiben.</p>
        <Label htmlFor="login" required error={loginError}>
          E-Mail oder Benutzername
        </Label>
        <Input id="login" autoFocus autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} invalid={!!loginError} />
        <div className="h-5" />
        <Label htmlFor="password" required error={loginError}>
          Passwort
        </Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          invalid={!!loginError}
        />
        <Button type="submit" size="lg" grow loading={loading} className="mt-6">
          Anmelden
        </Button>
        <p className="mt-2 text-sm text-muted">
          Brauchst du ein Konto?{' '}
          <Link to={`/register${params.size ? `?${params}` : ''}`} className="text-link hover:underline">
            Registrieren
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
