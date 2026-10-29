import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useKnowledgeGraph, useMarkViewed } from '../api/knowledge';
import { GraphCanvas } from '../components/knowledge/GraphCanvas';
import { etDate } from '../lib/dates';

function Screen({ symbol }: { symbol: string }) {
  const { data, isLoading, isError } = useKnowledgeGraph(symbol);
  const markViewed = useMarkViewed();
  // The lastViewedAt of the FIRST response: highlights keep using it even
  // after this visit marks the graph viewed and later refetches change it.
  const [captured, setCaptured] = useState<{ at: string | null } | null>(null);
  const marked = useRef(false);

  useEffect(() => {
    if (!data || marked.current) return;
    marked.current = true;
    setCaptured({ at: data.lastViewedAt });
    markViewed(symbol);
  }, [data, markViewed, symbol]);

  const lastViewedAt = captured ? captured.at : (data?.lastViewedAt ?? null);
  const newIds = useMemo(() => {
    const ids = new Set<string>();
    for (const n of data?.nodes ?? []) {
      if (lastViewedAt === null || new Date(n.updatedAt) > new Date(lastViewedAt)) ids.add(n.id);
    }
    return ids;
  }, [data?.nodes, lastViewedAt]);

  return (
    <section className="space-y-3">
      <div>
        <Link to="/knowledge" className="text-sm text-muted">
          ‹ Knowledge
        </Link>
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold">{symbol}</h1>
          {data && (
            <span className="text-sm text-muted">
              Updated {etDate(data.updatedAt)} · v{data.version}
            </span>
          )}
        </div>
      </div>
      {isLoading && <div data-testid="kg-skeleton" className="h-64 animate-pulse rounded-lg bg-surface-1" />}
      {isError && <p className="text-sm text-down">Couldn’t load this graph right now.</p>}
      {data === null && (
        <p className="text-sm text-muted">No knowledge on {symbol} yet — ask Claude to start it.</p>
      )}
      {data && <GraphCanvas nodes={data.nodes} edges={data.edges} newIds={newIds} />}
    </section>
  );
}

export function KnowledgeGraph() {
  const symbol = (useParams().symbol ?? '').toUpperCase();
  return <Screen key={symbol} symbol={symbol} />;
}
