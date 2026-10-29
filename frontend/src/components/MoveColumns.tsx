import type { Move } from '../api/moves';
import type { SortKey, SortState } from '../lib/sortRows';

export const fmtAtr = (n: number | null) => (n === null ? '—' : `${n.toFixed(1)}%`);

export function fmtMove(n: number | null): string {
  if (n === null) return '—';
  if (n > 0) return `+${n.toFixed(1)}%`;
  if (n < 0) return `−${Math.abs(n).toFixed(1)}%`;
  return '0.0%';
}

/** A move gets a colour only when it is bigger than the ATR; equal or unknown stays plain. */
export function moveTone(m: Move | undefined): 'up' | 'down' | null {
  if (!m || m.atrPercent === null || m.movePercent === null) return null;
  if (Math.abs(m.movePercent) <= m.atrPercent) return null;
  return m.movePercent > 0 ? 'up' : 'down';
}

export const toneClass = (tone: 'up' | 'down' | null) =>
  tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : '';

const ATR_W = 'w-12 shrink-0 text-right text-sm tabular-nums';
const TODAY_W = 'w-14 shrink-0 text-right text-sm tabular-nums';

export function MoveCells({ symbol, move }: { symbol: string; move: Move | undefined }) {
  return (
    <>
      <span data-testid={`atr-${symbol}`} className={`${ATR_W} text-muted`}>
        {fmtAtr(move?.atrPercent ?? null)}
      </span>
      <span data-testid={`today-${symbol}`} className={`${TODAY_W} ${toneClass(moveTone(move))}`}>
        {fmtMove(move?.movePercent ?? null)}
      </span>
    </>
  );
}

function SortHeader({
  label,
  col,
  sort,
  onSort,
  className,
}: {
  label: string;
  col: SortKey;
  sort: SortState | null;
  onSort?: (key: SortKey) => void;
  className: string;
}) {
  const active = sort?.key === col ? sort.dir : null;
  return (
    <button
      type="button"
      onClick={() => onSort?.(col)}
      aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}
      aria-label={`Sort by ${label}${active ? `, ${active === 'asc' ? 'ascending' : 'descending'}` : ''}`}
      className={`${className} -my-2 py-2 ${active ? 'text-text' : ''}`}
    >
      <span>{label}</span>
      {active && <span aria-hidden="true"> {active === 'asc' ? '▲' : '▼'}</span>}
    </button>
  );
}

/**
 * Header row above the list; Ticker / ATR / Today are sort buttons.
 * `Today (close)` once every returned move is a settled close.
 */
export function MovesHeader({
  moves,
  sort = null,
  onSort,
}: {
  moves: Move[] | undefined;
  sort?: SortState | null;
  onSort?: (key: SortKey) => void;
}) {
  const closed = !!moves && moves.length > 0 && moves.every((m) => !m.live);
  return (
    <div className="flex items-center gap-3 px-3 text-xs text-muted" data-testid="moves-header">
      <span className="flex-1 text-left">
        <SortHeader label="Ticker" col="ticker" sort={sort} onSort={onSort} className="text-left text-xs" />
      </span>
      <SortHeader label="ATR" col="atr" sort={sort} onSort={onSort} className={`${ATR_W} text-xs`} />
      <SortHeader label={closed ? 'Today (close)' : 'Today'} col="today" sort={sort} onSort={onSort} className={`${TODAY_W} text-xs`} />
    </div>
  );
}

export function AtrToggle({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`shrink-0 whitespace-nowrap rounded-lg border px-2 py-1.5 text-xs transition-colors ${
        on ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border text-muted'
      }`}
    >
      {on ? 'Hide ATR' : 'Show ATR'}
    </button>
  );
}
