import { Fragment, type ReactNode } from 'react';
import type { BriefEvent, BriefMood } from '../../api/dailyBrief';
import { SessionBadge } from '../SessionBadge';
import { formatPercent, signClass } from '../format';

function Change({ value }: { value: number | null }) {
  if (value === null) return null;
  return <span className={`tabular-nums ${signClass(value)}`}>{formatPercent(value)}</span>;
}

function Stale() {
  return <span className="text-[10px] font-medium tracking-wide text-down">STALE</span>;
}

/**
 * The market's mood in one line, before any single name. Every word and
 * figure is the server's; this only lays them out.
 */
export function MoodLine({ mood, events }: { mood: BriefMood; events: BriefEvent[] }) {
  const parts: { key: string; node: ReactNode }[] = [];
  for (const index of mood.indices) {
    parts.push({
      key: index.symbol,
      node: <>{index.symbol}{index.trend && ` ${index.trend}`} <Change value={index.changePct} />{index.extended && <> <SessionBadge session={index.session} extended /></>}{index.stale && <> <Stale /></>}</>,
    });
  }
  if (mood.vix) {
    const { level, change, stale } = mood.vix;
    parts.push({
      key: 'vix',
      node: <>VIX <span className="tabular-nums">{level.toFixed(2)}{change !== null && ` (${change >= 0 ? '+' : '-'}${Math.abs(change).toFixed(2)})`}</span>{stale && <> <Stale /></>}</>,
    });
  }
  if (mood.leader) parts.push({ key: 'leader', node: <>Leading {mood.leader.name} <Change value={mood.leader.changePct} /></> });
  if (mood.laggard) parts.push({ key: 'laggard', node: <>Lagging {mood.laggard.name} <Change value={mood.laggard.changePct} /></> });

  return (
    <section aria-label="Market" className="space-y-2 rounded-xl border border-border bg-surface-1 p-3">
      {parts.length === 0 ? (
        <p className="text-sm text-muted">Market mood unavailable right now.</p>
      ) : (
        <p className="flex flex-wrap gap-x-2 gap-y-1 text-sm">
          {parts.map((part, i) => (
            <Fragment key={part.key}>
              {i > 0 && <span aria-hidden="true" className="text-muted">·</span>}
              <span>{part.node}</span>
            </Fragment>
          ))}
        </p>
      )}
      {events.length > 0 && (
        <ul className="space-y-1 text-xs text-muted">
          {events.map((event) => (
            <li key={`${event.eventAt}-${event.title}`}>
              <span className="font-medium text-text">{event.title}</span> — {event.detail}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
