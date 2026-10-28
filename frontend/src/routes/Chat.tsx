import { useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/Button';
import { inputClasses } from '../components/ui/inputClasses';
import { sendMessage, type AssistantReply } from '../api/assistant';
import { HOLDINGS_KEY, WATCHLIST_KEY, setHolding } from '../api/lists';

type Shown = AssistantReply | { kind: 'flipped'; message: string };

export function Chat() {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [reply, setReply] = useState<Shown | null>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: HOLDINGS_KEY });
    void queryClient.invalidateQueries({ queryKey: WATCHLIST_KEY });
  };

  const send = useMutation({
    mutationFn: (message: string) => sendMessage(message),
    onSuccess: (r) => {
      setText('');
      setCopy('idle');
      setReply(r);
      refresh();
    },
  });

  const flip = useMutation({
    mutationFn: (a: { symbol: string; direction: 'LONG' | 'SHORT' }) => setHolding(a.symbol, a.direction),
    onSuccess: (_res, a) => {
      setReply({ kind: 'flipped', message: `Flipped ${a.symbol} to ${a.direction.toLowerCase()}.` });
      refresh();
    },
  });

  const submit = () => {
    const message = text.trim();
    if (message && !send.isPending) send.mutate(message);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const copyPrompt = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopy('copied');
      setTimeout(() => setCopy('idle'), 2000);
    } catch {
      setCopy('failed');
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-end gap-2">
        <textarea
          rows={2}
          className={inputClasses('md', 'resize-none')}
          placeholder="Talk to Trader — “bought LMND”, “is GOOGL above 150 SMA?”"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button
          variant="primary"
          size="lg"
          className="shrink-0 whitespace-nowrap"
          disabled={!text.trim() || send.isPending}
          onClick={submit}
        >
          Send
        </Button>
      </div>

      {send.isError && <p className="text-sm text-down">Couldn’t reach Trader. Try again.</p>}

      {reply && (
        <div className="rounded-lg border border-border bg-surface-1 p-3 text-sm">
          {(reply.kind === 'done' || reply.kind === 'answer' || reply.kind === 'flipped') && <p>{reply.message}</p>}
          {reply.kind === 'error' && <p className="text-down">{reply.message}</p>}
          {reply.kind === 'confirm' && (
            <div className="space-y-3">
              <p>{reply.message}</p>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  className="shrink-0 whitespace-nowrap"
                  disabled={flip.isPending}
                  onClick={() => flip.mutate(reply.action)}
                >
                  {reply.action.label}
                </Button>
                <Button className="shrink-0 whitespace-nowrap" onClick={() => setReply(null)}>
                  Cancel
                </Button>
              </div>
              {flip.isError && <p className="text-down">{(flip.error as Error).message}</p>}
            </div>
          )}
          {reply.kind === 'prompt' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-medium">Prompt for Gemini</h2>
                <Button
                  variant="accent"
                  className="shrink-0 whitespace-nowrap"
                  onClick={() => void copyPrompt(reply.text)}
                >
                  {copy === 'copied' ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <pre className="whitespace-pre-wrap break-words font-sans text-muted">{reply.text}</pre>
              {copy === 'failed' && (
                <p className="text-down">Copy failed — select the text and copy it manually.</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
