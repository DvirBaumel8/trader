import { inputClasses } from './ui/inputClasses';
import { Select } from './ui/Select';
import { useState } from 'react';
import {
  emptyFilters,
  hasActiveFilters,
  type Filters,
} from '../lib/entryFilters';

const SORTS = [
  { value: 'NEWEST', label: 'Newest first' },
  { value: 'OLDEST', label: 'Oldest first' },
  { value: 'LARGEST', label: 'Largest first' },
  { value: 'SMALLEST', label: 'Smallest first' },
] as const;

export type SortValue = (typeof SORTS)[number]['value'];

const controlClass =
  inputClasses('sm');

/**
 * Collapsed by default. Filters are occasional, and a permanent three-row
 * control block would push the actual list below the fold on a phone.
 */
export function FilterBar({
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  sortLabels,
  resultCount,
  totalCount,
  showDateFilter = true,
}: {
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  sort: SortValue;
  onSortChange: (s: SortValue) => void;
  /** Overrides for the two money sorts, which mean different things per tab. */
  sortLabels?: Partial<Record<SortValue, string>>;
  resultCount: number;
  totalCount: number;
  /**
   * Off on the Trades tab, which has its own period picker (RangeSelector)
   * doing the same job — two date controls on one screen answering the same
   * question would be confusing, not just redundant.
   */
  showDateFilter?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = hasActiveFilters(filters);
  const set = (patch: Partial<Filters>) =>
    onFiltersChange({ ...filters, ...patch });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
            active
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-border text-muted'
          }`}
        >
          Filter{active ? ' ·' : ''}
        </button>

        <Select
          value={sort}
          onChange={onSortChange}
          options={SORTS.map((s) => ({
            value: s.value,
            label: sortLabels?.[s.value] ?? s.label,
          }))}
          srLabel="Sort"
        />

        {active && (
          <span className="shrink-0 text-[11px] text-muted">
            {resultCount} of {totalCount}
          </span>
        )}
      </div>

      {open && (
        <div className="space-y-2 rounded-xl border border-border bg-surface-1/50 p-3">
          <input
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="Ticker, or NVDA, META"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={controlClass}
          />
          {showDateFilter && (
            <div className="grid grid-cols-2 gap-2">
              <label className="min-w-0 space-y-1">
                <span className="block text-[10px] text-muted">From</span>
                <input
                  type="date"
                  value={filters.from}
                  onChange={(e) => set({ from: e.target.value })}
                  className={controlClass}
                />
              </label>
              <label className="min-w-0 space-y-1">
                <span className="block text-[10px] text-muted">To</span>
                <input
                  type="date"
                  value={filters.to}
                  onChange={(e) => set({ to: e.target.value })}
                  className={controlClass}
                />
              </label>
            </div>
          )}
          {active && (
            <button
              type="button"
              onClick={() => onFiltersChange(emptyFilters)}
              className="text-xs text-accent"
            >
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
