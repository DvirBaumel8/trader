import { useState, type ReactNode } from 'react';

/**
 * The app's ONE way of showing generated content that runs long.
 *
 * A model's answer is several hundred words. On a phone that buries
 * everything below it — the history list, the button that asks the next
 * question, the rest of the screen. Collapsing keeps the answer available
 * without making the page unreachable.
 *
 * **Collapsed means one header line.** Not "the prose is hidden but a verdict
 * and a metrics grid remain" — that is what the trade review did by
 * reimplementing this instead of reusing it, and it left a card inches tall
 * on a phone while claiming to be minimised. Anything that must survive
 * collapsing belongs in `header`; everything else goes in `children`.
 *
 * Open on arrival: it was just asked for, so hiding it would be perverse.
 *
 * The toggle is its own control rather than the whole header being clickable,
 * because a card may carry sibling actions (Re-evaluate) and a button inside
 * a button is invalid.
 */
export function CollapsibleCard({
  header,
  actions,
  children,
  label,
  defaultOpen = true,
}: {
  /** Always visible, collapsed or not. Keep it to one line. */
  header: ReactNode;
  /** Optional controls sitting beside the toggle; stay reachable when collapsed. */
  actions?: ReactNode;
  children: ReactNode;
  /** Noun for the toggle's accessible name: "Hide review". */
  label: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="space-y-2 rounded-xl border border-dashed border-accent/40 bg-surface-1 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">{header}</div>
        <div className="flex shrink-0 items-center gap-3">
          {actions}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} ${label}`}
            className="text-[11px] font-medium text-muted hover:text-text"
          >
            {open ? 'Hide ▲' : 'Show ▼'}
          </button>
        </div>
      </div>
      {open && children}
    </div>
  );
}
