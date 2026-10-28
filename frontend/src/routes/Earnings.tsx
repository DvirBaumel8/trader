import { useEarningsWeek } from '../api/earnings';
import type { EarningsEntry, EarningsSource, EarningsTiming } from '../api/earnings';
import { usePersistentState } from '../lib/persistentState';

type Filter = 'both' | 'holdings' | 'watchlist';
type Sort = 'soonest' | 'az';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Display only: split the string so no timezone can shift the day. */
function parts(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y, m, d };
}
const monthDay = (ymd: string) => {
  const { m, d } = parts(ymd);
  return `${MONTHS[m - 1]} ${d}`;
};
const weekdayDay = (ymd: string) => {
  const { y, m, d } = parts(ymd);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}`;
};

const TIMING_ICON: Record<EarningsTiming, string> = {
  before_open: '☀',
  after_close: '🌙',
  during: '•',
  unknown: '',
};

const matches = (filter: Filter, source: EarningsSource) =>
  filter === 'both' || (filter === 'holdings' ? source === 'holding' : source === 'watchlist');

const sourceMark = (s: EarningsSource) => (s === 'holding' ? '●' : '○');

function daysLabel(n: number): string {
  if (n === 0) return 'today';
  if (n === 1) return '1 day';
  return `${n} days`;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-lg border border-border text-sm">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 ${value === o.value ? 'bg-accent/15 font-medium text-accent' : 'text-muted'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Cell({ entry }: { entry: EarningsEntry }) {
  return (
    <div
      data-testid={`earn-${entry.symbol}`}
      className="min-w-0 rounded border border-border bg-surface-1 px-1 py-1 text-center"
    >
      <div className="truncate text-xs font-medium">
        {entry.estimated ? '~' : ''}
        {entry.symbol}
      </div>
      <div className="truncate text-[11px] text-muted">
        {TIMING_ICON[entry.timing]}
        {sourceMark(entry.source)}
      </div>
    </div>
  );
}

const EMPTY: Record<Filter, string> = {
  both: 'No earnings this week for your holdings or watchlist.',
  holdings: 'No earnings this week for your holdings.',
  watchlist: 'No earnings this week for your watchlist.',
};

export function Earnings() {
  const { data, isLoading, isError } = useEarningsWeek();
  const [filter, setFilter] = usePersistentState<Filter>('trader.earnings.filter.v1', 'both', Infinity);
  const [sort, setSort] = usePersistentState<Sort>('trader.earnings.sort.v1', 'soonest', Infinity);

  const title = data ? `Earnings · ${monthDay(data.weekStart)} – ${monthDay(data.weekEnd)}` : 'Earnings';

  const anyInWeek = data?.days.some((d) => d.entries.some((e) => matches(filter, e.source))) ?? false;
  const upcoming = (data?.upcoming ?? []).filter((u) => matches(filter, u.source));
  const rows = sort === 'az' ? [...upcoming].sort((a, b) => a.symbol.localeCompare(b.symbol)) : upcoming;

  return (
    <section className="space-y-4">
      <h1 className="text-lg font-semibold">{title}</h1>

      <Segmented
        label="Filter"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'both', label: 'Both' },
          { value: 'holdings', label: 'Holdings' },
          { value: 'watchlist', label: 'Watchlist' },
        ]}
      />

      {isLoading && (
        <div data-testid="earnings-skeleton" className="grid animate-pulse grid-cols-5 gap-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded bg-surface-1" />
          ))}
        </div>
      )}
      {isError && <p className="text-sm text-down">Couldn’t load earnings dates right now.</p>}

      {data && (
        <>
          <div className="grid grid-cols-5 gap-1">
            {data.days.map((day) => (
              <div
                key={day.date}
                className={`min-w-0 space-y-1 rounded-lg border p-1 ${
                  day.date === data.today ? 'border-accent' : 'border-transparent'
                }`}
              >
                <div className="truncate text-center text-[11px] text-muted">{weekdayDay(day.date)}</div>
                {day.entries
                  .filter((e) => matches(filter, e.source))
                  .map((e, i) => (
                    <Cell key={`${e.symbol}-${i}`} entry={e} />
                  ))}
              </div>
            ))}
          </div>
          {!anyInWeek && <p className="text-sm text-muted">{EMPTY[filter]}</p>}
          <p className="text-xs text-muted">☀ before open · 🌙 after close · ● holding · ○ watchlist · ~ estimated date</p>

          <div className="flex items-center justify-between pt-2">
            <h2 className="text-base font-semibold">Next earnings</h2>
            <Segmented
              label="Sort"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'soonest', label: 'Soonest' },
                { value: 'az', label: 'A–Z' },
              ]}
            />
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-muted">Nothing to show yet — add holdings or watch some tickers.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {rows.map((u) => (
                <li
                  key={u.symbol}
                  data-testid={`next-${u.symbol}`}
                  className="flex items-center gap-3 px-3 py-2.5 text-sm"
                >
                  <span className="w-20 shrink-0 truncate font-medium">{u.symbol}</span>
                  <span className="shrink-0 text-muted">{sourceMark(u.source)}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">
                    {u.date ? `${u.estimated ? '~' : ''}${monthDay(u.date)}` : '—'}
                  </span>
                  <span className="shrink-0">{u.daysUntil === null ? '—' : daysLabel(u.daysUntil)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
