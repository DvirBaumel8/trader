export interface Filters {
  /** Matches a ticker or anything in the note text. */
  search: string;
  /** Inclusive, as YYYY-MM-DD. Empty means unbounded. */
  from: string;
  to: string;
}

export const emptyFilters: Filters = { search: '', from: '', to: '' };

export function hasActiveFilters(f: Filters): boolean {
  return f.search.trim() !== '' || f.from !== '' || f.to !== '';
}

/**
 * The LOCAL calendar day, matching what the list displays and what the date
 * pickers produce. Slicing the ISO string would give the UTC day instead, so a
 * trade logged after midnight would filter into the previous day while still
 * being shown under today.
 */
function dayOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function withinRange(iso: string, from: string, to: string): boolean {
  const day = dayOf(iso);
  if (from && day < from) return false;
  // `to` is inclusive: filtering to the 29th includes everything that day.
  if (to && day > to) return false;
  return true;
}

export interface FilterableEntry {
  occurredAt: string;
  body: string;
  trade: { symbol: string } | null;
  dividend: { symbol: string } | null;
}

export type EntrySort = 'NEWEST' | 'OLDEST' | 'LARGEST' | 'SMALLEST';

export interface SortableEntry extends FilterableEntry {
  trade: { symbol: string; quantity: number; price: number } | null;
  cash: { amount: number } | null;
  dividend: { symbol: string; amount: number } | null;
}

/** What an entry moved, in dollars — the figure the money sorts use. */
export function entryValue(e: SortableEntry): number {
  if (e.trade) return Math.abs(e.trade.quantity * e.trade.price);
  if (e.cash) return Math.abs(e.cash.amount);
  if (e.dividend) return Math.abs(e.dividend.amount);
  return 0;
}

export function sortEntries<T extends SortableEntry>(
  entries: T[],
  sort: EntrySort,
): T[] {
  const copy = [...entries];
  switch (sort) {
    case 'NEWEST':
      return copy.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    case 'OLDEST':
      return copy.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    case 'LARGEST':
      return copy.sort((a, b) => entryValue(b) - entryValue(a));
    case 'SMALLEST':
      return copy.sort((a, b) => entryValue(a) - entryValue(b));
  }
}

export interface FilterableTrade {
  symbol: string;
  enteredAt: string;
  exitedAt: string | null;
  realizedPnl: number | null;
  avgEntry: number;
  quantity: number;
}

/**
 * Search terms, split on commas.
 *
 * A comma means "any of these": `NVDA, META` is two tickers, not a phrase.
 * Splitting on whitespace instead would break the moment a search is
 * ordinary text, so the comma is the signal — it is what someone writing a
 * list of tickers reaches for anyway, and a single term still behaves
 * exactly as it always did.
 */
export function searchTerms(search: string): string[] {
  return search
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t !== '');
}

export function filterTrades<T extends FilterableTrade>(
  trades: T[],
  f: Filters,
): T[] {
  const terms = searchTerms(f.search);
  return trades.filter((t) => {
    // A closed trade is filtered on when it closed — that is the date a reader
    // means by "trades in August".
    if (!withinRange(t.exitedAt ?? t.enteredAt, f.from, f.to)) return false;
    if (terms.length === 0) return true;
    const symbol = t.symbol.toLowerCase();
    return terms.some((term) => symbol.includes(term));
  });
}

export type TradeSort = 'NEWEST' | 'OLDEST' | 'LARGEST' | 'SMALLEST';

export function sortTrades<T extends FilterableTrade>(
  trades: T[],
  sort: TradeSort,
): T[] {
  const copy = [...trades];
  const when = (t: T) => t.exitedAt ?? t.enteredAt;
  // Sorted by money, a trade means its result — biggest winner to biggest loser.
  const pnl = (t: T) => t.realizedPnl ?? 0;
  switch (sort) {
    case 'NEWEST':
      return copy.sort((a, b) => when(b).localeCompare(when(a)));
    case 'OLDEST':
      return copy.sort((a, b) => when(a).localeCompare(when(b)));
    case 'LARGEST':
      return copy.sort((a, b) => pnl(b) - pnl(a));
    case 'SMALLEST':
      return copy.sort((a, b) => pnl(a) - pnl(b));
  }
}

/**
 * Filters as query-string parameters for `GET /journal`.
 *
 * Selecting which entries match is the server's job — this only says what was
 * asked for. Empty fields are omitted rather than sent blank, so the query key
 * for an unfiltered list is stable and cache-shared with other callers.
 */
export function journalQuery(f: Filters): string {
  const params = new URLSearchParams({ kind: 'TRADE' });
  const search = f.search.trim();
  if (search) params.set('search', search);
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  return params.toString();
}
