import { api } from './client';

export type AssistantReply =
  | { kind: 'done'; message: string }
  | { kind: 'prompt'; text: string; note?: string }
  | { kind: 'error'; message: string };

export const sendMessage = (text: string) =>
  api<AssistantReply>('/assistant', { method: 'POST', body: JSON.stringify({ text }) });
