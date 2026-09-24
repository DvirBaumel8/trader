import { describe, expect, it } from 'vitest';
import { buildTradeIdeaPrompt } from './trade-idea-prompt.js';
import type { TickerFacts } from '../market-data/ticker-facts.service.js';

const indicators = {
  sma20: 100, sma50: 98, sma150: 95, sma200: 90,
  percentFromSma20: 0.05, percentFromSma50: 0.07,
  percentFromSma150: 0.08, percentFromSma200: 0.12,
  high52w: 120, low52w: 60,
  percentFromHigh52w: -0.1, percentFromLow52w: 0.8,
  atr14: 3, atrPercentOfPrice: 0.03,
  relativeVolume: 1.4, barsAvailable: 345,
};

const FACTS: TickerFacts = {
  symbol: 'NVO',
  name: 'Novo Nordisk',
  price: 108,
  stale: false,
  session: 'REGULAR',
  extended: false,
  peRatio: 30,
  indicators,
  priceAction: null,
  news: [],
};

describe('buildTradeIdeaPrompt — recent news', () => {
  it('lists recent headlines, newest first, when there are any', () => {
    const facts: TickerFacts = {
      ...FACTS,
      news: [
        {
          headline: 'NVO partners with Anthropic to accelerate medicine development',
          summary: 'A multi-year partnership.',
          source: 'Reuters',
          publishedOn: '2026-09-16',
          url: 'https://example.com/1',
        },
      ],
    };

    const prompt = buildTradeIdeaPrompt(facts, null);

    expect(prompt).toContain('RECENT NEWS');
    expect(prompt).toContain('NVO partners with Anthropic to accelerate medicine development');
    expect(prompt).toContain('Reuters');
    expect(prompt).toContain('2026-09-16');
  });

  it('says plainly when there is none, rather than omitting the section', () => {
    const prompt = buildTradeIdeaPrompt(FACTS, null);

    expect(prompt).toMatch(/RECENT NEWS.*none/is);
  });

  it('tells the model it may still use its own knowledge, but headlines above are real and current', () => {
    const prompt = buildTradeIdeaPrompt(FACTS, null);

    expect(prompt).toMatch(/today's news|out of date/i);
    expect(prompt).toMatch(/headlines/i);
  });
});

describe('buildTradeIdeaPrompt — the owner\'s own note', () => {
  it('includes the note verbatim when given', () => {
    const prompt = buildTradeIdeaPrompt(FACTS, null, {
      book: '',
      record: '',
      note: 'Heard on a podcast they might announce a buyback this week.',
    });

    expect(prompt).toContain(
      'Heard on a podcast they might announce a buyback this week.',
    );
  });

  it('frames the note as his own belief, not verified data', () => {
    const prompt = buildTradeIdeaPrompt(FACTS, null, {
      book: '',
      record: '',
      note: 'It is up 20% today.',
    });

    expect(prompt).toMatch(/his own|not verified|not a fact|his belief/i);
  });

  it('omits the note section entirely when none was given', () => {
    const prompt = buildTradeIdeaPrompt(FACTS, null, { book: '', record: '' });

    expect(prompt).not.toMatch(/his own note/i);
  });

  it('omits the note section when it is blank or only whitespace', () => {
    const prompt = buildTradeIdeaPrompt(FACTS, null, {
      book: '',
      record: '',
      note: '   ',
    });

    expect(prompt).not.toMatch(/his own note/i);
  });
});
