import { Link } from 'react-router-dom';
import type { BriefMover } from '../../api/dailyBrief';
import { SessionBadge } from '../SessionBadge';
import { formatMoney, formatPercent, formatTimestamp, signClass } from '../format';

/**
 * The holdings that moved most today, with the day's news under each. Every
 * figure, label and headline is the server's; this only lays them out.
 * Renders nothing when nothing moved enough.
 */
export function MoverList({ movers }: { movers: BriefMover[] }) {
  if (movers.length === 0) return null;
  return (
    <section aria-label="Movers" className="space-y-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Movers</h2>
      {movers.map((mover) => (
        <div key={mover.symbol} className="space-y-1.5 rounded-xl border border-border bg-surface-1 p-3">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <Link to={`/?symbol=${encodeURIComponent(mover.symbol)}`} className="font-medium">{mover.symbol}</Link>
            <span className={`tabular-nums ${signClass(mover.changePct)}`}>{formatPercent(mover.changePct)}</span>
            <span className="text-xs tabular-nums text-muted">{mover.atrMultiple.toFixed(1)}× ATR</span>
            {mover.dollarChange !== null && (
              <span className={`tabular-nums ${signClass(mover.dollarChange)}`}>{formatMoney(mover.dollarChange, { signed: true })}</span>
            )}
            {mover.extended && <SessionBadge session={mover.session} extended />}
            {mover.stale && <span className="text-[10px] font-medium tracking-wide text-down">STALE</span>}
          </p>
          {mover.reasons.length > 0 && (
            <ul className="flex flex-wrap gap-1">
              {mover.reasons.map((reason) => (
                <li key={reason.code} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{reason.label}</li>
              ))}
            </ul>
          )}
          {mover.headline ? (
            <p className="text-xs leading-relaxed">
              <a href={mover.headline.url} target="_blank" rel="noopener noreferrer" className="text-accent">{mover.headline.title}</a>
              <span className="text-muted"> {mover.headline.source} · {formatTimestamp(mover.headline.at)}</span>
            </p>
          ) : (
            <p className="text-xs text-muted">No news found</p>
          )}
          {mover.thesis && <p className="text-xs leading-relaxed text-muted">{mover.thesis}</p>}
        </div>
      ))}
    </section>
  );
}
