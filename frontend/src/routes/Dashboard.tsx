import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Money } from '../components/Money';
import { Percent } from '../components/Percent';
import { formatQuantity, signClass } from '../components/format';
import {
  sortPositions,
  type SortDir,
  type SortKey,
} from '../lib/sortPositions';
import { loadDraft, saveDraft } from '../lib/draftStorage';
import {
  BenchmarkChart,
  RANGES,
  type Point,
  type Range,
} from '../components/BenchmarkChart';

interface Position {
  symbol: string;
  name: string | null;
  quantity: number;
  avgCost: number;
  costBasis: number;
  feesPaid: number;
  realizedPnl: number;
  price: number | null;
  stale: boolean;
  session: 'PRE' | 'REGULAR' | 'POST' | 'CLOSED' | null;
  extended: boolean;
  regularPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPct: number | null;
  tradeId: string | null;
}

interface AtRisk {
  amount: number;
  positionsWithoutStop: { count: number; symbols: string[] };
}

interface Portfolio {
  positions: Position[];
  cash: number;
  positionsValue: number;
  accountValue: number;
  hasStalePrices: boolean;
  pricedAt: string;
  marketSession: 'PRE' | 'REGULAR' | 'POST' | 'CLOSED' | null;
  pricesAreExtended: boolean;
  atRisk: AtRisk;
}

const SESSION_LABEL: Record<string, string> = {
  PRE: 'PRE-MARKET',
  POST: 'AFTER HOURS',
  CLOSED: 'MARKET CLOSED',
};

/**
 * Says which session the numbers come from. Silent during regular hours, when
 * a live price needs no explanation; extended-hours prints are thinner and can
 * gap, so they are always labelled rather than passed off as the close.
 */
function SessionBadge({
  session,
  extended,
}: {
  session: string | null;
  extended: boolean;
}) {
  if (!session || session === 'REGULAR') return null;
  const label = SESSION_LABEL[session];
  if (!label) return null;
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide ${
        extended ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-muted'
      }`}
    >
      {label}
    </span>
  );
}

const RANGE_KEY = 'trader.benchmarkRange.v1';

// The owner trades daily, so the week is the default lens — but a value
// saved before 1W existed (or any value that is not a real range, ever)
// must still load without throwing, rather than handing an unrecognised
// string down to the chart and the API.
const DEFAULT_RANGE: Range = '1W';
const RANGE_VALUES = new Set<Range>(RANGES.map((r) => r.value));
const sanitizeRange = (value: Range): Range =>
  RANGE_VALUES.has(value) ? value : DEFAULT_RANGE;

interface Performance {
  points: Point[];
  deltas: { vsSp500: number | null; vsNasdaq: number | null } | null;
}

const SORT_KEY = 'trader.holdingsSort.v1';

interface SortPref {
  key: SortKey;
  dir: SortDir;
}

/** Biggest position first — the most useful default for a working trader. */
const defaultSort: SortPref = { key: 'marketValue', dir: 'desc' };

const SORT_OPTIONS: { key: SortKey; dir: SortDir; label: string }[] = [
  { key: 'marketValue', dir: 'desc', label: 'Value — largest first' },
  { key: 'marketValue', dir: 'asc', label: 'Value — smallest first' },
  { key: 'unrealizedPct', dir: 'desc', label: '% — best first' },
  { key: 'unrealizedPct', dir: 'asc', label: '% — worst first' },
  { key: 'unrealizedPnl', dir: 'desc', label: 'P&L — most profit' },
  { key: 'unrealizedPnl', dir: 'asc', label: 'P&L — biggest loss' },
  { key: 'symbol', dir: 'asc', label: 'Symbol — A to Z' },
  { key: 'symbol', dir: 'desc', label: 'Symbol — Z to A' },
];

const encode = (s: SortPref) => `${s.key}:${s.dir}`;

/**
 * A native <select> rather than a custom menu: iOS renders its own picker
 * wheel, which is a better control than anything hand-built, and it keeps the
 * header to one compact element instead of a row of chips that grows every
 * time a sort option is added.
 */
function SortPicker({
  sort,
  onChange,
}: {
  sort: SortPref;
  onChange: (s: SortPref) => void;
}) {
  return (
    <label className="relative shrink-0">
      <span className="sr-only">Sort holdings</span>
      <select
        value={encode(sort)}
        onChange={(e) => {
          const found = SORT_OPTIONS.find((o) => encode(o) === e.target.value);
          if (found) onChange({ key: found.key, dir: found.dir });
        }}
        className="appearance-none rounded-lg border border-border bg-surface-1 py-1.5 pr-7 pl-2.5 text-xs text-muted outline-none"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={encode(o)} value={encode(o)}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[9px] text-muted">
        ▼
      </span>
    </label>
  );
}

/**
 * Deliberate three-tier hierarchy, because every row was previously reading as
 * two equally-loud facts:
 *   1. symbol and market value  — what you scan for
 *   2. percent return           — how it is doing
 *   3. cost basis and $ P&L     — supporting detail, quiet on purpose
 */
function PositionRow({ p }: { p: Position }) {
  const content = (
    <>
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
            <span className="text-[9px] tracking-wide text-down">STALE</span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[11px] leading-tight text-muted">
          {formatQuantity(p.quantity)} @ <Money value={p.avgCost} />
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="text-[15px] font-medium leading-tight">
          <Money value={p.marketValue} />
        </div>
        <div className="mt-0.5 flex items-baseline justify-end gap-1.5 leading-tight">
          <Percent value={p.unrealizedPct} className="text-[12px]" />
          <span className={`text-[11px] opacity-70 ${signClass(p.unrealizedPnl)}`}>
            <Money value={p.unrealizedPnl} signed />
          </span>
        </div>
      </div>
    </>
  );

  return (
    <li className="border-b border-border last:border-0">
      {p.tradeId !== null ? (
        <Link
          to={`/trades/${encodeURIComponent(p.tradeId)}`}
          className="flex items-baseline justify-between gap-3 py-2.5 transition-colors hover:bg-surface-1 active:bg-surface-2"
        >
          {content}
        </Link>
      ) : (
        <div className="flex items-baseline justify-between gap-3 py-2.5">
          {content}
        </div>
      )}
    </li>
  );
}

/**
 * Seeding is a one-shot flow that is easy to get wrong on a phone, so there has
 * to be a way back. Two-step inline confirmation rather than a browser dialog:
 * it names what is about to be destroyed and stays inside the app's own UI.
 */
function ResetPortfolio({ positionCount }: { positionCount: number }) {
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: () => api('/portfolio/reset', { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      navigate('/seed');
    },
  });

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-muted underline underline-offset-4"
      >
        Reset &amp; re-seed portfolio
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-down/40 bg-down/10 p-3">
      <p className="text-xs text-text">
        This deletes {positionCount}{' '}
        {positionCount === 1 ? 'position' : 'positions'}, your cash balance and
        every journal entry, then takes you back to seeding. It cannot be
        undone.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
          className="rounded-lg bg-down px-3 py-2 text-sm font-medium text-surface-0 disabled:opacity-50"
        >
          {mutation.isPending ? 'Resetting…' : 'Delete and start over'}
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

export function Dashboard() {
  const [sort, setSort] = useState<SortPref>(() =>
    loadDraft(SORT_KEY, defaultSort),
  );
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<Range>(() =>
    sanitizeRange(loadDraft(RANGE_KEY, { range: DEFAULT_RANGE }).range),
  );
  const queryClient = useQueryClient();

  const { data: performance } = useQuery({
    queryKey: ['performance', range],
    queryFn: () => api<Performance>(`/performance?range=${range}`),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => api<Portfolio>('/portfolio'),
    refetchInterval: 60_000,
  });

  const changeSort = (s: SortPref) => {
    setSort(s);
    saveDraft(SORT_KEY, s);
  };

  /**
   * Forces the server past its 60s quote cache. Without `refresh=1` this would
   * re-serve the same numbers and look like a broken button.
   */
  const refreshNow = async () => {
    setRefreshing(true);
    try {
      const fresh = await api<Portfolio>('/portfolio?refresh=1');
      queryClient.setQueryData(['portfolio'], fresh);
    } catch {
      // Leave the existing numbers on screen; the stale markers already warn.
    } finally {
      setRefreshing(false);
    }
  };

  if (isLoading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }
  if (error) {
    return <p className="text-sm text-down">{(error as Error).message}</p>;
  }
  if (!data || data.positions.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">No portfolio yet.</p>
        <Link
          to="/seed"
          className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface-0"
        >
          Seed your portfolio
        </Link>
      </div>
    );
  }

  const totalUnrealized = data.positions.reduce(
    (sum, p) => sum + (p.unrealizedPnl ?? 0),
    0,
  );

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-muted">
                Account value
              </span>
              <SessionBadge
                session={data.marketSession}
                extended={data.pricesAreExtended}
              />
            </div>
            <div className="mt-1 text-4xl font-semibold">
              <Money value={data.accountValue} />
            </div>
            <div className="mt-1 text-sm">
              <span className={signClass(totalUnrealized)}>
                <Money value={totalUnrealized} signed /> unrealized
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={refreshNow}
            disabled={refreshing}
            aria-label="Refresh prices now"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface-1 text-base text-muted active:bg-surface-2 disabled:opacity-50"
          >
            <span className={refreshing ? 'inline-block animate-spin' : ''}>
              ↻
            </span>
          </button>
        </div>
      </section>

      <section className="flex flex-wrap gap-3">
        <div className="min-w-[140px] flex-1 rounded-xl border border-border bg-surface-1 p-3">
          <div className="text-xs text-muted">Cash</div>
          <div
            className={`mt-1 text-lg font-medium ${data.cash < 0 ? 'text-down' : ''}`}
          >
            <Money value={data.cash} />
          </div>
          {data.cash < 0 && (
            <div className="text-[10px] tracking-wide text-down">ON MARGIN</div>
          )}
        </div>
        <div className="min-w-[140px] flex-1 rounded-xl border border-border bg-surface-1 p-3">
          <div className="text-xs text-muted">Deployed</div>
          <div className="mt-1 text-lg font-medium">
            <Money value={data.positionsValue} />
          </div>
        </div>
        <div className="min-w-[140px] flex-1 rounded-xl border border-border bg-surface-1 p-3">
          <div className="text-xs text-muted">At risk</div>
          <div className="mt-1 text-lg font-medium">
            <Money value={data.atRisk.amount} />
          </div>
          {data.atRisk.positionsWithoutStop.count > 0 && (
            <div
              className="mt-0.5 text-[10px] tracking-wide text-down"
              title={data.atRisk.positionsWithoutStop.symbols.join(', ')}
            >
              +{data.atRisk.positionsWithoutStop.count}{' '}
              {data.atRisk.positionsWithoutStop.count === 1
                ? 'POSITION'
                : 'POSITIONS'}{' '}
              WITHOUT A STOP
            </div>
          )}
        </div>
      </section>

      <BenchmarkChart
        points={performance?.points ?? []}
        deltas={performance?.deltas ?? null}
        range={range}
        onRangeChange={(r) => {
          setRange(r);
          saveDraft(RANGE_KEY, { range: r });
        }}
      />

      <section>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted">
            Holdings
          </span>
          <SortPicker sort={sort} onChange={changeSort} />
        </div>
        <ul>
          {sortPositions(data.positions, sort.key, sort.dir).map((p) => (
            <PositionRow key={p.symbol} p={p} />
          ))}
        </ul>
      </section>

      <section className="pt-2">
        <ResetPortfolio positionCount={data.positions.length} />
      </section>
    </div>
  );
}
