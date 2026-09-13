import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Money } from './Money';
import { Stat } from './ui/Stat';

interface Stats {
  closedCount: number;
  openCount: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  expectancyDollars: number | null;
  expectancyR: number | null;
  rTradeCount: number;
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
        Win rate and expectancy appear once you close your first trade.
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
