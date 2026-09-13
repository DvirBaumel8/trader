// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RangeSelector } from './RangeSelector';

afterEach(cleanup);

describe('RangeSelector', () => {
  it('renders every preset, marking the active one', () => {
    render(<RangeSelector range="1M" onRangeChange={() => {}} />);
    expect(screen.getByRole('button', { name: '1M' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '1W' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
  });

  it('reports the tapped range', async () => {
    const onRangeChange = vi.fn();
    const user = userEvent.setup();
    render(<RangeSelector range="ALL" onRangeChange={onRangeChange} />);
    await user.click(screen.getByRole('button', { name: 'YTD' }));
    expect(onRangeChange).toHaveBeenCalledWith('YTD');
  });
});
