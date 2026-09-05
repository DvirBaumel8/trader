import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { StopLevelEditor } from './StopLevelEditor';
import { usePersistentState } from '../lib/persistentState';
import type { StopRow } from '../lib/stopRow';

interface Tier {
  kind: 'FIXED' | 'TRAILING';
  price: number | null;
  trailPercent: number | null;
  quantity: number;
}

/**
 * Edit an open trade's stop plan without reopening the journal entry that
 * opened it.
 *
 * Every save is an APPEND: `PATCH /portfolio/trades/:id/stops` writes a new
 * revision rather than editing rows, so removing a tier means submitting a
 * list without it and the plan as it stood on any past date survives. That is
 * what keeps risk-at-entry and R reconstructible after the fact — overwriting
 * in place is what once destroyed every original stop in this database.
 *
 * The whole list is always submitted, because the endpoint replaces the plan
 * rather than patching one tier.
 */
export function StopPlanEditor({
  tradeId,
  tiers,
  avgEntry,
  quantity,
  direction,
  currentPrice,
  highWaterPrice,
}: {
  tradeId: string;
  tiers: Tier[];
  avgEntry: number;
  quantity: number;
  direction: 'LONG' | 'SHORT';
  /**
   * Null when the live quote could not be fetched — the editor then falls
   * back to pricing from entry rather than showing nothing, same as before
   * this screen had a current price to work from at all.
   */
  currentPrice: number | null;
  highWaterPrice: number | null;
}) {
  // Keyed per trade, so two positions being edited never share a draft.
  // Switching to a broker app to read a level is the normal way this screen is
  // used, and iOS discards the tab while you are there — typed rows used to
  // come back reset to the server's values, silently losing the edit.
  const [open, setOpen, clearOpen] = usePersistentState(
    `trader.stopPlan.${tradeId}.open`,
    false,
  );
  const [rows, setRows, clearRows] = usePersistentState<StopRow[]>(
    `trader.stopPlan.${tradeId}.rows`,
    fromTiers(tiers),
  );
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      api(`/portfolio/trades/${tradeId}/stops`, {
        method: 'PATCH',
        body: JSON.stringify({
          levels: rows
            .filter(
              (r) =>
                parseFloat(r.quantity || '0') > 0 &&
                (r.kind === 'FIXED' ? r.price !== '' : r.trailPercent !== ''),
            )
            .map((r) => ({
              kind: r.kind,
              price: r.kind === 'FIXED' ? parseFloat(r.price) : undefined,
              trailPercent:
                r.kind === 'TRAILING' ? parseFloat(r.trailPercent) : undefined,
              quantity: Math.abs(parseFloat(r.quantity)),
            })),
        }),
      }),
    onSuccess: async () => {
      // The Stops page, the dashboard's at-risk box and this screen all read
      // the same derived plan, so all three must refetch or one of them will
      // sit showing a level that no longer exists.
      await Promise.all(
        ['trade', 'portfolio', 'stats'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
      // Saved: the draft has become the server's truth, so it must not be
      // restored on top of a later plan.
      clearRows();
      clearOpen();
      setOpen(false);
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setRows(fromTiers(tiers));
          setOpen(true);
        }}
        className="w-full rounded-xl border border-border bg-surface-1 px-3 py-2 text-sm text-muted"
      >
        {tiers.length === 0 ? 'Add a stop' : 'Edit stops'}
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-1 p-3">
      <div className="text-xs font-medium tracking-wide text-muted uppercase">
        Stop plan
      </div>
      <StopLevelEditor
        rows={rows}
        onChange={setRows}
        entryPrice={String(avgEntry)}
        quantity={String(Math.abs(quantity))}
        side={direction === 'LONG' ? 'BUY' : 'SELL'}
        priceFrom={currentPrice !== null ? { currentPrice, highWaterPrice } : undefined}
      />
      {mutation.isError && (
        <p className="text-xs text-down">
          {/*
            The server's own words: emptying a plan is refused with a specific
            reason, and a generic failure line would leave the owner retyping
            the same thing. The plan is unchanged either way.
          */}
          {mutation.error instanceof Error
            ? mutation.error.message
            : 'Could not save — the plan is unchanged.'}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            // Cancel means discard: without clearing, the abandoned draft
            // would be restored the next time this trade is opened.
            clearRows();
            clearOpen();
            setOpen(false);
          }}
          disabled={mutation.isPending}
          className="flex-1 rounded-lg border border-border px-3 py-2 text-sm text-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-surface-0 disabled:opacity-60"
        >
          {mutation.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
      <p className="text-[11px] leading-tight text-muted">
        Saving records a new revision. The plan you set at entry is kept, so
        your risk and R stay measured against it.
      </p>
    </div>
  );
}

/** The live plan as editable rows. Empty list = no stop recorded yet. */
function fromTiers(tiers: Tier[]): StopRow[] {
  return tiers.map((t) => ({
    kind: t.kind,
    price: t.price === null ? '' : String(t.price),
    trailPercent: t.trailPercent === null ? '' : String(t.trailPercent),
    quantity: String(t.quantity),
  }));
}
