// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DataTable, type Column } from './DataTable';

afterEach(cleanup);

interface R { sym: string; px: number; href: string | null }
const rows: R[] = [
  { sym: 'AAPL', px: 1, href: '/a' },
  { sym: 'TSLA', px: 2, href: null },
];
const columns: Column<R>[] = [
  { id: 's', header: 'Symbol', align: 'left', primary: (r) => r.sym, secondary: () => 'sub', sortKey: 'symbol', firstDir: 'asc' },
  { id: 'p', header: 'Last', align: 'right', primary: (r) => `px${r.px}`, sortKey: 'px' },
];

function renderTable(props: Partial<Parameters<typeof DataTable<R>>[0]> = {}) {
  return render(
    <MemoryRouter>
      <DataTable<R>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.sym}
        rowHref={(r) => r.href}
        rowTestId={(r) => `row-${r.sym}`}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('DataTable', () => {
  /** The whole point: a field name appears once, not once per row. */
  it('renders each header exactly once for many rows', () => {
    renderTable();
    expect(screen.getAllByText('Last')).toHaveLength(1);
    expect(screen.getByTestId('row-AAPL')).toHaveTextContent('AAPLsub');
    expect(screen.getByTestId('row-TSLA')).not.toHaveTextContent('Last');
  });

  it('links a row with an href, and leaves a row without one inert', () => {
    renderTable();
    expect(screen.getByTestId('row-AAPL').tagName).toBe('A');
    expect(screen.getByTestId('row-AAPL')).toHaveAttribute('href', '/a');
    expect(screen.getByTestId('row-TSLA').tagName).toBe('DIV');
  });

  it("sorts on a header tap using the column's first direction, then flips", async () => {
    const onSortChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderTable({ onSortChange });

    await user.click(screen.getByRole('button', { name: /Last/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'px', dir: 'desc' });

    await user.click(screen.getByRole('button', { name: /Symbol/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'symbol', dir: 'asc' });

    rerender(
      <MemoryRouter>
        <DataTable<R> columns={columns} rows={rows} rowKey={(r) => r.sym} sort={{ key: 'px', dir: 'desc' }} onSortChange={onSortChange} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /Last/ })).toHaveTextContent('▼');
    await user.click(screen.getByRole('button', { name: /Last/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'px', dir: 'asc' });
  });

  it('offers sorts no header shows through the ⋯ menu', async () => {
    const onSortChange = vi.fn();
    const user = userEvent.setup();
    renderTable({
      onSortChange,
      moreSorts: [{ key: 'earn', dir: 'asc', label: 'Earnings — soonest' }],
    });
    await user.selectOptions(screen.getByRole('combobox', { name: 'More sorts' }), 'earn:asc');
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'earn', dir: 'asc' });
  });

  /** A sort no column shows would otherwise leave the row order unexplained. */
  it('names the active ⋯ sort when no header shows it', () => {
    const moreSorts = [{ key: 'earn', dir: 'asc' as const, label: 'Earnings — soonest' }];
    renderTable({ onSortChange: vi.fn(), moreSorts, sort: { key: 'earn', dir: 'asc' } });
    expect(screen.getByTestId('active-more-sort')).toHaveTextContent('Earnings — soonest');
  });

  it('does not name a ⋯ sort that a header already marks', () => {
    const moreSorts = [{ key: 'px', dir: 'desc' as const, label: 'Last — high first' }];
    renderTable({ onSortChange: vi.fn(), moreSorts, sort: { key: 'px', dir: 'desc' } });
    expect(screen.queryByTestId('active-more-sort')).not.toBeInTheDocument();
  });

  it('renders a totals row in the same columns', () => {
    renderTable({ totals: ['Total', 'px3'] });
    const totals = screen.getByTestId('table-totals');
    expect(within(totals).getByText('Total')).toBeInTheDocument();
    expect(within(totals).getByText('px3')).toBeInTheDocument();
  });

  it('marks the focused row and renders content below a row', () => {
    renderTable({ focusedKey: 'TSLA', renderBelowRow: (r) => <p>editor {r.sym}</p> });
    expect(screen.getByTestId('row-TSLA')).toHaveAttribute('data-focused', 'true');
    expect(screen.getByTestId('row-AAPL')).not.toHaveAttribute('data-focused');
    expect(screen.getByText('editor AAPL')).toBeInTheDocument();
  });

  it('shows the empty state instead of rows', () => {
    renderTable({ rows: [], empty: <p>Nothing here</p> });
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });
});
