import { Link } from 'react-router-dom';

/** A ticker that opens its knowledge graph, with a small dot when one exists. */
export function TickerLink({
  symbol,
  hasGraph,
  className = '',
  prefix = '',
}: {
  symbol: string;
  hasGraph: boolean;
  className?: string;
  /** Shown inside the link before the symbol, e.g. "~" for an estimated date. */
  prefix?: string;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Link to={`/knowledge/${encodeURIComponent(symbol)}`} className={`inline-flex min-h-8 min-w-0 items-center ${className}`.trim()}>
        <span className="block truncate">
          {prefix}
          {symbol}
        </span>
      </Link>
      {hasGraph && <span role="img" aria-label="has knowledge" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
    </span>
  );
}
