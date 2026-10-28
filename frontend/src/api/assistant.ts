import { api } from './client';

export type AssistantReply =
  | { kind: 'done'; message: string }
  | { kind: 'confirm'; message: string; action: { symbol: string; direction: 'LONG' | 'SHORT'; label: string } }
  | {
      kind: 'answer';
      message: string;
      facts: {
        symbol: string;
        price: number;
        stale: boolean;
        session: string | null;
        average: 'SMA' | 'EMA';
        period: number;
        value: number;
        percentFrom: number;
      };
    }
  | { kind: 'prompt'; text: string }
  | { kind: 'error'; message: string };

export const sendMessage = (text: string) =>
  api<AssistantReply>('/assistant', { method: 'POST', body: JSON.stringify({ text }) });
