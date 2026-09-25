import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Money } from '../components/Money';
import { signClass } from '../components/format';
import {
  HoldingsTable,
  type Position,
  type PortfolioTotals,
} from '../components/HoldingsTable';
import { loadDraft, saveDraft } from '../lib/draftStorage';
import { AiSummary } from '../components/AiSummary';
import { SessionBadge } from '../components/SessionBadge';
import { RefreshButton } from '../components/RefreshButton';
import { BenchmarkChart } from '../components/BenchmarkChart';
import { MinimizableSection } from '../components/ui/MinimizableSection';
import { RANGES, type Point, type Range } from '../lib/benchmarkRange';

interface AtRisk {
  amount: number;
  positionsWithoutStop: { count: number; symbols: string[] };
  positionsWithPartialStop: {
    count: number;
    positions: { symbol: string; coveredQuantity: number; heldQuantity: number }[];
  };
}

interface Portfolio {
  positions: Position[];
  cash: number;
  accountValue: number;
  hasStalePrices: boolean;
  pricedAt: string;
  marketSession: 'PRE' | 'REGULAR' | 'POST' | 'OVERNIGHT' | 'CLOSED' | null;
  pricesAreExtended: boolean;
  atRisk: AtRisk;
  totals: PortfolioTotals;
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

export function Dashboard() {
  const [searchParams] = useSearchParams();
  const focusedSymbol = searchParams.get('symbol')?.toUpperCase() ?? null;
  const focusedRowRef = useRef<HTMLSpanElement>(null);
  const scrolledTo = useRef<string | null>(null);
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

  useEffect(() => {
    if (!focusedSymbol) {
      scrolledTo.current = null;
    } else if (data?.positions.some((p) => p.symbol === focusedSymbol) && scrolledTo.current !== focusedSymbol) {
      focusedRowRef.current?.scrollIntoView?.({ block: 'center' });
      scrolledTo.current = focusedSymbol;
    }
  }, [data, focusedSymbol]);

  if (isLoading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }
  if (error) {
    return <p className="text-sm text-down">{(error as Error).message}</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted">No portfolio data available.</p>;
  }

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
              {/* Priced from the same extended-hours prints as the holdings. */}
              <SessionBadge
                session={data.marketSession}
                extended={data.pricesAreExtended}
              />
            </div>
            <div className="mt-1 text-4xl font-semibold">
              <Money value={data.accountValue} />
            </div>
            <div className="mt-1 text-sm">
              <span className={signClass(data.totals.unrealizedPnl)}>
                <Money value={data.totals.unrealizedPnl} signed /> unrealized
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
          {data.atRisk.positionsWithPartialStop.count > 0 && (
            <div
              className="mt-0.5 text-[10px] tracking-wide text-down"
              title={data.atRisk.positionsWithPartialStop.positions
                .map((p) => p.symbol)
                .join(', ')}
            >
              +{data.atRisk.positionsWithPartialStop.count}{' '}
              {data.atRisk.positionsWithPartialStop.count === 1
                ? 'POSITION'
                : 'POSITIONS'}{' '}
              WITH A PARTIAL STOP
            </div>
          )}
        </div>
      </section>
      </MinimizableSection>

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

      <HoldingsTable
        positions={data.positions}
        totals={data.totals}
        marketSession={data.marketSession}
        pricesAreExtended={data.pricesAreExtended}
        focusedSymbol={focusedSymbol}
        focusedRef={focusedRowRef}
      />
    </div>
  );
}
