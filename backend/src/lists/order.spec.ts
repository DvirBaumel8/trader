import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { reorderSymbols } from './order.js';

describe('reorderSymbols', () => {
  it('uses the requested order', () => {
    expect(reorderSymbols(['A', 'B', 'C'], ['c', 'A', 'B'])).toEqual(['C', 'A', 'B']);
  });

  it('keeps unlisted symbols in their relative order, after the listed ones', () => {
    expect(reorderSymbols(['A', 'B', 'C', 'D'], ['C'])).toEqual(['C', 'A', 'B', 'D']);
  });

  it('ignores repeats in the request', () => {
    expect(reorderSymbols(['A', 'B'], ['B', 'B', 'A'])).toEqual(['B', 'A']);
  });

  it('rejects a symbol that is not in the list', () => {
    expect(() => reorderSymbols(['A', 'B'], ['A', 'zz'])).toThrow(
      new BadRequestException('Unknown symbol in order: ZZ'),
    );
  });
});
