import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { KnowledgeGraph } from './knowledge-graph.entity.js';
import { KnowledgeVersion } from './knowledge-version.entity.js';
import { KnowledgeService } from './knowledge.service.js';
import type { NodeInput } from './graph.js';

const node = (id: string, text = `Text ${id}`): NodeInput => ({ id, title: `Title ${id}`, text });
const graphOf = (...extra: NodeInput[]) => ({
  nodes: [node('summary'), ...extra],
  edges: extra.map((n) => ({ from: 'summary', to: n.id, label: 'l' })),
});

/** An in-memory stand-in for the two tables, shared by the repos and the transaction manager. */
function setup(userId = 'u1') {
  const graphs: KnowledgeGraph[] = [];
  const versions: KnowledgeVersion[] = [];
  let seq = 0;
  const table = (entity: unknown) => (entity === KnowledgeGraph ? graphs : versions) as Array<Record<string, unknown>>;
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => row[k] === v);
  const repo = (rows: Array<Record<string, unknown>>) => ({
    find: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, where)),
    findOne: async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => matches(r, where)) ?? null,
    update: async ({ id }: { id: string }, patch: object) => Object.assign(rows.find((r) => r.id === id)!, patch),
  });
  const manager = {
    findOne: async (entity: unknown, { where }: { where: Record<string, unknown> }) =>
      table(entity).find((r) => matches(r, where)) ?? null,
    create: (_entity: unknown, data: object) => ({ ...data }),
    save: async (entity: unknown, row: Record<string, unknown>) => {
      if (!row.id) {
        row.id = `id${seq++}`;
        row.createdAt = new Date();
        table(entity).push(row);
      }
      return row;
    },
  };
  const dataSource = { transaction: async (fn: (m: typeof manager) => unknown) => fn(manager) };
  const looked: string[] = [];
  const instruments = {
    findOrCreate: async (s: string) => {
      looked.push(s);
      if (s.startsWith('ZZZZ')) throw new NotFoundException(`Unknown ticker "${s}"`);
      return {};
    },
  };
  const users = { currentUser: async () => ({ id: userId }) };
  const service = new KnowledgeService(
    repo(graphs) as never,
    repo(versions) as never,
    dataSource as never,
    instruments as never,
    users as never,
  );
  return { service, graphs, versions, looked };
}

describe('KnowledgeService', () => {
  it('creates v1 at baseVersion 0, upper-casing the symbol, and checks the ticker', async () => {
    const { service, versions, looked } = setup();
    const out = await service.put(' nvda ', 0, 'start', graphOf());
    expect(out).toMatchObject({ symbol: 'NVDA', version: 1, lastViewedAt: null });
    expect(out.nodes[0].createdAt).toBe(out.nodes[0].updatedAt);
    expect(versions).toHaveLength(1);
    expect(looked).toEqual(['NVDA']);
    await service.put('NVDA', 1, 'again', graphOf(node('a')));
    expect(looked).toEqual(['NVDA']);
  });

  it('caps the 400 message at 20 problems and says how many more', async () => {
    const { service } = setup();
    const ids = Array.from({ length: 25 }, (_, i) => `n${i}`);
    const bad = { nodes: [node('summary')], edges: ids.map((id) => ({ from: 'summary', to: id, label: 'x' })) };
    await expect(service.put('NVDA', 0, 'x', bad)).rejects.toMatchObject({
      response: { message: expect.stringMatching(/^(edge [^;]+; ){19}edge [^;]+; and 5 more$/) },
    });
  });

  it('rejects an unknown ticker and saves nothing', async () => {
    const { service, graphs } = setup();
    await expect(service.put('ZZZZ1', 0, 'x', graphOf())).rejects.toBeInstanceOf(NotFoundException);
    expect(graphs).toHaveLength(0);
  });

  it('rejects an invalid graph with a 400 naming the problems', async () => {
    const { service } = setup();
    const bad = { nodes: [node('summary')], edges: [{ from: 'summary', to: 'gaming', label: 'x' }] };
    await expect(service.put('NVDA', 0, 'x', bad)).rejects.toMatchObject({
      response: { message: 'edge summary→gaming: unknown node "gaming"' },
    });
    await expect(service.put('NVDA', 0, 'x', bad)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('409s on a stale base version and leaves the graph unchanged', async () => {
    const { service, graphs, versions } = setup();
    await service.put('NVDA', 0, 'v1', graphOf());
    await service.put('NVDA', 1, 'v2', graphOf(node('a')));
    await expect(service.put('NVDA', 1, 'late', graphOf(node('b')))).rejects.toBeInstanceOf(ConflictException);
    await expect(service.put('NVDA', 0, 'recreate', graphOf())).rejects.toBeInstanceOf(ConflictException);
    expect(graphs[0].version).toBe(2);
    expect(graphs[0].nodes.map((n) => n.id)).toEqual(['summary', 'a']);
    expect(versions).toHaveLength(2);
  });

  it('409s on a non-zero base version when no graph exists', async () => {
    const { service } = setup();
    await expect(service.put('NVDA', 3, 'x', graphOf())).rejects.toBeInstanceOf(ConflictException);
  });

  it('only moves updatedAt on the node that changed', async () => {
    const { service } = setup();
    const v1 = await service.put('NVDA', 0, 'v1', graphOf(node('a'), node('b')));
    await new Promise((r) => setTimeout(r, 5));
    const v2 = await service.put('NVDA', 1, 'v2', graphOf(node('a'), node('b', 'changed')));
    const by = (v: typeof v1, id: string) => v.nodes.find((n) => n.id === id)!;
    expect(by(v2, 'a').updatedAt).toBe(by(v1, 'a').updatedAt);
    expect(by(v2, 'b').updatedAt > by(v1, 'b').updatedAt).toBe(true);
    expect(by(v2, 'b').createdAt).toBe(by(v1, 'b').createdAt);
  });

  it('hides a deleted graph, keeps its history, and a revert brings it back', async () => {
    const { service } = setup();
    await service.put('NVDA', 0, 'v1', graphOf(node('a')));
    await service.remove('NVDA', 1, 'gone');
    await expect(service.get('NVDA')).rejects.toBeInstanceOf(NotFoundException);
    expect(await service.list()).toEqual([]);
    await expect(service.remove('NVDA', 2, 'again')).rejects.toBeInstanceOf(NotFoundException);
    expect((await service.versions('NVDA')).map((v) => v.version)).toEqual([2, 1]);
    const back = await service.revert('NVDA', 2, 1, 'restore');
    expect(back.version).toBe(3);
    expect(back.nodes.map((n) => n.id)).toEqual(['summary', 'a']);
  });

  it('un-deletes with a PUT at the current version', async () => {
    const { service } = setup();
    await service.put('NVDA', 0, 'v1', graphOf());
    await service.remove('NVDA', 1, 'gone');
    expect((await service.put('NVDA', 2, 'back', graphOf(node('a')))).version).toBe(3);
    expect(await service.list()).toHaveLength(1);
  });

  it('404s on reverting to a missing version or a missing graph', async () => {
    const { service } = setup();
    await expect(service.revert('NVDA', 0, 1, 'x')).rejects.toBeInstanceOf(NotFoundException);
    await service.put('NVDA', 0, 'v1', graphOf());
    await expect(service.revert('NVDA', 1, 9, 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tracks what is new since the last view', async () => {
    const { service } = setup();
    await service.put('NVDA', 0, 'v1', graphOf());
    expect((await service.list())[0]).toMatchObject({ nodeCount: 1, hasNew: true });
    await new Promise((r) => setTimeout(r, 5));
    await service.markViewed('NVDA');
    expect((await service.list())[0].hasNew).toBe(false);
    expect((await service.get('NVDA')).lastViewedAt).not.toBeNull();
    await expect(service.markViewed('AAPL')).rejects.toBeInstanceOf(NotFoundException);
  });

  it("never shows another user's graph", async () => {
    const a = setup('u1');
    await a.service.put('NVDA', 0, 'v1', graphOf());
    // same tables, different user
    const b = new KnowledgeService(
      (a.service as never as { graphs: never }).graphs,
      (a.service as never as { versionRows: never }).versionRows,
      (a.service as never as { dataSource: never }).dataSource,
      (a.service as never as { instruments: never }).instruments,
      { currentUser: async () => ({ id: 'u2' }) } as never,
    );
    await expect(b.get('NVDA')).rejects.toBeInstanceOf(NotFoundException);
    expect(await b.list()).toEqual([]);
  });
});
