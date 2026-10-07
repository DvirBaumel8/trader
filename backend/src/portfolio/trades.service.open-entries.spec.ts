import { describe, expect, it, vi } from 'vitest';
import { In } from 'typeorm';
import { TradesService } from './trades.service.js';

function build(trades: unknown[], entries: unknown[]) {
  const find = vi.fn().mockResolvedValue(entries);
  const svc = new TradesService(
    {} as never, {} as never, {} as never,
    { find } as never,
    {} as never, {} as never, {} as never, {} as never, {} as never,
    { currentUser: async () => ({ id: 'user-1' }) } as never,
    {} as never,
  );
  vi.spyOn(svc, 'deriveAllTrades').mockResolvedValue(trades as never);
  return { svc, find };
}

const ENTERED = new Date('2026-09-28T14:00:00Z');

describe('TradesService.openTradeEntries', () => {
  it('returns each open trade with the reasons on its opening fill\'s entry', async () => {
    const { svc } = build(
      [
        { symbol: 'NVDA', direction: 'LONG', enteredAt: ENTERED, isOpen: true, fills: [{ entryId: 'e1' }, { entryId: 'e2' }] },
        { symbol: 'OLD', direction: 'LONG', enteredAt: ENTERED, isOpen: false, fills: [{ entryId: 'e3' }] },
      ],
      [{ id: 'e1', reasons: ['ENTRY_BREAKOUT'] }],
    );
    await expect(svc.openTradeEntries()).resolves.toEqual([
      { symbol: 'NVDA', direction: 'LONG', enteredAt: ENTERED, reasons: ['ENTRY_BREAKOUT'] },
    ]);
  });

  it('reads journal entries for the current user only', async () => {
    const { svc, find } = build(
      [{ symbol: 'NVDA', direction: 'SHORT', enteredAt: ENTERED, isOpen: true, fills: [{ entryId: 'e1' }] }],
      [],
    );
    await svc.openTradeEntries();
    expect(find).toHaveBeenCalledWith({ where: { userId: 'user-1', id: In(['e1']) } });
  });

  it('gives no reasons, without a query, when no opening fill names an entry', async () => {
    const { svc, find } = build(
      [{ symbol: 'NVDA', direction: 'LONG', enteredAt: ENTERED, isOpen: true, fills: [{}] }],
      [],
    );
    await expect(svc.openTradeEntries()).resolves.toEqual([
      { symbol: 'NVDA', direction: 'LONG', enteredAt: ENTERED, reasons: [] },
    ]);
    expect(find).not.toHaveBeenCalled();
  });
});
