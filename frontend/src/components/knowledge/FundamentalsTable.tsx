import { ApiError } from '../../api/client';
import { useFundamentals, type Fundamentals } from '../../api/knowledge';
import { etDate } from '../../lib/dates';
import { DASH, formatEps, formatMoney } from '../../lib/money';

const MINUS = '−';

const reportDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'America/New_York',
});

function formatYoY(n: number): string {
  const r = Math.round(n);
  return `${r < 0 ? MINUS : '+'}${Math.abs(r)}% YoY`;
}

/** Green on a beat, red on a miss, plain when equal or when there is no estimate. */
function tone(actual: number | null, estimate: number | null): string {
  if (actual === null || estimate === null || actual === estimate) return '';
  return actual > estimate ? 'text-up' : 'text-down';
}

function Line({ name, children, className = '' }: { name: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="whitespace-nowrap">
      <span className="mr-1 text-[10px] uppercase text-muted">{name}</span>
      <span className={className}>{children}</span>
    </div>
  );
}

function Table({ data }: { data: Fundamentals }) {
  const { next, quarters } = data;
  return (
    <div data-testid="fundamentals" className="space-y-3 text-sm">
      <table className="w-full table-fixed border-collapse tabular-nums">
        <colgroup>
          <col className="w-[34%]" />
          <col className="w-[33%]" />
          <col className="w-[33%]" />
        </colgroup>
        <thead>
          <tr className="text-left text-xs font-medium uppercase tracking-wide text-muted">
            <th className="pb-1 font-medium">Report</th>
            <th className="pb-1 font-medium">Expected</th>
            <th className="pb-1 font-medium">Actual</th>
          </tr>
        </thead>
        <tbody>
          {next && (
            <tr data-testid="fundamentals-next" className="border-t border-border align-top">
              <td className="py-1.5 pr-1">
                <div>{next.reportAt ? reportDate.format(new Date(next.reportAt)) : DASH}</div>
                <div className="text-xs text-muted">{next.label ?? DASH}</div>
              </td>
              <td className="py-1.5 pr-1">
                <Line name="EPS">{formatEps(next.epsEstimate)}</Line>
                <Line name="Rev">{formatMoney(next.revenueEstimate)}</Line>
              </td>
              <td className="py-1.5" />
            </tr>
          )}
          {quarters.map((q) => (
            <tr key={q.periodEnd} data-testid={`fundamentals-q-${q.periodEnd}`} className="border-t border-border align-top">
              <td className="py-1.5 pr-1">
                <div>{q.reportedAt ? reportDate.format(new Date(q.reportedAt)) : DASH}</div>
                <div className="text-xs text-muted">{q.label}</div>
              </td>
              <td className="py-1.5 pr-1">
                <Line name="EPS">{formatEps(q.epsEstimate)}</Line>
                <Line name="Rev">{formatMoney(q.revenueEstimate)}</Line>
              </td>
              <td className="py-1.5">
                <Line name="EPS" className={tone(q.eps, q.epsEstimate)}>
                  {formatEps(q.eps)}
                </Line>
                <Line name="Rev" className={tone(q.revenue, q.revenueEstimate)}>
                  {formatMoney(q.revenue)}
                </Line>
                {q.revenueYoY !== null && <div className="text-[11px] text-muted">{formatYoY(q.revenueYoY)}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {quarters.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Free cash flow</h3>
          <ul className="grid grid-cols-4 gap-1 tabular-nums">
            {quarters.map((q) => (
              <li key={q.periodEnd}>
                <div className="text-[11px] text-muted">{q.label}</div>
                <div>{formatMoney(q.fcf)}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p data-testid="fundamentals-balance">
        Cash {formatMoney(data.cash)} · Debt {formatMoney(data.debt)} · Net cash {formatMoney(data.netCash)}
      </p>
      <p className="text-xs text-muted">Updated {etDate(data.fetchedAt)} · expectations: Alpha Vantage</p>
    </div>
  );
}

/** Live quarterly numbers for a company, shown at the top of its Fundamentals node. */
export function FundamentalsTable({ symbol }: { symbol: string }) {
  const { data, isLoading, error } = useFundamentals(symbol, true);
  if (isLoading) {
    return (
      <div data-testid="fundamentals-loading" aria-label="Loading numbers" className="space-y-2 animate-pulse">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-8 rounded bg-surface-2" />
        ))}
      </div>
    );
  }
  if (error || !data) {
    const text =
      error instanceof ApiError && error.status === 404 ? error.message : "Couldn't load the numbers right now.";
    return (
      <p role="alert" className="text-sm text-muted">
        {text}
      </p>
    );
  }
  return <Table data={data} />;
}
