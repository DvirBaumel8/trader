import { describe, expect, it } from 'vitest';
import { settleInChunks } from './settle-in-chunks.js';

describe('settleInChunks', () => {
  it('never runs more than chunkSize calls at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const items = Array.from({ length: 11 }, (_, i) => i);
    const results = await settleInChunks(items, 3, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return n * 2;
    });

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual(
      items.map((n) => n * 2),
    );
  });

  it('preserves input order across chunk boundaries', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await settleInChunks(items, 2, async (n) => n);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual(items);
  });

  it('reports a rejection for its own item without failing the others', async () => {
    const items = ['a', 'b', 'c'];
    const results = await settleInChunks(items, 2, async (s) => {
      if (s === 'b') throw new Error('boom');
      return s.toUpperCase();
    });

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'A' });
    expect(results[1].status).toBe('rejected');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'C' });
  });

  it('handles an empty list without calling fn', async () => {
    let calls = 0;
    const results = await settleInChunks<number, number>([], 4, async (n) => {
      calls++;
      return n;
    });
    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });
});
