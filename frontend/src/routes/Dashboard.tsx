import { Fragment, useState } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Money } from '../components/Money';
import { Percent } from '../components/Percent';
import { Select } from '../components/ui/Select';
import { formatQuantity, signClass } from '../components/format';
import {
  sortPositions,
  type SortDir,
  type SortKey,
} from '../lib/sortPositions';
import { loadDraft, saveDraft } from '../lib/draftStorage';
import { AiSummary } from '../components/AiSummary';
import { SessionBadge } from '../components/SessionBadge';
import { RefreshButton } from '../components/RefreshButton';
import { Button } from '../components/ui/Button';
import { BenchmarkChart } from '../components/BenchmarkChart';
import { MinimizableSection } from '../components/ui/MinimizableSection';
import { DailyBrief } from '../components/DailyBrief';
import { RANGES, type Point, type Range } from '../lib/benchmarkRange';

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
  daysUntilEarnings: number | null;
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
  unpricedSymbols: string[];
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
 * time a sort option is added. The shell itself is `ui/Select`; only the
 * encode/decode between a composite sort key and a plain option string is
 * specific to this screen.
 */
function SortPicker({
  sort,
  onChange,
}: {
  sort: SortPref;
  onChange: (s: SortPref) => void;
}) {
  return (
    <Select
      value={encode(sort)}
      onChange={(v) => {
        const found = SORT_OPTIONS.find((o) => encode(o) === v);
        if (found) onChange({ key: found.key, dir: found.dir });
      }}
      options={SORT_OPTIONS.map((o) => ({ value: encode(o), label: o.label }))}
      srLabel="Sort holdings"
    />
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
  return (
    <Fragment>
      <Link
        to={p.tradeId !== null ? `/trades/${encodeURIComponent(p.tradeId)}` : '#'}
        className={p.tradeId !== null ? 'group contents' : 'contents'}
        onClick={p.tradeId === null ? (e) => e.preventDefault() : undefined}
      >
        <div className={`min-w-0 truncate text-[15px] font-semibold ${ROW_CELL}`}>
          <div className="flex items-center gap-1.5">
            {p.symbol}
            {p.quantity < 0 && (
              <span className="rounded bg-down/15 px-1 py-px text-[9px] font-medium tracking-wide text-down">
                SHORT
              </span>
            )}
            {p.stale && (
              <span className="text-[9px] tracking-wide text-down">STALE</span>
            )}
          </div>
        </div>
        <span className={`text-right text-[12px] tabular-nums text-muted ${ROW_CELL}`}>
          {formatQuantity(p.quantity)} @ <Money value={p.avgCost} />
        </span>
        <span className={`text-right text-[13px] tabular-nums ${ROW_CELL}`}>
          <Money value={p.marketValue} />
        </span>
        <span className={`text-right ${ROW_CELL}`}>
          <span className="block text-[12px] tabular-nums"><Percent value={p.unrealizedPct} /></span>
          <span className={`block text-[11px] tabular-nums opacity-70 ${signClass(p.unrealizedPnl)}`}><Money value={p.unrealizedPnl} signed /></span>
        </span>
        <span className={`text-right text-[11px] tabular-nums text-muted ${ROW_CELL}`}>
          {p.daysUntilEarnings === null ? '—' : p.daysUntilEarnings === 0 ? 'today' : `${p.daysUntilEarnings}d`}
        </span>
      </Link>
    </Fragment>
  );
}

const HEADER_CELL = 'text-[10px] tracking-wide text-muted uppercase';
const ROW_CELL = 'py-3 transition-colors group-hover:bg-surface-1 group-active:bg-surface-2';

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
        <Button
          variant="danger"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Resetting…' : 'Delete and start over'}
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

export function Dashboard() {
  const [sort, setSort] = useState<SortPref>(() =>
    loadDraft(SORT_KEY, defaultSort),
  );
  const [range, setRange] = useState<Range>(() =>
    sanitizeRange(loadDraft(RANGE_KEY, { range: DEFAULT_RANGE }).range),
  );
  const { data: performance } = useQuery({
    queryKey: ['performance', range],
    queryFn: () => api<Performance>(`/performance?range=${range}`),
    // Changing the range changes the query key, so without this the data is
    // momentarily undefined and the chart collapses to "No history yet"
    // before redrawing — a flash that reads as a bug every time a range is
    // tapped. Keeping the previous range's points on screen while the new
    // ones load means the chart only ever redraws to real data.
    placeholderData: keepPreviousData,
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
    <div className="space-y-4">
      <MinimizableSection storageKey="trader.portfolio.overviewOpen" label="Overview">
      <section>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-text/70">
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

          <RefreshButton />
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
          {/*
            Counting the array the backend already served — `GET /portfolio`
            filters to open positions (`portfolio.service.ts`), so this IS the
            number of tickers held, and nothing here decides what it means.
            Shorts count: they are held and they carry risk.
          */}
          <div className="text-xs text-muted">Positions</div>
          <div className="mt-1 text-lg font-medium">
            {data.positions.length}
          </div>
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
      </MinimizableSection>

      <DailyBrief />

      <MinimizableSection storageKey="trader.portfolio.aiOpen" label="AI summary">
        <AiSummary />
      </MinimizableSection>

      <MinimizableSection storageKey="trader.portfolio.benchmarkOpen" label="Benchmark">
        <BenchmarkChart
          points={performance?.points ?? []}
          deltas={performance?.deltas ?? null}
          unpricedSymbols={performance?.unpricedSymbols ?? []}
          range={range}
          onRangeChange={(r) => {
            setRange(r);
            saveDraft(RANGE_KEY, { range: r });
          }}
        />
      </MinimizableSection>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-text/70">
            Holdings
          </span>
          <SortPicker sort={sort} onChange={changeSort} />
        </div>
        <div className="overflow-x-auto">
          <div className="grid min-w-[34rem] grid-cols-[minmax(7rem,1fr)_auto_auto_auto_auto] items-center gap-x-3">
            <span className={`${HEADER_CELL} whitespace-nowrap text-text/70`}>Symbol</span>
            <span className={`whitespace-nowrap text-right ${HEADER_CELL} text-text/70`}>Qty / Avg</span>
            <span className={`whitespace-nowrap text-right ${HEADER_CELL} text-text/70`}>Market value</span>
            <span className={`whitespace-nowrap text-right ${HEADER_CELL} text-text/70`}>P&amp;L</span>
            <span className={`whitespace-nowrap text-right ${HEADER_CELL} text-text/70`}>Earnings</span>
            {sortPositions(data.positions, sort.key, sort.dir).map((p, i) => (
              <Fragment key={p.symbol}>
                <PositionRow p={p} />
                {i < data.positions.length - 1 && <div className="col-span-full border-b border-border" />}
              </Fragment>
            ))}
          </div>
        </div>
      </section>

      <MinimizableSection storageKey="trader.portfolio.resetOpen" label="Portfolio controls">
        <section className="pt-2"><ResetPortfolio positionCount={data.positions.length} /></section>
      </MinimizableSection>
    </div>
  );
}
