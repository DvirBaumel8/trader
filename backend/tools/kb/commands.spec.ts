import { describe, expect, it } from 'vitest';
import { Client, KbError } from './client.js';
import type { FetchFn } from './client.js';
import { parseCli, parseSources, runCommand } from './commands.js';

interface Call {
  method: string;
  path: string;
  body: any;
}

const node = (id: string, extra: object = {}) => ({
  id,
  title: `T ${id}`,
  text: `x ${id}`,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...extra,
});
const graph = (version: number, symbol = 'TEST') => ({
  symbol,
  version,
  updatedAt: '2026-01-01T00:00:00Z',
  lastViewedAt: null,
  nodes: [node('summary')],
  edges: [],
});

type Reply = [number, unknown];

function fake(routes: Record<string, Reply | ((c: Call) => Reply)>) {
  const calls: Call[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const path = url.replace('http://kb.test/api/knowledge', '') || '/';
    const call: Call = { method: init.method ?? 'GET', path, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const r = routes[`${call.method} ${path}`];
    if (!r) throw new Error(`unexpected ${call.method} ${path}`);
    const [status, data] = typeof r === 'function' ? r(call) : r;
    return new Response(JSON.stringify(data), { status });
  };
  const client = new Client({ url: 'http://kb.test', key: 'kb_secret' }, fetchFn);
  const lines: string[] = [];
  const files = new Map<string, string>();
  const io = {
    log: (l: string) => lines.push(l),
    readFile: (p: string) => {
      const f = files.get(p);
      if (f === undefined) throw new Error('ENOENT');
      return f;
    },
    writeFile: (p: string, c: string) => void files.set(p, c),
  };
  const run = (...argv: string[]) => runCommand(client, parseCli(argv), io);
  return { calls, lines, files, run };
}

const versions = (...vs: number[]): Reply => [200, vs.map((version) => ({ version, message: 'm', createdAt: '2026-01-01T00:00:00Z' }))];

describe('start', () => {
  it('creates a new graph at base 0', async () => {
    const t = fake({
      'GET /TEST': [404, { message: 'none' }],
      'GET /TEST/versions': versions(),
      'PUT /TEST': [200, graph(1)],
    });
    await t.run('start', 'test', '--title', 'T', '--text', 'hello');
    const put = t.calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toMatchObject({ baseVersion: 0, message: 'start' });
    expect(t.lines[0]).toBe('TEST v1 · start');
  });
  it('restores a deleted graph using its newest version as base', async () => {
    const t = fake({
      'GET /TEST': [404, {}],
      'GET /TEST/versions': versions(4, 3),
      'PUT /TEST': [200, graph(5)],
    });
    await t.run('start', 'TEST', '--title', 'T', '--text', 'hello');
    expect(t.calls.find((c) => c.method === 'PUT')!.body.baseVersion).toBe(4);
    expect(t.lines[0]).toMatch(/was deleted/);
  });
  it('refuses when a graph exists', async () => {
    const t = fake({ 'GET /TEST': [200, graph(2)] });
    await expect(t.run('start', 'TEST', '--title', 'T', '--text', 'x')).rejects.toThrow(/already has/);
  });
});

describe('push / pull', () => {
  it('push onto a deleted graph uses the newest version', async () => {
    const t = fake({
      'GET /TEST': [404, {}],
      'GET /TEST/versions': versions(7),
      'PUT /TEST': (c) => [200, { ...graph(8), nodes: c.body.nodes }],
    });
    t.files.set('g.json', JSON.stringify({ nodes: [node('summary')], edges: [] }));
    await t.run('push', 'TEST', 'g.json', '-m', 'redo');
    const put = t.calls.find((c) => c.method === 'PUT')!;
    expect(put.body.baseVersion).toBe(7);
    expect(put.body.nodes[0].createdAt).toBeUndefined();
  });
  it('pull writes plain JSON without timestamps', async () => {
    const t = fake({ 'GET /TEST': [200, graph(2)] });
    await t.run('pull', 'TEST', 'out.json');
    expect(JSON.parse(t.files.get('out.json')!).nodes[0]).toEqual({ id: 'summary', title: 'T summary', text: 'x summary' });
  });
});

describe('errors', () => {
  it('409 gives the run-again message', async () => {
    const t = fake({ 'GET /TEST': [200, graph(2)], 'PUT /TEST': [409, { message: 'stale' }] });
    await expect(t.run('edit', 'TEST', 'summary', '--title', 'New')).rejects.toThrow(
      'TEST changed since it was read — run the command again.',
    );
  });
  it('400 prints the body message (arrays joined)', async () => {
    const t = fake({ 'GET /TEST': [200, graph(2)], 'PUT /TEST': [400, { message: ['a bad', 'b bad'] }] });
    await expect(t.run('edit', 'TEST', 'summary', '--title', 'New')).rejects.toThrow('a bad\nb bad');
  });
  it('404 on show says there is no knowledge', async () => {
    const t = fake({ 'GET /TEST': [404, { message: 'x' }] });
    await expect(t.run('show', 'TEST')).rejects.toThrow('No knowledge on TEST yet.');
  });
  it('404 body message is printed when a PUT fails', async () => {
    const t = fake({
      'GET /TEST': [404, {}],
      'GET /TEST/versions': versions(),
      'PUT /TEST': [404, { message: 'Unknown ticker "TEST"' }],
    });
    await expect(t.run('start', 'TEST', '--title', 'T', '--text', 'x')).rejects.toThrow('Unknown ticker "TEST"');
  });
  it('unreachable server is a KbError', async () => {
    const client = new Client({ url: 'http://kb.test', key: 'k' }, async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(client.list()).rejects.toThrow(KbError);
  });
});

describe('revert and delete', () => {
  it('revert bases on the newest version', async () => {
    const t = fake({
      'GET /TEST/versions': versions(6, 5, 1),
      'POST /TEST/revert': [200, graph(7)],
    });
    await t.run('revert', 'TEST', 'v2');
    expect(t.calls[1].body).toMatchObject({ baseVersion: 6, version: 2 });
    expect(t.lines[0]).toBe('TEST v7 · revert to v2');
  });
  it('delete reports the version from the history', async () => {
    const t = fake({
      'GET /TEST': [200, graph(3)],
      'DELETE /TEST': [200, { ok: true }],
      'GET /TEST/versions': versions(4, 3),
    });
    await t.run('delete', 'TEST', '-m', 'gone');
    expect(t.calls.find((c) => c.method === 'DELETE')!.body).toEqual({ baseVersion: 3, message: 'gone' });
    expect(t.lines[0]).toBe('TEST v4 · deleted; revert to bring it back.');
  });
  it('delete without a readable history prints no version', async () => {
    const t = fake({
      'GET /TEST': [200, graph(3)],
      'DELETE /TEST': [200, { ok: true }],
      'GET /TEST/versions': [500, {}],
    });
    await t.run('delete', 'TEST');
    expect(t.lines[0]).toBe('TEST · deleted; revert to bring it back.');
  });
});

describe('argument parsing', () => {
  it('collects repeated --source and parses label=url', () => {
    const p = parseCli(['add', 'X', '--source', 'a=https://e.com/?q=1', '--source', 'b=https://f.com']);
    expect(parseSources(p.options.source)).toEqual([
      { label: 'a', url: 'https://e.com/?q=1' },
      { label: 'b', url: 'https://f.com' },
    ]);
  });
  it('parseSources rejects a missing label or equals sign', () => {
    expect(() => parseSources(['nourl'])).toThrow(/label=url/);
    expect(() => parseSources(['=https://e.com'])).toThrow(/label=url/);
    expect(parseSources(undefined)).toBeUndefined();
    expect(parseSources([])).toBeUndefined();
  });
  it('keeps an empty --as-of', () => {
    expect(parseCli(['edit', 'X', 'a', '--as-of', '']).options['as-of']).toBe('');
  });
  it('accepts values starting with "-" via =, and explains the ambiguity otherwise', () => {
    expect(parseCli(['edit', 'X', 'a', '--text=-3% yoy']).options.text).toBe('-3% yoy');
    expect(() => parseCli(['edit', 'X', 'a', '--text', '-3% yoy'])).toThrow('Value starts with "-": write it as --text="-3% yoy"');
  });
  it('rejects unknown commands', () => {
    expect(() => parseCli(['nope'])).toThrow(/Unknown command/);
  });
});
