import { useQuery } from '@tanstack/react-query';
import { MessagesSquare, Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { http } from '../../api/client';
import type { Channel, Message } from '../../api/types';
import { renderMarkdown, type MarkdownContext } from '../../lib/markdown';
import { showChat } from '../../lib/mobile';
import { messageTimestamp } from '../../lib/time';
import { openModal } from '../../stores/overlay';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Popout } from '../ui/Popout';
import type { useMemberInfo } from './actions';

/** Top of a thread: name and the message it was started from. */
export function ThreadWelcome({ thread, md, info }: { thread: Channel; md: MarkdownContext; info: ReturnType<typeof useMemberInfo> }) {
  const starter = useQuery({
    queryKey: ['starter', thread.id],
    enabled: !!thread.thread_message_id && !!thread.parent_id,
    queryFn: async () => {
      const list = await http.get<Message[]>(`/channels/${thread.parent_id}/messages?around=${thread.thread_message_id}&limit=1`);
      return list.find((m) => m.id === thread.thread_message_id) ?? null;
    },
    staleTime: 60_000,
  });
  const owner = thread.owner_id ? info.info(thread.owner_id) : null;
  const m = starter.data;
  return (
    <div className="m-4 mb-2 max-md:mx-3" data-testid="channel-welcome">
      <div className="mb-2 flex size-[68px] items-center justify-center rounded-full bg-[#4e5058] text-white">
        <MessagesSquare size={36} />
      </div>
      <h2 className="my-2 break-words text-[32px] font-bold leading-10 text-header max-md:text-2xl max-md:leading-8">{thread.name}</h2>
      <p className="text-base text-muted">Gestartet von {owner?.name ?? 'Unbekannt'}. Dies ist der Anfang des Threads.</p>
      {m && (
        <div className="mt-4 flex gap-3 rounded-lg border border-divider bg-sidebar p-3">
          {m.author && <Avatar user={m.author} size={40} />}
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-medium text-header" style={{ color: info.info(m.author?.id ?? '', m.author).color }}>
                {info.info(m.author?.id ?? '', m.author).name}
              </span>
              <span className="text-xs text-muted">{messageTimestamp(m.timestamp)}</span>
            </div>
            <div className="md text-base text-text">{m.content ? renderMarkdown(m.content, md) : '📎 Anhang'}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** List of threads of a text channel (header button). */
export function ThreadsPopout({ channel, anchor, onClose, canCreate }: { channel: Channel; anchor: DOMRect; onClose: () => void; canCreate: boolean }) {
  const navigate = useNavigate();
  const threads = useQuery({ queryKey: ['threads', channel.id], queryFn: () => http.get<Channel[]>(`/channels/${channel.id}/threads`), staleTime: 0 });
  const open = (t: Channel) => {
    onClose();
    navigate(`/channels/${t.guild_id}/${t.id}`);
    showChat();
  };
  return (
    <Popout anchor={anchor} placement="bottom" align="end" onClose={onClose} className="flex max-h-[min(560px,80vh)] w-[420px] max-w-[calc(100vw-16px)] flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center gap-2 bg-sidebar px-4 font-semibold text-header">
        <MessagesSquare size={18} /> Threads
        {canCreate && (
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => {
              onClose();
              openModal({ type: 'createThread', channelId: channel.id });
            }}
          >
            <Plus size={14} /> Erstellen
          </Button>
        )}
      </div>
      <div className="scroller-thin flex-1 p-2">
        {threads.isPending && <p className="py-6 text-center text-sm text-muted">Lädt …</p>}
        {threads.data?.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">Noch keine Threads. Starte einen über das Menü einer Nachricht oder mit „Erstellen“.</p>}
        {threads.data?.map((t) => (
          <button key={t.id} onClick={() => open(t)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-hover">
            <MessagesSquare size={18} className="shrink-0 text-icon-muted" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-header">{t.name}</span>
              <span className="text-xs text-muted">
                {t.message_count} {t.message_count === 1 ? 'Nachricht' : 'Nachrichten'}
                {t.archived && ' · archiviert'}
              </span>
            </span>
          </button>
        ))}
      </div>
    </Popout>
  );
}
