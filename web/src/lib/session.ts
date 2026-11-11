import { auth, http } from '../api/client';
import { gateway } from '../api/gateway';
import { useData } from '../stores/data';
import { useMessages } from '../stores/messages';
import { queryClient } from './queryClient';

export function startSession(token: string) {
  auth.set(token);
  useData.getState().setConnection('connecting');
  gateway.connect(token);
}

export function endSession() {
  gateway.disconnect();
  auth.set(null);
  useData.getState().reset();
  useMessages.getState().reset();
  queryClient.clear();
}

export async function logout() {
  try {
    await http.post('/auth/logout');
  } catch {
    /* token may already be invalid */
  }
  endSession();
}
