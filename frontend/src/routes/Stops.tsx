import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Money } from '../components/Money';
import { formatQuantity } from '../components/format';
import { SessionBadge } from '../components/SessionBadge';
import { loadDraft, saveDraft } from '../lib/draftStorage';
import { sortStopTiers, type StopSortDir } from '../lib/sortStopTiers';

type Session = 'PRE' | 'REGULAR' | 'POST' | 'CLOSED' | null;

interface StopTierRow {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  stopPrice: number;
  quantity: number;
  currentPrice: number;
  session: Session;
  extended: boolean;
  stale: boolean;
  distance: number;
  passed: boolean;
  amountAtRisk: number;
}

interface Position {
  symbol: string;
  quantity: number;
  price: number | null;
  stale: boolean;
  session: Session;
  extended: boolean;
  marketValue: number | null;
  tradeId: string | null;
}

interface Portfolio {
  positions: Position[];
  accountValue: number;
  atRisk: { amount: number; positionsWithoutStop: { count: number; symbols: string[] } };
  stopTiers: StopTierRow[];
}

/**
 * Unsigned, unlike the app's usual `formatPercent`: room and "through" are
 * both already labelled by their surrounding text (see `passed` above), so a
 * leading +/- would be redundant rather than informative here.
 */
function formatMagnitudePercent(fraction: number): string {
  return `${(Math.abs(fraction) * 100).toFixed(2)}%`;
}

const SORT_KEY = 'trader.stopsSort.v1';
const DEFAULT_DIR: StopSortDir = 'asc';

/**
 * A native <select> —
 * the same affordance Dashboard's holdings sort uses — rather than a custom
 * toggle, so the app has one sort idiom instead of two.
 */
function SortPicker({
  dir,
  onChange,
}: {
  dir: StopSortDir;
  onChange: (d: StopSortDir) => void;
}) {
  return (
    <label className="relative shrink-0">
      <span className="sr-only">Sort stops</span>
      <select
        value={dir}
        onChange={(e) => onChange(e.target.value as StopSortDir)}
        className="appearance-none rounded-lg border border-border bg-surface-1 py-1.5 pr-7 pl-2.5 text-xs text-muted outline-none"
      >
        <option value="asc">Nearest to trigger first</option>
        <option value="desc">Furthest first</option>
        <option value="risk">Largest risk first</option>
      </select>
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[9px] text-muted">
        ▼
      </span>
    </label>
  );
}

/**
 * One stop tier. The distance figure is never allowed to read as an ordinary
 * small number when the level has already been passed — see `passed` on
 * stop-distance.ts — so a passed tier gets its own label and colour instead
 * of a formatted negative percentage.
 */
function StopTierRowView({
  row,
  tradeId,
}: {
  row: StopTierRow;
  tradeId: string | null;
}) {
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[15px] font-semibold leading-tight">
            {row.symbol}
          </span>
          {row.direction === 'SHORT' && (
            <span className="rounded bg-down/15 px-1 py-px text-[9px] font-medium tracking-wide text-down">
              SHORT
            </span>
          )}
          {row.stale && (
            <span className="text-[9px] tracking-wide text-down">STALE</span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[11px] leading-tight text-muted">
          Stop <Money value={row.stopPrice} /> · {formatQuantity(row.quantity)} sh
          · now <Money value={row.currentPrice} />
        </div>
      </div>

      <div className="shrink-0 text-right">
        {row.passed ? (
          <div className="text-[13px] font-semibold leading-tight text-down">
            PASSED
            <div className="mt-0.5 text-[11px] font-normal opacity-80">
              {formatMagnitudePercent(row.distance)} through
            </div>
            <div className="mt-0.5 text-[11px] leading-tight text-muted">
              <Money value={row.amountAtRisk} />
            </div>
          </div>
        ) : (
          <div className="text-[15px] font-medium leading-tight">
            {formatMagnitudePercent(row.distance)}
            <div className="mt-0.5 text-[11px] font-normal text-muted">
              room
              <div className="mt-0.5 text-[11px] leading-tight text-muted">
                <Money value={row.amountAtRisk} />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );

  return (
    <li className="border-b border-border last:border-0">
      {tradeId !== null ? (
        <Link
          to={`/trades/${encodeURIComponent(tradeId)}`}
          className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:bg-surface-1 active:bg-surface-2"
        >
          {content}
        </Link>
      ) : (
        <div className="flex items-center justify-between gap-3 py-2.5">
          {content}
        </div>
      )}
    </li>
  );
}

/**
 * Not a footnote: a stops page that let a position with no stop blend into
 * the background would be the most dangerous possible reading of "show my
 * stops". Shown only when it applies — quiet when the book is fully covered,
 * per the owner's own instruction to stay blunt and specific rather than
 * alarmist.
 */
function UnstoppedPositions({
  positions,
  accountValue,
}: {
  positions: Position[];
  accountValue: number;
}) {
  if (positions.length === 0) return null;

  const sorted = [...positions].sort(
    (a, b) => Math.abs(b.marketValue ?? 0) - Math.abs(a.marketValue ?? 0),
  );

  return (
    <section className="rounded-xl border border-down/40 bg-down/10 p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-down">
        No stop · {positions.length}{' '}
        {positions.length === 1 ? 'position' : 'positions'}
      </div>
      <ul>
        {sorted.map((p) => {
          const pctOfAccount =
            accountValue > 0 && p.marketValue !== null
              ? p.marketValue / accountValue
              : null;
          const content = (
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[15px] font-semibold leading-tight">
                    {p.symbol}
                  </span>
                  {p.quantity < 0 && (
                    <span className="rounded bg-down/15 px-1 py-px text-[9px] font-medium tracking-wide text-down">
                      SHORT
                    </span>
                  )}
                  {p.stale && (
                    <span className="text-[9px] tracking-wide text-down">
                      STALE
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[11px] leading-tight text-muted">
                  {formatQuantity(p.quantity)} sh @ <Money value={p.price} />
                </div>
              </div>
              <div className="shrink-0 text-right text-[13px] font-medium leading-tight">
                {pctOfAccount !== null ? (
                  <>{(pctOfAccount * 100).toFixed(1)}% of account</>
                ) : (
                  <Money value={p.marketValue} />
                )}
              </div>
            </div>
          );
          return (
            <li
              key={p.symbol}
              className="border-b border-down/20 py-2 last:border-0 last:pb-0"
            >
              {p.tradeId !== null ? (
                <Link
                  to={`/trades/${encodeURIComponent(p.tradeId)}`}
                  className="block"
                >
                  {content}
                </Link>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Stops() {
  const [dir, setDir] = useState<StopSortDir>(
    () => loadDraft(SORT_KEY, { dir: DEFAULT_DIR }).dir,
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => api<Portfolio>('/portfolio'),
    refetchInterval: 60_000,
  });

  const changeDir = (d: StopSortDir) => {
    setDir(d);
    saveDraft(SORT_KEY, { dir: d });
  };

  if (isLoading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }
  if (error) {
    return <p className="text-sm text-down">{(error as Error).message}</p>;
  }
  if (!data || data.positions.length === 0) {
    return <p className="text-sm text-muted">No portfolio yet.</p>;
  }

  const tradeIdBySymbol = new Map(
    data.positions.map((p) => [p.symbol, p.tradeId]),
  );
  const unstoppedSymbols = new Set(data.atRisk.positionsWithoutStop.symbols);
  const unstoppedPositions = data.positions.filter((p) =>
    unstoppedSymbols.has(p.symbol),
  );
  const sortedTiers = sortStopTiers(data.stopTiers, dir);

  // Every position is priced in the same market session, so the badge is a
  // property of the page rather than of a row.
  const sessionForPage = data.positions[0] ?? null;

  // Averaged over the positions that actually have a stop: dividing the total
  // by every holding would quietly report a smaller average simply because
  // some positions are unprotected, which is the opposite of the truth.
  const stoppedCount = data.positions.length - unstoppedPositions.length;
  const avgRiskPerPosition =
    data.atRisk.amount !== null && stoppedCount > 0
      ? data.atRisk.amount / stoppedCount
      : null;

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted">Stops</span>
          {/*
            Said once, here. Every row carried the same session badge, which
            turned a fact about the market into visual noise repeated twenty
            times. Staleness stays per row: that one genuinely differs by
            symbol, and a stale price must never pass for a fresh one.
          */}
          {sessionForPage && (
            <SessionBadge
              session={sessionForPage.session}
              extended={sessionForPage.extended}
            />
          )}
        </div>
        <div className="mt-1 text-4xl font-semibold">
          <Money value={data.atRisk.amount} />
        </div>
        <div className="mt-1 text-sm text-muted">
          at risk from current stops
          {avgRiskPerPosition !== null && (
            <>
              {' · '}
              <Money value={avgRiskPerPosition} /> average per position
            </>
          )}
        </div>
      </section>

      <UnstoppedPositions
        positions={unstoppedPositions}
        accountValue={data.accountValue}
      />

      <section>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted">
            Stop tiers
          </span>
          <SortPicker dir={dir} onChange={changeDir} />
        </div>
        {sortedTiers.length === 0 ? (
          <p className="text-sm text-muted">No stops recorded yet.</p>
        ) : (
          <ul>
            {sortedTiers.map((row, i) => (
              <StopTierRowView
                key={`${row.symbol}:${row.stopPrice}:${i}`}
                row={row}
                tradeId={tradeIdBySymbol.get(row.symbol) ?? null}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
