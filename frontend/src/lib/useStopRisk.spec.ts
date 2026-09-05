import { describe, expect, it } from 'vitest';
import { toRequest } from './useStopRisk';
import type { StopRow } from './stopRow';

const oneFixedRow: StopRow[] = [
  { kind: 'FIXED', price: '139.51', trailPercent: '', quantity: '100' },
];

describe('toRequest', () => {
  it('omits currentPrice when priced from entry, as the entry sheet does', () => {
    const request = toRequest('141.26', '100', oneFixedRow, 'BUY');

    expect(request).not.toBeNull();
    expect(request).not.toHaveProperty('currentPrice');
  });

  it('carries currentPrice and highWaterPrice when priced from here, as the Stop Plan editor does', () => {
    const request = toRequest('141.26', '100', oneFixedRow, 'BUY', {
      currentPrice: 148.41,
      highWaterPrice: 150,
    });

    expect(request).toMatchObject({
      avgEntry: 141.26,
      currentPrice: 148.41,
      highWaterPrice: 150,
    });
  });
});
