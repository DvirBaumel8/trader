import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useSettings } from '../api/settings';
import { fillContext, type HeldPosition } from '../lib/fillContext';
import { useDebounced } from '../lib/useDebounced';
import { clearDraft } from '../lib/draftStorage';
import { readPersisted, writePersisted } from '../lib/persistentState';
import {
  dateToIso,
  emptyDraft,
  localDate,
  signedQuantity,
  signedReportedNetCash,
  parsedReportedBalance,
  computedPriceFromReportedCash,
  type EntryDraft,
  type EntryKind,
} from '../lib/entryDraft';
import type { StopRow } from '../lib/stopRow';
import { StopLevelEditor } from './StopLevelEditor';
import { Button } from './ui/Button';
import { inputClasses } from './ui/inputClasses';
import type { Entry } from './EntryCard';

const DRAFT_KEY = 'trader.entryDraft.v1';

const inputClass = inputClasses('md');

const KINDS: { value: EntryKind; label: string }[] = [
  { value: 'TRADE', label: 'Trade' },
  { value: 'CASH', label: 'Cash' },
  { value: 'DIVIDEND', label: 'Dividend' },
];

/** Everything the entry touches, refetched together after any write. */
const AFFECTED = ['journal', 'portfolio', 'stats', 'tags'];

/** Mirrors `EXIT_REASONS[0].code` in `backend/src/journal/reasons.ts` — the
 * default a closing fill's reason chips start on, most sells being exactly
 * this. A plain string rather than an import: the frontend never holds its
 * own copy of the vocabulary, only the one code it needs to pre-select. */
const DEFAULT_EXIT_REASON = 'EXIT_STOP_EXECUTED';

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
    reasons: entry.reasons ?? [],
    reportedNetCash:
      entry.trade?.reportedNetCash != null
        ? String(Math.abs(entry.trade.reportedNetCash))
        : '',
    reportedBalance:
      entry.trade?.reportedBalance != null
        ? String(entry.trade.reportedBalance)
        : '',
  };
}

export function EntrySheet({
  open,
  onClose,
  defaultFee,
  editing,
  resuming = false,
}: {
  open: boolean;
  onClose: () => void;
  defaultFee: number;
  editing?: Entry | null;
  /**
   * True only when the composer is reopening because the app was discarded
   * with it open — not when the user opens a new entry. The single case where
   * a saved draft is restored.
   */
  resuming?: boolean;
}) {
  /**
   * Opening a new entry ALWAYS gives an empty form — never a draft from
   * earlier, and not "empty after an hour" either. That was the owner's
   * explicit call.
   *
   * The draft still exists, for the one case it was built for: iOS discarding
   * the app while the composer is open. That is not "opening a form", it is
   * the same form coming back, and `resuming` is true only then — the Journal
   * restores `composing` from the saved UI state on a cold start. So the rule
   * is about WHY the sheet is open, not about how long ago anything happened.
   */
  const [draft, setDraft] = useState<EntryDraft>(() =>
    resuming
      ? // No expiry on this read: the window that matters already applied to
        // the decision to resume at all.
        (readPersisted<EntryDraft>(DRAFT_KEY, Number.POSITIVE_INFINITY) ??
        emptyDraft(defaultFee))
      : emptyDraft(defaultFee),
  );
  const resumeHandled = useRef(false);
  const queryClient = useQueryClient();

  /**
   * True once the owner has touched the quantity field himself. From then on
   * the suggestion never appears again for this entry — a number he typed is
   * never replaced by one the app guessed.
   */
  const [quantityTouched, setQuantityTouched] = useState(false);

  /**
   * Same rule as `quantityTouched`, for the price: once platform net cash is
   * given, its exact implied price previews here instead of a typed
   * 2-decimal guess — but a price the owner typed himself always wins and is
   * never silently overwritten by a later edit to net cash.
   */
  const [priceTouched, setPriceTouched] = useState(false);

  /**
   * Same rule as `quantityTouched`, for the exit reason chips: a closing
   * fill with no reason picked yet defaults to "Stop executed" — most sells
   * are — but a deliberate tap to change or clear it must stick, not keep
   * reappearing because the draft still reads as untouched.
   */
  const [reasonsTouched, setReasonsTouched] = useState(false);

  const { data: settings } = useSettings();

  /**
   * The same cache entry the Dashboard and the Balance tab already fill, so
   * the composer usually costs no request at all. Positions are derived on
   * the backend; nothing here computes them.
   */
  const { data: portfolio } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => api<{ positions: HeldPosition[] }>('/portfolio'),
    enabled: open && draft.kind === 'TRADE',
    staleTime: 30_000,
  });

  // Debounced so a half-typed ticker doesn't flash somebody else's position.
  const symbol = useDebounced(draft.symbol);
  const context = fillContext(portfolio?.positions, symbol, draft.side);

  /**
   * Set only when this fill reduces a position — captured now, not
   * re-derived inside the mutation's `onSuccess`, since a new-entry save
   * resets `draft` (and so `symbol`/`context`) before `onSuccess` runs.
   * Whether the position actually closed out (vs. merely shrank) is only
   * knowable after the save, once the portfolio has been refetched.
   */
  const closingSymbol = context.closing ? symbol.trim().toUpperCase() : null;

  /**
   * The quantity shown. Derived rather than written into the draft: the
   * suggestion is an offer, not an edit, so nothing has to be undone if it is
   * wrong, and there is no effect racing the owner's typing. Editing never
   * suggests — the derived position already contains this entry's own fill,
   * so the number would be wrong.
   */
  const suggested = editing || quantityTouched ? null : context.suggested;
  const quantityValue = draft.quantity !== '' ? draft.quantity : (suggested ?? '');

  /**
   * Same rule as the quantity suggestion, for price: derived rather than
   * written into the draft, so a value the owner typed is never silently
   * replaced, and updates live as net cash, fee, or quantity change.
   */
  const computedPrice = editing || priceTouched ? undefined : computedPriceFromReportedCash(draft);
  const priceValue = draft.price !== '' ? draft.price : (computedPrice !== undefined ? String(computedPrice) : '');

  /**
   * Which chips to show follows the same rule as the suggestion. Codes from
   * the other list are kept in the draft but neither shown nor saved, so
   * flipping Buy/Sell by mistake loses nothing when it is flipped back.
   */
  // Optional all the way down on purpose: a frontend that loads against an
  // API older than the vocabulary shows no chips rather than a blank sheet.
  const reasonOptions =
    (context.closing
      ? settings?.reasons?.closing
      : settings?.reasons?.opening) ?? [];
  const touchedReasons = draft.reasons.filter((code) =>
    reasonOptions.some((option) => option.code === code),
  );
  /**
   * Defaults to "Stop executed" on a fresh, untouched, closing fill — not
   * on an edit (an existing entry's saved reasons, even none, are what was
   * actually recorded) and not once the owner has tapped a chip, so
   * deliberately clearing it sticks rather than reappearing next render.
   */
  const defaultsToStopExecuted =
    !editing &&
    !reasonsTouched &&
    context.closing &&
    touchedReasons.length === 0 &&
    reasonOptions.some((option) => option.code === DEFAULT_EXIT_REASON);
  const selectedReasons = defaultsToStopExecuted
    ? [DEFAULT_EXIT_REASON]
    : touchedReasons;

  // When opened on an existing entry the draft mirrors it. Editing must never
  // clobber an unsaved new entry, so only the new-entry draft is persisted.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setDraft(draftFromEntry(editing, defaultFee));
      setQuantityTouched(false);
      setPriceTouched(false);
      setReasonsTouched(false);
      return;
    }
    // The one exception to starting blank: this same form coming back after
    // iOS discarded the app mid-typing. Handled once, so a later reopen is a
    // genuine new entry and gets the empty form.
    if (resuming && !resumeHandled.current) {
      resumeHandled.current = true;
      return;
    }

    // Every other open is a NEW entry, and starts empty. The stored draft goes
    // with it, so nothing can resurface later.
    setDraft(emptyDraft(defaultFee));
    setQuantityTouched(false);
    setPriceTouched(false);
    setReasonsTouched(false);
    clearDraft(DRAFT_KEY);
  }, [open, editing, defaultFee, resuming]);

  useEffect(() => {
    if (!editing) writePersisted(DRAFT_KEY, draft);
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

  /**
   * A brand-new trade always asks for the platform's own numbers, to catch
   * drift between what we derive and what really happened. Editing a trade
   * that was never reconciled does not retroactively force it — but editing
   * one that WAS already reconciled must keep it, so an edit can never
   * silently drop a confirmed reconciliation.
   */
  const reportedCashRequired =
    draft.kind === 'TRADE' &&
    (!editing || editing.trade?.reportedNetCash != null);
  const hasReportedNetCash = draft.reportedNetCash.trim() !== '';
  const hasReportedBalance = draft.reportedBalance.trim() !== '';
  const reportedCashIncomplete =
    draft.kind === 'TRADE' &&
    (reportedCashRequired
      ? !hasReportedNetCash || !hasReportedBalance
      : hasReportedNetCash !== hasReportedBalance);

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
                  quantity: signedQuantity({
                    ...draft,
                    quantity: quantityValue,
                  }),
                  price: Math.abs(parseFloat(priceValue || '0')),
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
                  reportedNetCash: signedReportedNetCash(draft),
                  reportedBalance: parsedReportedBalance(draft),
                }
              : undefined,
          cash:
            draft.kind === 'CASH'
              ? {
                  direction: draft.cashDirection,
                  amount: Math.abs(parseFloat(draft.cashAmount || '0')),
                }
              : undefined,
          // Only a trade has reasons. Omitted elsewhere rather than sent
          // empty, so an edit can never silently clear what is stored.
          reasons: draft.kind === 'TRADE' ? selectedReasons : undefined,
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
        // The date carries over rather than resetting to today: backfilling
        // a past day is normally several entries in a row, all on that same
        // day, and re-picking the date before every one of them is exactly
        // the friction chaining the composer exists to remove.
        setDraft((prev) => ({ ...emptyDraft(defaultFee), occurredAt: prev.occurredAt }));
        setQuantityTouched(false);
        setPriceTouched(false);
        setReasonsTouched(false);
      }
      await invalidate();

      // A closing fill that emptied the position out entirely — add it to
      // the watchlist so it stays visible after it drops off the open
      // positions list. Best-effort: a failed add (a provider hiccup, the
      // watchlist already full) must never block closing the sheet or read
      // as if the trade itself failed to save.
      if (closingSymbol) {
        const fresh = queryClient.getQueryData<{ positions: HeldPosition[] }>([
          'portfolio',
        ]);
        const stillOpen = fresh?.positions.some(
          (p) => p.symbol.toUpperCase() === closingSymbol,
        );
        if (!stillOpen) {
          try {
            await api('/watchlist', {
              method: 'POST',
              body: JSON.stringify({ symbol: closingSymbol }),
            });
            void queryClient.invalidateQueries({ queryKey: ['watchlist'] });
          } catch {
            // Silent on purpose — see the comment above.
          }
        }
      }

      // New entries are intentionally chained in the same composer: the
      // successful save above reset the draft, so the next activity is ready
      // immediately. Editing remains a one-and-done flow.
      if (editing) onClose();
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
                value={quantityValue}
                onChange={(e) => {
                  setQuantityTouched(true);
                  set({ quantity: e.target.value });
                }}
                className={inputClass}
              />
              <input
                type="number"
                inputMode="decimal"
                placeholder="price"
                value={priceValue}
                onChange={(e) => {
                  setPriceTouched(true);
                  set({ price: e.target.value });
                }}
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

            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                inputMode="decimal"
                placeholder="net cash"
                aria-label="Platform net cash"
                value={draft.reportedNetCash}
                onChange={(e) => set({ reportedNetCash: e.target.value })}
                className={inputClass}
              />
              <input
                type="number"
                inputMode="decimal"
                placeholder="balance after"
                aria-label="Platform balance after"
                value={draft.reportedBalance}
                onChange={(e) => set({ reportedBalance: e.target.value })}
                className={inputClass}
              />
            </div>
            <p className="text-xs text-muted">
              From your broker's confirmation: this fill's net cash impact
              (positive amounts — Buy/Sell sets the sign) and your resulting
              cash balance. Used only to flag drift from what we derive.
            </p>

            {context.closing && (
              <button
                type="button"
                onClick={() => {
                  setQuantityTouched(true);
                  set({ quantity: String(Math.abs(context.held)) });
                }}
                className="text-xs text-muted underline underline-offset-4"
              >
                {Math.abs(context.held).toLocaleString('en-US')} held · tap to
                use
              </button>
            )}

            <StopLevelEditor
              rows={draft.stops}
              onChange={(stops) => set({ stops })}
              entryPrice={priceValue}
              quantity={quantityValue}
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

        {draft.kind === 'TRADE' && reasonOptions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {reasonOptions.map((option) => {
              const on = selectedReasons.includes(option.code);
              return (
                <button
                  key={option.code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setReasonsTouched(true);
                    set({
                      reasons: on
                        ? selectedReasons.filter((c) => c !== option.code)
                        : [...selectedReasons, option.code],
                    });
                  }}
                  className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                    on
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-border text-muted'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        )}

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
          <Button variant="secondary" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            disabled={mutation.isPending || reportedCashIncomplete}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? 'Saving…'
              : editing
                ? 'Save changes'
                : 'Save entry'}
          </Button>
        </div>

        {reportedCashIncomplete && (
          <p className="text-xs text-down">
            {reportedCashRequired
              ? 'Enter both the net cash and the resulting balance from your platform.'
              : 'Enter both the net cash and the resulting balance, or leave both blank.'}
          </p>
        )}

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
        <Button
          variant="danger"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Deleting…' : 'Delete'}
        </Button>
        <Button variant="secondary" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
      {mutation.isError && (
        <p className="text-xs text-down">{(mutation.error as Error).message}</p>
      )}
    </div>
  );
}
