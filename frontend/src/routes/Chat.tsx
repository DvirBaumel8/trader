import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/Button';
import { inputClasses } from '../components/ui/inputClasses';
import { sendMessage, type AssistantReply } from '../api/assistant';
import { HOLDINGS_KEY, WATCHLIST_KEY } from '../api/lists';

export function Chat() {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [reply, setReply] = useState<AssistantReply | null>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: HOLDINGS_KEY });
    void queryClient.invalidateQueries({ queryKey: WATCHLIST_KEY });
  };

  const send = useMutation({
    mutationFn: (message: string) => sendMessage(message),
    onMutate: () => {
      setReply(null);
    },
    onSuccess: (r) => {
      setText('');
      setCopy('idle');
      setReply(r);
      refresh();
    },
  });

  const busy = send.isPending;

  const submit = () => {
    const message = text.trim();
    if (message && !busy) send.mutate(message);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const copyPrompt = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopy('copied');
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopy('idle'), 2000);
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
          disabled={busy}
        />
        <Button
          variant="primary"
          size="lg"
          className="shrink-0 whitespace-nowrap"
          disabled={!text.trim() || busy}
          onClick={submit}
        >
          Send
        </Button>
      </div>

      {send.isError && <p className="text-sm text-down">Couldn’t reach Trader. Try again.</p>}

      {reply && (
        <div className="rounded-lg border border-border bg-surface-1 p-3 text-sm">
          {reply.kind === 'done' && <p className="whitespace-pre-line">{reply.message}</p>}
          {reply.kind === 'error' && <p className="text-down">{reply.message}</p>}
          {reply.kind === 'prompt' && (
            <div className="space-y-2">
              {reply.note && <p className="text-muted">{reply.note}</p>}
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
