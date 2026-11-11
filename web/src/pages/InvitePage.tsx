import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { ApiError, auth, http } from '../api/client';
import type { GuildPayload, Invite } from '../api/types';
import { GuildIcon } from '../components/GuildIcon';
import { Button } from '../components/ui/Button';
import { useData } from '../stores/data';
import { AuthLayout } from './AuthLayout';
import { displayName } from '../lib/cdn';
import { showChat } from '../lib/mobile';
import { firstTextChannel } from '../lib/navigation';

export default function InvitePage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const loggedIn = !!auth.token;
  const invite = useQuery({ queryKey: ['invite', code], queryFn: () => http.get<Invite>(`/invites/${code}`), retry: false });
  const accept = useMutation({
    mutationFn: () => http.post<GuildPayload>(`/invites/${code}`),
    onSuccess: (g) => {
      useData.getState().upsertGuild(g);
      navigate(`/channels/${g.id}/${firstTextChannel(g.id) ?? ''}`, { replace: true });
      showChat();
    },
  });

  return (
    <AuthLayout>
      {invite.isPending ? (
        <div className="flex h-56 flex-col items-center justify-center gap-4">
          <div className="size-20 animate-pulse rounded-3xl bg-sidebar" />
          <div className="h-4 w-48 animate-pulse rounded bg-sidebar" />
        </div>
      ) : invite.isError || !invite.data ? (
        <div className="flex flex-col items-center text-center">
          <h1 className="text-2xl font-semibold text-header">Einladung ungültig</h1>
          <p className="mt-2 text-header-2">Diese Einladung ist abgelaufen oder existiert nicht. Bitte frag nach einer neuen.</p>
          <Button size="lg" grow className="mt-6" onClick={() => navigate(loggedIn ? '/channels/@me' : '/login')}>
            {loggedIn ? 'Weiter zu dcPoint' : 'Zur Anmeldung'}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center">
          <GuildIcon guild={invite.data.guild} size={64} className="rounded-2xl !bg-sidebar text-xl" />
          <p className="mt-4 text-base text-header-2">
            {invite.data.inviter ? `${displayName(invite.data.inviter)} hat dich eingeladen, beizutreten` : 'Du wurdest eingeladen, beizutreten'}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-header">{invite.data.guild.name}</h1>
          <div className="mt-2 flex items-center gap-4 text-sm text-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-online" />
              {invite.data.approximate_presence_count} online
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-offline" />
              {invite.data.approximate_member_count} Mitglieder
            </span>
          </div>
          {accept.error && <p className="mt-4 text-sm text-[#fa777c]">{(accept.error as ApiError).text?.() ?? 'Fehler'}</p>}
          <Button
            size="lg"
            grow
            className="mt-6"
            loading={accept.isPending}
            onClick={() => (loggedIn ? accept.mutate() : navigate(`/register?redirect=${encodeURIComponent(`/invite/${code}`)}`))}
          >
            Einladung annehmen
          </Button>
          {!loggedIn && (
            <button className="mt-3 text-sm text-link hover:underline" onClick={() => navigate(`/login?redirect=${encodeURIComponent(`/invite/${code}`)}`)}>
              Ich habe bereits ein Konto
            </button>
          )}
        </div>
      )}
    </AuthLayout>
  );
}
