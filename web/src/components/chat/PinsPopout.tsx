import { useQuery } from '@tanstack/react-query';
import { Pin } from 'lucide-react';
import { useNavigate } from 'react-router';
import { http } from '../../api/client';
import type { Message } from '../../api/types';
import { reportError } from '../../lib/actions';
import { renderMarkdown } from '../../lib/markdown';
import { messageTimestamp } from '../../lib/time';
import { useMessages } from '../../stores/messages';
import { Avatar } from '../ui/Avatar';
import { Popout } from '../ui/Popout';
import { useMarkdownContext, useMemberInfo } from './actions';

export function PinsPopout({ channelId, guildId, anchor, onClose }: { channelId: string; guildId: string | null; anchor: DOMRect; onClose: () => void }) {
  const navigate = useNavigate();
  const info = useMemberInfo(guildId);
  const md = useMarkdownContext(guildId, navigate, info);
  const pins = useQuery({ queryKey: ['pins', channelId], queryFn: () => http.get<Message[]>(`/channels/${channelId}/pins`), staleTime: 0 });
  return (
    <Popout anchor={anchor} placement="bottom" align="end" onClose={onClose} className="flex max-h-[min(560px,80vh)] w-[420px] max-w-[calc(100vw-16px)] flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center gap-2 bg-sidebar px-4 font-semibold text-header">
        <Pin size={18} /> Angepinnte Nachrichten
      </div>
      <div className="scroller-thin flex-1 space-y-2 p-3">
        {pins.isPending && <p className="py-6 text-center text-sm text-muted">Lädt …</p>}
        {pins.data?.length === 0 && (
          <div className="py-8 text-center">
            <Pin size={40} className="mx-auto mb-3 text-icon-muted" />
            <p className="text-sm text-muted">Dieser Kanal hat noch keine angepinnten Nachrichten. Wichtige Antworten lassen sich über das Nachrichtenmenü anpinnen.</p>
          </div>
        )}
        {pins.data?.map((m) => (
          <div key={m.id} className="group relative rounded-lg border border-divider bg-chat p-3">
            <div className="flex items-center gap-2">
              {m.author && <Avatar user={m.author} size={24} />}
              <span className="text-sm font-medium" style={{ color: info.info(m.author?.id ?? '', m.author).color }}>
                {info.info(m.author?.id ?? '', m.author).name}
              </span>
              <span className="text-xs text-muted">{messageTimestamp(m.timestamp)}</span>
            </div>
            <div className="md mt-1 text-sm text-text">{m.content ? renderMarkdown(m.content, md) : '📎 Anhang'}</div>
            <button
              onClick={() => {
                onClose();
                void useMessages.getState().jump(channelId, m.id).catch(reportError);
              }}
              className="absolute right-2 top-2 hidden rounded bg-sidebar px-2 py-0.5 text-xs font-medium text-text hover:bg-hover group-hover:block [@media(hover:none)]:block"
            >
              Springen
            </button>
          </div>
        ))}
      </div>
    </Popout>
  );
}
