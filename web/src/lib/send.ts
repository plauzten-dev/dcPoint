import { API_BASE, ApiError, auth, http } from '../api/client';
import type { Message } from '../api/types';
import { useData } from '../stores/data';
import { useMessages } from '../stores/messages';

export interface OutgoingFile {
  file: File;
  spoiler: boolean;
}

interface Outgoing {
  channelId: string;
  content: string;
  replyTo?: Message | null;
  replyMention?: boolean;
  files?: OutgoingFile[];
}

const EPOCH = 1_735_689_600_000n;
const retries = new Map<string, Outgoing>();

/** A snowflake-shaped id that sorts after everything sent so far. */
function provisionalId(): string {
  return ((BigInt(Date.now()) - EPOCH) << 22n).toString();
}

function upload(channelId: string, form: FormData, onProgress: (p: number) => void): Promise<Message> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/v1/channels/${channelId}/messages`);
    if (auth.token) xhr.setRequestHeader('Authorization', auth.token);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: { code?: string; errors?: Record<string, string> } | Message | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* empty body */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as Message);
      else {
        const err = (data ?? {}) as { code?: string; errors?: Record<string, string> };
        reject(new ApiError(xhr.status, err.code ?? (xhr.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'UNKNOWN'), err.errors ?? {}));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK'));
    xhr.send(form);
  });
}

/** Sends a message optimistically: it appears instantly and is reconciled by nonce. */
export async function sendMessage(out: Outgoing): Promise<void> {
  const me = useData.getState().me;
  if (!me) return;
  const nonce = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const id = provisionalId();
  const optimistic: Message = {
    id,
    channel_id: out.channelId,
    guild_id: useData.getState().channelGuild[out.channelId] ?? null,
    author: me,
    content: out.content,
    type: out.replyTo ? 19 : 0,
    timestamp: new Date().toISOString(),
    edited_at: null,
    pinned: false,
    mention_everyone: false,
    mentions: [],
    mention_roles: [],
    attachments: (out.files ?? []).map((f, i) => ({
      id: `${id}-${i}`,
      filename: f.file.name,
      content_type: f.file.type,
      size: f.file.size,
      width: null,
      height: null,
      spoiler: f.spoiler,
      url: '',
    })),
    embeds: [],
    reactions: [],
    reply_to_id: out.replyTo?.id ?? null,
    referenced_message: out.replyTo
      ? { id: out.replyTo.id, author: out.replyTo.author, content: out.replyTo.content, has_attachments: out.replyTo.attachments.length > 0 }
      : null,
    flags: 0,
    nonce,
    pending: true,
    progress: out.files?.length ? 0 : undefined,
  };
  const store = useMessages.getState();
  store.upsert(optimistic);
  retries.set(id, out);

  const payload = { content: out.content, nonce, reply_to_id: out.replyTo?.id, reply_mention: out.replyMention ?? true };
  try {
    let saved: Message;
    if (out.files?.length) {
      const form = new FormData();
      form.append('payload_json', JSON.stringify(payload));
      out.files.forEach((f, i) => form.append(`files[${i}]`, f.file, f.spoiler && !f.file.name.startsWith('SPOILER_') ? `SPOILER_${f.file.name}` : f.file.name));
      saved = await upload(out.channelId, form, (p) => useMessages.getState().patch(out.channelId, id, (m) => ({ ...m, progress: p })));
    } else {
      saved = await http.post<Message>(`/channels/${out.channelId}/messages`, payload);
    }
    retries.delete(id);
    useMessages.getState().upsert({ ...saved, nonce, reactions: saved.reactions ?? [] });
  } catch (e) {
    useMessages.getState().patch(out.channelId, id, (m) => ({ ...m, failed: true, pending: false, progress: undefined }));
    throw e;
  }
}

export function retryMessage(channelId: string, id: string) {
  const out = retries.get(id);
  useMessages.getState().remove(channelId, id);
  retries.delete(id);
  if (out) void sendMessage(out).catch(() => {});
}

export function discardFailed(channelId: string, id: string) {
  retries.delete(id);
  useMessages.getState().remove(channelId, id);
}
