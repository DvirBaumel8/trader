import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { clearDraft, loadDraft, saveDraft } from '../lib/draftStorage';
import {
  dateToIso,
  emptyDraft,
  localDate,
  signedQuantity,
  type EntryDraft,
  type EntryKind,
} from '../lib/entryDraft';
import type { StopRow } from '../lib/stopRisk';
import { StopLevelEditor } from './StopLevelEditor';
import type { Entry } from './EntryCard';

const DRAFT_KEY = 'trader.entryDraft.v1';

const inputClass =
  'w-full min-w-0 rounded-lg border border-border bg-surface-1 px-3 py-2 text-base outline-none focus:border-accent';

const KINDS: { value: EntryKind; label: string }[] = [
  { value: 'TRADE', label: 'Trade' },
  { value: 'CASH', label: 'Cash' },
  { value: 'DIVIDEND', label: 'Dividend' },
];

/** Everything the entry touches, refetched together after any write. */
const AFFECTED = ['journal', 'portfolio', 'stats', 'tags'];

function draftFromEntry(entry: Entry, defaultFee: number): EntryDraft {
  return {
    kind: entry.kind,
    occurredAt: localDate(new Date(entry.occurredAt)),
    body: entry.body,
    symbol: entry.trade?.symbol ?? '',
    side: entry.trade?.side ?? 'BUY',
    quantity: entry.trade ? String(entry.trade.quantity) : '',
    price: entry.trade ? String(entry.trade.price) : '',
    fee: entry.trade ? String(entry.trade.fee) : String(defaultFee),
    target: entry.trade?.plannedTarget ? String(entry.trade.plannedTarget) : '',
    stops: (entry.trade?.stopLevels ?? []).map(
      (l): StopRow => ({
        kind: l.kind,
        price: l.price === null ? '' : String(l.price),
        trailPercent: l.trailPercent === null ? '' : String(l.trailPercent),
        quantity: String(l.quantity),
      }),
    ),
    cashDirection: entry.cash?.direction ?? 'DEPOSIT',
    cashAmount: entry.cash ? String(entry.cash.amount) : '',
    dividendSymbol: entry.dividend?.symbol ?? '',
    dividendAmount: entry.dividend ? String(entry.dividend.amount) : '',
    setups: entry.tags.filter((t) => t.type === 'SETUP').map((t) => t.label),
    mistakes: entry.tags.filter((t) => t.type === 'MISTAKE').map((t) => t.label),
  };
}

export function EntrySheet({
  open,
  onClose,
  defaultFee,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  defaultFee: number;
  editing?: Entry | null;
}) {
  const [draft, setDraft] = useState<EntryDraft>(() =>
    loadDraft(DRAFT_KEY, emptyDraft(defaultFee)),
  );
  const queryClient = useQueryClient();

  // When opened on an existing entry the draft mirrors it. Editing must never
  // clobber an unsaved new entry, so only the new-entry draft is persisted.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setDraft(draftFromEntry(editing, defaultFee));
      return;
    }
    // A new entry always opens on today. The draft survives across days, so a
    // restored one would otherwise arrive carrying the date it was started on
    // — and with the field defaulted rather than blank, that is easy to miss.
    setDraft((d) => ({ ...d, occurredAt: localDate() }));
  }, [open, editing, defaultFee]);

  useEffect(() => {
    if (!editing) saveDraft(DRAFT_KEY, draft);
  }, [draft, editing]);

  const set = (patch: Partial<EntryDraft>) =>
    setDraft((d) => ({
      ...d,
      ...patch,
    }));

  const invalidate = () =>
    Promise.all(
      AFFECTED.map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );

  const mutation = useMutation({
    mutationFn: () =>
      api(editing ? `/journal/${editing.id}` : '/journal', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          kind: draft.kind,
          body: draft.body,
          occurredAt: dateToIso(draft.occurredAt),
          trade:
            draft.kind === 'TRADE'
              ? {
                  symbol: draft.symbol.trim().toUpperCase(),
                  quantity: signedQuantity(draft),
                  price: Math.abs(parseFloat(draft.price || '0')),
                  fee: Math.abs(parseFloat(draft.fee || '0')),
                  plannedTarget: draft.target
                    ? Math.abs(parseFloat(draft.target))
                    : undefined,
                  stopLevels: draft.stops
                    .filter(
                      (r) =>
                        parseFloat(r.quantity || '0') > 0 &&
                        (r.kind === 'FIXED'
                          ? r.price !== ''
                          : r.trailPercent !== ''),
                    )
                    .map((r) => ({
                      kind: r.kind,
                      price:
                        r.kind === 'FIXED' ? parseFloat(r.price) : undefined,
                      trailPercent:
                        r.kind === 'TRAILING'
                          ? parseFloat(r.trailPercent)
                          : undefined,
                      quantity: Math.abs(parseFloat(r.quantity)),
                    })),
                }
              : undefined,
          cash:
            draft.kind === 'CASH'
              ? {
                  direction: draft.cashDirection,
                  amount: Math.abs(parseFloat(draft.cashAmount || '0')),
                }
              : undefined,
          dividend:
            draft.kind === 'DIVIDEND'
              ? {
                  symbol: draft.dividendSymbol.trim().toUpperCase(),
                  amount: Math.abs(parseFloat(draft.dividendAmount || '0')),
                }
              : undefined,
        }),
      }),
    onSuccess: async () => {
      if (!editing) {
        clearDraft(DRAFT_KEY);
        setDraft(emptyDraft(defaultFee));
      }
      await invalidate();
      onClose();
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="flex-1"
      />
      <div className="max-h-[88vh] space-y-4 overflow-y-auto rounded-t-2xl border-t border-border bg-surface-0 p-4 pb-10">
        <div className="flex gap-1">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              aria-pressed={draft.kind === k.value}
              onClick={() => set({ kind: k.value })}
              className={`flex-1 rounded-lg border py-2 text-xs transition-colors ${
                draft.kind === k.value
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border text-muted'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>

        {draft.kind === 'TRADE' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                placeholder="NVDA"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                value={draft.symbol}
                onChange={(e) => set({ symbol: e.target.value })}
                className={inputClass}
              />
              <div className="flex shrink-0 overflow-hidden rounded-lg border border-border">
                {(['BUY', 'SELL'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={draft.side === s}
                    onClick={() => set({ side: s })}
                    className={`px-3 py-2 text-sm font-medium ${
                      draft.side === s
                        ? s === 'BUY'
                          ? 'bg-up/20 text-up'
                          : 'bg-down/20 text-down'
                        : 'bg-surface-1 text-muted'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="number"
                inputMode="decimal"
                placeholder="qty"
                value={draft.quantity}
                onChange={(e) => set({ quantity: e.target.value })}
                className={inputClass}
              />
              <input
                type="number"
                inputMode="decimal"
                placeholder="price"
                value={draft.price}
                onChange={(e) => set({ price: e.target.value })}
                className={inputClass}
              />
              <input
                type="number"
                inputMode="decimal"
                placeholder="fee"
                value={draft.fee}
                onChange={(e) => set({ fee: e.target.value })}
                className={inputClass}
              />
            </div>

            <StopLevelEditor
              rows={draft.stops}
              onChange={(stops) => set({ stops })}
              entryPrice={draft.price}
              quantity={draft.quantity}
              side={draft.side}
            />

          </div>
        )}

        {draft.kind === 'CASH' && (
          <div className="flex gap-2">
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-border">
              {(['DEPOSIT', 'WITHDRAW'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={draft.cashDirection === d}
                  onClick={() => set({ cashDirection: d })}
                  className={`px-3 py-2 text-sm font-medium ${
                    draft.cashDirection === d
                      ? 'bg-surface-2 text-text'
                      : 'bg-surface-1 text-muted'
                  }`}
                >
                  {d === 'DEPOSIT' ? 'In' : 'Out'}
                </button>
              ))}
            </div>
            <input
              type="number"
              inputMode="decimal"
              placeholder="amount"
              value={draft.cashAmount}
              onChange={(e) => set({ cashAmount: e.target.value })}
              className={inputClass}
            />
          </div>
        )}

        {draft.kind === 'DIVIDEND' && (
          <div className="flex gap-2">
            <input
              placeholder="NVDA"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              value={draft.dividendSymbol}
              onChange={(e) => set({ dividendSymbol: e.target.value })}
              className={inputClass}
            />
            <input
              type="number"
              inputMode="decimal"
              placeholder="amount received"
              value={draft.dividendAmount}
              onChange={(e) => set({ dividendAmount: e.target.value })}
              className={inputClass}
            />
          </div>
        )}

        <label className="block space-y-1">
          <span className="block text-xs text-muted">Date</span>
          <input
            type="date"
            value={draft.occurredAt}
            onChange={(e) => set({ occurredAt: e.target.value })}
            className={inputClass}
          />
        </label>

        <textarea
          rows={3}
          placeholder={
            draft.kind === 'TRADE'
              ? 'Why this trade? Setup, thesis, what would make you wrong.'
              : 'Notes (optional)'
          }
          value={draft.body}
          onChange={(e) => set({ body: e.target.value })}
          className={`${inputClass} resize-none`}
        />

        {mutation.isError && (
          <p className="text-sm text-down">
            {(mutation.error as Error).message}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-3 text-sm text-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
            className="flex-1 rounded-lg bg-accent px-4 py-3 font-medium text-surface-0 disabled:opacity-50"
          >
            {mutation.isPending
              ? 'Saving…'
              : editing
                ? 'Save changes'
                : 'Save entry'}
          </button>
        </div>

        {editing && (
          <DeleteEntry
            entry={editing}
            onDone={async () => {
              await invalidate();
              onClose();
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Two-step, and it names what it will do to the portfolio before doing it. */
function DeleteEntry({
  entry,
  onDone,
}: {
  entry: Entry;
  onDone: () => void | Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const mutation = useMutation({
    mutationFn: () => api(`/journal/${entry.id}`, { method: 'DELETE' }),
    onSuccess: onDone,
  });

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="w-full text-xs text-muted underline underline-offset-4"
      >
        Delete this entry
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-down/40 bg-down/10 p-3">
      <p className="text-xs">
        {entry.trade
          ? `Deleting this removes the ${entry.trade.side} of ${entry.trade.symbol} from your portfolio.`
          : entry.cash
            ? 'Deleting this removes the cash movement from your balance.'
            : entry.dividend
              ? 'Deleting this removes the dividend from your cash.'
              : 'This note will be deleted.'}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
          className="rounded-lg bg-down px-3 py-2 text-sm font-medium text-surface-0 disabled:opacity-50"
        >
          {mutation.isPending ? 'Deleting…' : 'Delete'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-border px-3 py-2 text-sm text-muted"
        >
          Cancel
        </button>
      </div>
      {mutation.isError && (
        <p className="text-xs text-down">{(mutation.error as Error).message}</p>
      )}
    </div>
  );
}
