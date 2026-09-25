import { Fragment, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router-dom';

export interface TableSort {
  key: string;
  dir: 'asc' | 'desc';
}

export interface Column<Row> {
  id: string;
  header: string;
  align: 'left' | 'right';
  primary: (row: Row) => ReactNode;
  secondary?: (row: Row) => ReactNode;
  /** When set, the header is a sort button for this key. */
  sortKey?: string;
  /** Direction of the first tap. Default 'desc'; 'asc' suits text like a symbol. */
  firstDir?: 'asc' | 'desc';
}

const HEADER = 'text-[10px] font-medium tracking-wide text-muted uppercase';
// Rows use `display: contents`, so the row has no box of its own; hover,
// tap and focus feedback go on every cell through `group`.
const CELL =
  'py-2.5 transition-colors group-hover:bg-surface-1 group-active:bg-surface-2 group-data-[focused=true]:bg-accent/10';

const encode = (s: TableSort) => `${s.key}:${s.dir}`;

/**
 * The app's one table. Header, rows and totals are items of ONE grid, not
 * one grid each: separate grids size their `auto` columns from their own
 * content, so columns drift from row to row (see the note in Stocks.tsx
 * that first hit this). Display only: cells render whatever the screen's
 * columns return, and sorting itself stays with the screen.
 */
export function DataTable<Row>({
  title,
  columns,
  rows,
  rowKey,
  rowHref,
  rowTestId,
  sort,
  onSortChange,
  moreSorts,
  totals,
  focusedKey,
  focusedRef,
  renderBelowRow,
  empty,
}: {
  title?: ReactNode;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  rowHref?: (row: Row) => string | null;
  rowTestId?: (row: Row) => string;
  sort?: TableSort;
  onSortChange?: (s: TableSort) => void;
  moreSorts?: (TableSort & { label: string })[];
  totals?: ReactNode[];
  focusedKey?: string | null;
  focusedRef?: Ref<HTMLSpanElement>;
  renderBelowRow?: (row: Row) => ReactNode;
  empty?: ReactNode;
}) {
  const template = columns
    .map((_, i) => (i === 0 ? 'minmax(0,1fr)' : 'auto'))
    .join(' ');
  const alignClass = (c: Column<Row>) => (c.align === 'right' ? 'text-right' : 'text-left');

  function tapHeader(c: Column<Row>) {
    if (!c.sortKey || !onSortChange) return;
    const active = sort?.key === c.sortKey;
    const dir = active
      ? sort!.dir === 'asc'
        ? 'desc'
        : 'asc'
      : (c.firstDir ?? 'desc');
    onSortChange({ key: c.sortKey, dir });
  }

  return (
    <section>
      {(title || (moreSorts && moreSorts.length > 0)) && (
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">{title}</div>
          {moreSorts && moreSorts.length > 0 && (
            // A native select under a ⋯ glyph: iOS shows its picker wheel,
            // and the header row stays one line.
            <label className="relative flex h-7 w-8 shrink-0 items-center justify-center rounded-md text-muted active:bg-surface-2">
              <span aria-hidden="true" className="text-base leading-none">
                ⋯
              </span>
              <select
                aria-label="More sorts"
                value={
                  sort && moreSorts.some((m) => encode(m) === encode(sort)) ? encode(sort) : ''
                }
                onChange={(e) => {
                  const found = moreSorts.find((m) => encode(m) === e.target.value);
                  if (found && onSortChange) onSortChange({ key: found.key, dir: found.dir });
                }}
                className="absolute inset-0 appearance-none opacity-0"
              >
                <option value="" disabled>
                  Sort by…
                </option>
                {moreSorts.map((m) => (
                  <option key={encode(m)} value={encode(m)}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {rows.length === 0 && empty ? (
        empty
      ) : (
        <div className="grid items-center gap-x-3" style={{ gridTemplateColumns: template }}>
          {columns.map((c) => {
            const active = c.sortKey !== undefined && sort?.key === c.sortKey;
            const arrow = active ? (sort!.dir === 'asc' ? ' ▲' : ' ▼') : '';
            const cls = `sticky top-0 z-10 border-b border-border bg-surface-0 py-1.5 whitespace-nowrap ${HEADER} ${alignClass(c)}`;
            return c.sortKey && onSortChange ? (
              <button
                key={c.id}
                type="button"
                onClick={() => tapHeader(c)}
                className={`${cls} ${active ? 'text-text' : ''}`}
              >
                {c.header}
                {arrow}
              </button>
            ) : (
              <span key={c.id} className={cls}>
                {c.header}
              </span>
            );
          })}

          {rows.map((row, i) => {
            const key = rowKey(row);
            const href = rowHref?.(row) ?? null;
            const focused = focusedKey != null && focusedKey === key;
            const cells = columns.map((c, ci) => (
              <span
                key={c.id}
                ref={ci === 0 && focused ? focusedRef : undefined}
                className={`min-w-0 tabular-nums ${alignClass(c)} ${CELL}`}
              >
                <span className="block truncate text-[15px] leading-5 font-medium">
                  {c.primary(row)}
                </span>
                {c.secondary && (
                  <span className="block truncate text-[12px] leading-4 text-muted">
                    {c.secondary(row)}
                  </span>
                )}
              </span>
            ));
            const rowProps = {
              className: 'group contents',
              'data-testid': rowTestId?.(row),
              'data-focused': focused ? 'true' : undefined,
            };
            return (
              <Fragment key={key}>
                {href !== null ? (
                  <Link to={href} {...rowProps}>
                    {cells}
                  </Link>
                ) : (
                  <div {...rowProps}>{cells}</div>
                )}
                {renderBelowRow && <div className="col-span-full">{renderBelowRow(row)}</div>}
                {i < rows.length - 1 && <div className="col-span-full border-b border-border/60" />}
              </Fragment>
            );
          })}

          {totals && (
            <div data-testid="table-totals" className="contents">
              <div className="col-span-full border-b border-border" />
              {totals.map((t, ci) => (
                <span
                  key={ci}
                  className={`py-2.5 text-[13px] font-semibold tabular-nums ${alignClass(columns[ci])}`}
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
