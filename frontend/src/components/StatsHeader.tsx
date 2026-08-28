import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Money } from './Money';
import { signClass } from './format';

interface Stats {
  closedCount: number;
  openCount: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  avgRisk: number | null;
  riskTradeCount: number;
  expectancyDollars: number | null;
  expectancyR: number | null;
  rTradeCount: number;
}

function Stat({
  label,
  value,
  sub,
  tone = '',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="flex-1 rounded-xl border border-border bg-surface-1 p-2.5 text-center">
      <div className="text-[10px] tracking-wide text-muted uppercase">
        {label}
      </div>
      <div className={`mt-0.5 text-lg font-semibold ${tone}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted">{sub}</div>}
    </div>
  );
}

export function StatsHeader() {
  const { data } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api<Stats>('/portfolio/stats'),
  });

  if (!data) return null;

  if (data.closedCount === 0) {
    return (
      <p className="rounded-xl border border-border bg-surface-1 p-3 text-xs text-muted">
        Win rate, risk and expectancy appear once you close your first trade.
        {data.openCount > 0 && ` ${data.openCount} open.`}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Stat
          label="Win rate"
          value={`${Math.round((data.winRate ?? 0) * 100)}%`}
          sub={`${data.closedCount} closed`}
        />
        <Stat
          label="Avg risk"
          value={
            data.avgRisk === null
              ? '—'
              : `$${Math.round(data.avgRisk).toLocaleString('en-US')}`
          }
          sub={
            data.riskTradeCount > 0
              ? `${data.riskTradeCount} with a stop`
              : 'set stops to unlock'
          }
        />
        <Stat
          label="Expectancy"
          value={
            data.expectancyR !== null
              ? `${data.expectancyR > 0 ? '+' : ''}${data.expectancyR.toFixed(2)}R`
              : '—'
          }
          sub={
            // Never let a headline number hide how small its sample is.
            data.rTradeCount > 0
              ? `${data.rTradeCount} of ${data.closedCount} with a stop`
              : 'set stops to unlock'
          }
          tone={signClass(data.expectancyR)}
        />
      </div>
      {data.expectancyDollars !== null && (
        <p className="text-center text-[10px] text-muted">
          <Money value={data.expectancyDollars} signed /> average per closed
          trade
        </p>
      )}
    </div>
  );
}
