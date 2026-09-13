import { describe, expect, it } from 'vitest';
import { streamAfterMetaBlock } from './meta-block-stream.js';

async function* deltas(chunks: string[]): AsyncIterable<string> {
  for (const c of chunks) yield c;
}

async function collect<T>(stream: AsyncGenerator<T, unknown>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of stream) out.push(v);
  return out;
}

describe('streamAfterMetaBlock', () => {
  it('yields nothing while the meta block is still open, then yields the body', async () => {
    const chunks = await collect(
      streamAfterMetaBlock(
        deltas(['[REVIEW_META]\nSCORE: A\n', '[/REVIEW_META]\n\nGreat trade.']),
      ),
    );
    expect(chunks).toEqual(['\n\nGreat trade.']);
  });

  it('splits the closing tag across chunk boundaries correctly', async () => {
    const chunks = await collect(
      streamAfterMetaBlock(deltas(['[REVIEW_META]\nVERDICT: X\n[/REVIEW', '_META]\nBody here.'])),
    );
    expect(chunks).toEqual(['\nBody here.']);
  });

  it('streams body chunks untouched once the meta block has closed', async () => {
    const chunks = await collect(
      streamAfterMetaBlock(deltas(['[PATTERN_META]\nHEADLINE: x\n[/PATTERN_META]', 'part1', 'part2'])),
    );
    expect(chunks).toEqual(['part1', 'part2']);
  });

  it('returns the full raw text, meta block included, as the generator return value', async () => {
    const gen = streamAfterMetaBlock(
      deltas(['[PATTERN_META]\nHEADLINE: x\n[/PATTERN_META]\n\nBody text.']),
    );
    let result: IteratorResult<string, string>;
    do {
      result = await gen.next();
    } while (!result.done);
    expect(result.value).toBe('[PATTERN_META]\nHEADLINE: x\n[/PATTERN_META]\n\nBody text.');
  });

  it('yields nothing at all if the meta block never closes', async () => {
    const chunks = await collect(streamAfterMetaBlock(deltas(['[REVIEW_META]\nSCORE: A'])));
    expect(chunks).toEqual([]);
  });
});
