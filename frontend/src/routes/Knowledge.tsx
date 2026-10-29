import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useKnowledgeList } from '../api/knowledge';
import { etDate } from '../lib/dates';

export function Knowledge() {
  const { data, isLoading, isError } = useKnowledgeList();
  const [query, setQuery] = useState('');

  const rows = (data ?? []).filter((r) => r.symbol.includes(query));

  return (
    <section className="space-y-4">
      <h1 className="text-lg font-semibold">Knowledge</h1>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value.toUpperCase())}
        placeholder="Search tickers"
        aria-label="Search tickers"
        autoCapitalize="characters"
        className="w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm"
      />
      {isLoading && (
        <div data-testid="know-skeleton" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-1" />
          ))}
        </div>
      )}
      {isError && <p className="text-sm text-down">Couldn’t load knowledge right now.</p>}
      {data && data.length === 0 && (
        <p className="text-sm text-muted">
          No knowledge yet — ask Claude to start one, e.g. "start NVIDIA".
        </p>
      )}
      {data && data.length > 0 && rows.length === 0 && (
        <p className="text-sm text-muted">No tickers match.</p>
      )}
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.symbol}>
            <Link
              to={`/knowledge/${encodeURIComponent(r.symbol)}`}
              data-testid={`know-row-${r.symbol}`}
              className="flex items-center gap-3 py-3"
            >
              <span className="w-20 font-medium">{r.symbol}</span>
              {r.hasNew && <span role="img" aria-label="new" className="h-2 w-2 rounded-full bg-accent" />}
              <span className="ml-auto text-sm text-muted">
                {r.nodeCount} {r.nodeCount === 1 ? 'node' : 'nodes'}
              </span>
              <span className="text-sm text-muted">updated {etDate(r.updatedAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
