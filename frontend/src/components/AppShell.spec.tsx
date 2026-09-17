// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';

vi.mock('../api/client', () => ({
  api: vi.fn(() => Promise.resolve({ status: 'ok', database: 'ok', userId: 'test' })),
}));

afterEach(cleanup);

it('offers Brief in top navigation without competing Ideas navigation', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/brief']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="brief" element={<p>Brief content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(screen.getByRole('link', { name: 'Brief' })).toHaveAttribute('href', '/brief');
  expect(screen.queryByRole('link', { name: 'Ideas' })).not.toBeInTheDocument();
  expect(screen.getByText('Brief content')).toBeInTheDocument();
});
