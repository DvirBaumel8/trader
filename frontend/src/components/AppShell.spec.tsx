// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';

vi.mock('../api/client', () => ({
  api: vi.fn(() => Promise.resolve({ status: 'ok' })),
}));

afterEach(cleanup);

it('offers exactly Chat, Holdings and Watch', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<p>chat content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByText('chat content')).toBeInTheDocument();
  const links = screen.getAllByRole('link').map((a) => a.textContent);
  expect(links).toEqual(['Chat', 'Holdings', 'Watch']);
});
