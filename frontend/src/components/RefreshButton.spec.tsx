// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RefreshButton } from './RefreshButton';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, api: vi.fn() };
});
import { api } from '../api/client';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function renderButton(props: Parameters<typeof RefreshButton>[0] = {}) {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <RefreshButton {...props} />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe('RefreshButton', () => {
  it('defaults to forcing the portfolio query past its cache', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({ cash: 42 });
    const user = userEvent.setup();
    const queryClient = renderButton();

    await user.click(screen.getByRole('button', { name: 'Refresh prices now' }));

    await waitFor(() =>
      expect(queryClient.getQueryData(['portfolio'])).toEqual({ cash: 42 }),
    );
    expect(api).toHaveBeenCalledWith('/portfolio?refresh=1');
  });

  it('calls a caller-supplied refresh instead of the default, when given one', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderButton({ onRefresh });

    await user.click(screen.getByRole('button', { name: 'Refresh prices now' }));

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(api).not.toHaveBeenCalled();
  });

  it('spins and disables itself while a refresh is in flight, then stops', async () => {
    let resolve!: () => void;
    const onRefresh = vi.fn(
      () => new Promise<void>((r) => (resolve = r)),
    );
    const user = userEvent.setup();
    renderButton({ onRefresh });

    const button = screen.getByRole('button', { name: 'Refresh prices now' });
    await user.click(button);

    expect(button).toBeDisabled();
    expect(button.querySelector('span')).toHaveClass('animate-spin');

    resolve();
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(button.querySelector('span')).not.toHaveClass('animate-spin');
  });

  it('stops spinning even when the refresh fails, leaving the button usable again', async () => {
    const onRefresh = vi.fn().mockRejectedValue(new Error('network down'));
    const user = userEvent.setup();
    renderButton({ onRefresh });

    const button = screen.getByRole('button', { name: 'Refresh prices now' });
    await user.click(button);

    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('accepts a custom label, for a page that wants its own wording', async () => {
    renderButton({ label: 'Refresh brief' });
    expect(screen.getByRole('button', { name: 'Refresh brief' })).toBeInTheDocument();
  });
});
