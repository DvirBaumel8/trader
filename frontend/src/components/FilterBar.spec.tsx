// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterBar } from './FilterBar';
import { emptyFilters } from '../lib/entryFilters';

afterEach(cleanup);

const baseProps = {
  filters: emptyFilters,
  onFiltersChange: () => {},
  sort: 'NEWEST' as const,
  onSortChange: () => {},
  resultCount: 0,
  totalCount: 0,
};

describe('FilterBar', () => {
  it('offers a custom date range by default', async () => {
    const user = userEvent.setup();
    render(<FilterBar {...baseProps} />);
    await user.click(screen.getByRole('button', { name: /filter/i }));
    expect(screen.getByText('From')).toBeInTheDocument();
    expect(screen.getByText('To')).toBeInTheDocument();
  });

  /**
   * The Trades tab replaces this with its own period picker (see
   * RangeSelector) — two controls answering the same question on one screen
   * would be confusing, so this one steps aside rather than sitting unused
   * alongside it.
   */
  it('hides the custom date range when showDateFilter is false, keeping search', async () => {
    const user = userEvent.setup();
    render(<FilterBar {...baseProps} showDateFilter={false} />);
    await user.click(screen.getByRole('button', { name: /filter/i }));
    expect(screen.queryByText('From')).not.toBeInTheDocument();
    expect(screen.queryByText('To')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ticker, or NVDA, META')).toBeInTheDocument();
  });

  it('reports a typed search term', async () => {
    const onFiltersChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterBar {...baseProps} onFiltersChange={onFiltersChange} />);
    await user.click(screen.getByRole('button', { name: /filter/i }));
    await user.type(screen.getByPlaceholderText('Ticker, or NVDA, META'), 'N');
    expect(onFiltersChange).toHaveBeenCalledWith({ ...emptyFilters, search: 'N' });
  });
});
