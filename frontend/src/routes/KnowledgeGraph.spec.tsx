// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react');
  return {
    ...actual,
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReactFlow: () => ({ fitView: vi.fn(), setCenter: vi.fn(), getZoom: () => 1 }),
    Background: () => null,
    ReactFlow: ({
      nodes,
      onNodeClick,
      onPaneClick,
    }: {
      nodes: { id: string; data: { title: string; isNew: boolean } }[];
      onNodeClick: (e: unknown, n: unknown) => void;
      onPaneClick: () => void;
    }) => (
      <div>
        <button type="button" onClick={onPaneClick}>
          pane
        </button>
        {nodes.map((n) => (
          <button key={n.id} type="button" data-new={n.data.isNew} onClick={(e) => onNodeClick(e, n)}>
            {n.data.title}
          </button>
        ))}
      </div>
    ),
  };
});
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, api: vi.fn() };
});
import { api, ApiError } from '../api/client';
import { KnowledgeGraph } from './KnowledgeGraph';

const graph = (lastViewedAt: string | null) => ({
  symbol: 'NVDA',
  version: 7,
  updatedAt: '2026-10-29T15:00:00.000Z',
  lastViewedAt,
  nodes: [
    { id: 'summary', title: 'Summary', text: 'Overview text.', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' },
    {
      id: 'ceo',
      title: 'CEO',
      text: 'The chief.',
      question: 'Who is the CEO?',
      sources: [{ label: 'Annual report', url: 'https://example.com/ar' }],
      createdAt: '2026-10-29T15:00:00.000Z',
      updatedAt: '2026-10-29T15:00:00.000Z',
    },
  ],
  edges: [{ from: 'summary', to: 'ceo', label: 'Leadership' }],
});

let viewed: string[];
function mockApi(g: unknown) {
  vi.mocked(api).mockImplementation((path: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      viewed.push(path);
      return Promise.resolve({ ok: true });
    }
    if (path === '/knowledge/NVDA') {
      if (g === null) return Promise.reject(new ApiError('nope', 404));
      return Promise.resolve(g);
    }
    return Promise.resolve([]);
  });
}

const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/knowledge/nvda']}>
        <Routes>
          <Route path="/knowledge/:symbol" element={<KnowledgeGraph />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  viewed = [];
});
afterEach(cleanup);

it('shows the header and node titles', async () => {
  mockApi(graph('2026-10-28T00:00:00.000Z'));
  renderIt();
  expect(await screen.findByRole('button', { name: 'CEO' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Summary' })).toBeInTheDocument();
  expect(screen.getByText('Updated Oct 29 · v7')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '‹ Knowledge' })).toHaveAttribute('href', '/knowledge');
});

it('marks nodes updated after the first-seen lastViewedAt as new, and keeps that after a refetch', async () => {
  mockApi(graph('2026-10-28T00:00:00.000Z'));
  renderIt();
  const ceo = await screen.findByRole('button', { name: 'CEO' });
  expect(ceo).toHaveAttribute('data-new', 'true');
  expect(screen.getByRole('button', { name: 'Summary' })).toHaveAttribute('data-new', 'false');
  // The server now says it was viewed just now; highlights must not change.
  mockApi(graph('2026-10-30T00:00:00.000Z'));
  focusManager.setFocused(false);
  focusManager.setFocused(true);
  await waitFor(() =>
    expect(vi.mocked(api).mock.calls.filter(([p, i]) => p === '/knowledge/NVDA' && !i).length).toBeGreaterThan(1),
  );
  expect(viewed).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'CEO' })).toHaveAttribute('data-new', 'true');
});

it('treats every node as new when never viewed', async () => {
  mockApi(graph(null));
  renderIt();
  expect(await screen.findByRole('button', { name: 'Summary' })).toHaveAttribute('data-new', 'true');
});

it('posts viewed exactly once', async () => {
  mockApi(graph(null));
  renderIt();
  await screen.findByRole('button', { name: 'CEO' });
  await waitFor(() => expect(viewed).toEqual(['/knowledge/NVDA/viewed']));
  expect(viewed).toHaveLength(1);
});

it('opens a sheet with question, text and sources, switches via neighbours, and closes', async () => {
  mockApi(graph(null));
  renderIt();
  await userEvent.click(await screen.findByRole('button', { name: 'CEO' }));
  const sheet = screen.getByTestId('kg-sheet');
  expect(within(sheet).getByText('Q: Who is the CEO?')).toBeInTheDocument();
  expect(within(sheet).getByText('The chief.')).toBeInTheDocument();
  const link = within(sheet).getByRole('link', { name: 'Annual report' });
  expect(link).toHaveAttribute('href', 'https://example.com/ar');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(within(sheet).getByText('Updated Oct 29')).toBeInTheDocument();

  await userEvent.click(within(sheet).getByRole('button', { name: /Leadership/ }));
  expect(within(screen.getByTestId('kg-sheet')).getByText('Overview text.')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByTestId('kg-sheet')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Summary' }));
  await userEvent.click(screen.getByRole('button', { name: 'pane' }));
  expect(screen.queryByTestId('kg-sheet')).not.toBeInTheDocument();
});

it('says so when there is no graph', async () => {
  mockApi(null);
  renderIt();
  expect(await screen.findByText('No knowledge on NVDA yet — ask Claude to start it.')).toBeInTheDocument();
  expect(viewed).toHaveLength(0);
});

it('shows an error', async () => {
  vi.mocked(api).mockRejectedValue(new Error('boom'));
  renderIt();
  expect(await screen.findByText('Couldn’t load this graph right now.')).toBeInTheDocument();
});

it('closes the sheet on Escape', async () => {
  mockApi(graph(null));
  renderIt();
  await userEvent.click(await screen.findByRole('button', { name: 'CEO' }));
  expect(screen.getByTestId('kg-sheet')).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByTestId('kg-sheet')).not.toBeInTheDocument();
});

it('lists a neighbour once even when edges run both ways', async () => {
  const g = graph(null);
  g.edges.push({ from: 'ceo', to: 'summary', label: 'Reports to' });
  mockApi(g);
  renderIt();
  await userEvent.click(await screen.findByRole('button', { name: 'CEO' }));
  const sheet = screen.getByTestId('kg-sheet');
  expect(within(sheet).getAllByRole('button', { name: /Summary/ })).toHaveLength(1);
  expect(within(sheet).getByRole('button', { name: /Leadership \/ Reports to/ })).toBeInTheDocument();
});
