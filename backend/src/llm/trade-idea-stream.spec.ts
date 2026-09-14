import { describe, expect, it } from 'vitest';
import { streamTradeIdeaBody } from './trade-idea-stream.js';
import type { BookInput } from './trade-idea-context.js';

const book: BookInput = {
  positions: [{ symbol: 'LMND', quantity: 100, price: 10, marketValue: 1000 }],
  cash: 1000,
  accountValue: 2000,
  atRisk: { amount: 0 },
};

async function* deltas(chunks: string[]): AsyncIterable<string> {
  for (const c of chunks) yield c;
}

async function collect(gen: AsyncGenerator<string, string>): Promise<{ chunks: string[]; raw: string }> {
  const chunks: string[] = [];
  let next = await gen.next();
  while (!next.done) {
    chunks.push(next.value);
    next = await gen.next();
  }
  return { chunks, raw: next.value };
}

describe('streamTradeIdeaBody', () => {
  it('streams plain prose through unchanged when there is no LEVELS block or placeholder', async () => {
    const { chunks } = await collect(streamTradeIdeaBody(deltas(['Hello there, this is a plain answer.']), book));
    expect(chunks.join('')).toBe('Hello there, this is a plain answer.');
  });

  it('never yields any part of the LEVELS block, arriving in one chunk', async () => {
    const { chunks, raw } = await collect(
      streamTradeIdeaBody(
        deltas(['This looks like a good setup.\nLEVELS\nstop: 41.20\ntarget: 58.00']),
        book,
      ),
    );
    const shown = chunks.join('');
    expect(shown).toBe('This looks like a good setup.');
    expect(shown).not.toContain('LEVELS');
    // The full raw text (LEVELS block included) is still returned, for
    // parseProposedLevels to run against.
    expect(raw).toContain('LEVELS\nstop: 41.20\ntarget: 58.00');
  });

  it('never yields any part of the LEVELS block, even when the marker is split across chunks', async () => {
    const { chunks } = await collect(
      streamTradeIdeaBody(
        deltas(['Good setup here.\nLEV', 'ELS\nstop: 41.20\n', 'target: 58.00']),
        book,
      ),
    );
    const shown = chunks.join('');
    expect(shown).toBe('Good setup here.');
    expect(shown).not.toContain('LEVELS');
    expect(shown).not.toContain('LEV');
  });

  it('substitutes a placeholder that arrives whole in one chunk', async () => {
    const { chunks } = await collect(
      streamTradeIdeaBody(deltas(['LMND is already {{WEIGHT:LMND}} of your account.']), book),
    );
    expect(chunks.join('')).toBe('LMND is already 50.0% of your account.');
  });

  it('never shows raw {{...}} syntax when a placeholder is split across chunks', async () => {
    const { chunks } = await collect(
      streamTradeIdeaBody(
        deltas(['LMND is already {{WEIGHT:LM', 'ND}} of your account.']),
        book,
      ),
    );
    const shown = chunks.join('');
    expect(shown).toBe('LMND is already 50.0% of your account.');
    expect(shown).not.toContain('{{');
    expect(shown).not.toContain('}}');
  });

  it('substitutes a placeholder split character by character', async () => {
    const text = 'Exposure is {{GROSS_EXPOSURE}} right now.';
    const { chunks } = await collect(streamTradeIdeaBody(deltas(text.split('')), book));
    expect(chunks.join('')).toBe('Exposure is $1,000 right now.');
  });

  it('substitutes multiple placeholders in the same response', async () => {
    const { chunks } = await collect(
      streamTradeIdeaBody(
        deltas([
          'Gross exposure is {{GROSS_EXPOSURE}}, or {{GROSS_EXPOSURE_MULTIPLE}}. ',
          'LMND is {{WEIGHT:LMND}} of the account.',
        ]),
        book,
      ),
    );
    expect(chunks.join('')).toBe(
      'Gross exposure is $1,000, or 0.50x. LMND is 50.0% of the account.',
    );
  });

  it('handles a placeholder immediately followed by the LEVELS block', async () => {
    const { chunks } = await collect(
      streamTradeIdeaBody(
        deltas(['LMND is {{WEIGHT:LM', 'ND}}.\nLEVELS\nstop: 10\ntarget: 20']),
        book,
      ),
    );
    const shown = chunks.join('');
    expect(shown).toBe('LMND is 50.0%.');
    expect(shown).not.toContain('LEVELS');
  });

  it('flushes an unresolvable placeholder (unknown symbol) as the dash the non-streaming path would produce', async () => {
    const { chunks } = await collect(
      streamTradeIdeaBody(deltas(['ZZZZ is {{WEIGHT:ZZZZ}} of your account.']), book),
    );
    expect(chunks.join('')).toBe('ZZZZ is — of your account.');
  });

  it('flushes an unclosed placeholder raw if the stream ends before it closes', async () => {
    const { chunks } = await collect(
      streamTradeIdeaBody(deltas(['Something odd: {{WEIGHT:LMND']), book),
    );
    expect(chunks.join('')).toBe('Something odd: {{WEIGHT:LMND');
  });

  it('streams everything when the model never emits a LEVELS block at all', async () => {
    const { chunks, raw } = await collect(
      streamTradeIdeaBody(deltas(['Just prose, no machine-readable block.']), book),
    );
    expect(chunks.join('')).toBe('Just prose, no machine-readable block.');
    expect(raw).toBe('Just prose, no machine-readable block.');
  });

  it('returns an empty string and yields nothing for an empty stream', async () => {
    const { chunks, raw } = await collect(streamTradeIdeaBody(deltas([]), book));
    expect(chunks).toEqual([]);
    expect(raw).toBe('');
  });

  it('never leaks the LEVELS marker no matter where the chunk boundary falls', async () => {
    const text = 'A full answer with real substance here.\nLEVELS\nstop: 41.20\ntarget: 58.00';
    const markerStart = text.indexOf('LEVELS');
    for (let split = 0; split <= text.length; split++) {
      const { chunks } = await collect(
        streamTradeIdeaBody(deltas([text.slice(0, split), text.slice(split)]), book),
      );
      const shown = chunks.join('');
      expect(shown, `split at ${split}`).toBe(text.slice(0, markerStart - 1));
    }
  });

  it('always substitutes the placeholder correctly no matter where the chunk boundary falls', async () => {
    const text = 'LMND is already {{WEIGHT:LMND}} of your account, worth watching.';
    const expected = 'LMND is already 50.0% of your account, worth watching.';
    for (let split = 0; split <= text.length; split++) {
      const { chunks } = await collect(
        streamTradeIdeaBody(deltas([text.slice(0, split), text.slice(split)]), book),
      );
      expect(chunks.join(''), `split at ${split}`).toBe(expected);
    }
  });
});
