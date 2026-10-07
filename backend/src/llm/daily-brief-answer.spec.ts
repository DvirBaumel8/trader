import { describe, expect, it } from 'vitest';
import { parseDailyBriefAnswer } from './daily-brief-answer.js';

describe('parseDailyBriefAnswer', () => {
  it('reads the summary and one thesis line per mover', () => {
    const text = [
      'SUMMARY: BITX gapped through its stop; it fills at the open unless you act first.',
      'THESIS BITX: Your breakout entry is broken — the gap erased it on ETF outflow news.',
      'THESIS MSTR: The move tracks bitcoin, not your 150 SMA thesis; it still holds.',
    ].join('\n');
    expect(parseDailyBriefAnswer(text, ['BITX', 'MSTR'])).toEqual({
      summary: 'BITX gapped through its stop; it fills at the open unless you act first.',
      thesis: {
        BITX: 'Your breakout entry is broken — the gap erased it on ETF outflow news.',
        MSTR: 'The move tracks bitcoin, not your 150 SMA thesis; it still holds.',
      },
    });
  });

  it('keeps a multi-line summary until the first thesis line', () => {
    const text = 'SUMMARY: First sentence.\nSecond sentence.\nTHESIS NVDA: Holds.';
    expect(parseDailyBriefAnswer(text, ['NVDA']).summary).toBe('First sentence.\nSecond sentence.');
  });

  it('takes plain prose as the summary when the model ignores the format', () => {
    expect(parseDailyBriefAnswer('Nothing urgent today; your stops are all clear.', ['NVDA'])).toEqual({
      summary: 'Nothing urgent today; your stops are all clear.',
      thesis: {},
    });
  });

  it('drops a thesis for a symbol that is not a mover', () => {
    const text = 'SUMMARY: s\nTHESIS AAPL: invented.\nTHESIS NVDA: real.';
    expect(parseDailyBriefAnswer(text, ['NVDA']).thesis).toEqual({ NVDA: 'real.' });
  });

  it('matches the symbol case-insensitively, tolerates markdown bold, and keys by the mover\'s own casing', () => {
    const text = '**SUMMARY:** s\n**THESIS nvda:** holds.';
    expect(parseDailyBriefAnswer(text, ['NVDA'])).toEqual({ summary: 's', thesis: { NVDA: 'holds.' } });
  });

  it('gives a null summary, not an empty string, when there is none', () => {
    expect(parseDailyBriefAnswer('THESIS NVDA: holds.', ['NVDA'])).toEqual({ summary: null, thesis: { NVDA: 'holds.' } });
    expect(parseDailyBriefAnswer('   ', [])).toEqual({ summary: null, thesis: {} });
  });

  it('keeps only the first thesis line for a symbol', () => {
    expect(parseDailyBriefAnswer('SUMMARY: s\nTHESIS NVDA: one.\nTHESIS NVDA: two.', ['NVDA']).thesis).toEqual({ NVDA: 'one.' });
  });

  it('does not mistake prose that starts with "Thesis" for a thesis tag', () => {
    const text = 'Thesis check: your stops are fine.\nNothing else urgent.';
    expect(parseDailyBriefAnswer(text, ['NVDA'])).toEqual({ summary: text, thesis: {} });
  });

  it('keeps a mid-text "Thesis holds:" line in the summary and still reads the real thesis line', () => {
    const text = 'SUMMARY: s1\nThesis holds: broadly.\nTHESIS NVDA: real.';
    expect(parseDailyBriefAnswer(text, ['NVDA'])).toEqual({
      summary: 's1\nThesis holds: broadly.',
      thesis: { NVDA: 'real.' },
    });
  });

  it('finds a summary that comes after the thesis lines', () => {
    expect(parseDailyBriefAnswer('THESIS NVDA: holds.\nSUMMARY: s', ['NVDA'])).toEqual({
      summary: 's',
      thesis: { NVDA: 'holds.' },
    });
  });

  it('parses a CRLF answer the same as an LF one', () => {
    const lf = 'SUMMARY: a\nb\nTHESIS NVDA: holds.';
    expect(parseDailyBriefAnswer(lf.replace(/\n/g, '\r\n'), ['NVDA'])).toEqual(parseDailyBriefAnswer(lf, ['NVDA']));
  });

  it('accepts bold markers before the colon', () => {
    expect(parseDailyBriefAnswer('**SUMMARY**: s\n**THESIS NVDA**: holds.', ['NVDA'])).toEqual({
      summary: 's', thesis: { NVDA: 'holds.' },
    });
  });

  it('accepts a bulleted thesis line', () => {
    expect(parseDailyBriefAnswer('SUMMARY: s\n- THESIS NVDA: holds.\n* THESIS AMD: ok.', ['NVDA', 'AMD']).thesis)
      .toEqual({ NVDA: 'holds.', AMD: 'ok.' });
  });

  it('strips trailing bold markers from a thesis wrapped in bold', () => {
    expect(parseDailyBriefAnswer('**THESIS NVDA: holds.**', ['NVDA']).thesis).toEqual({ NVDA: 'holds.' });
  });

  it('drops a bulleted or bold-colon tag for a non-mover', () => {
    expect(parseDailyBriefAnswer('SUMMARY: s\n- THESIS AAPL: x.\n**THESIS MSFT**: y.', ['NVDA']))
      .toEqual({ summary: 's', thesis: {} });
  });

  it('strips trailing bold markers from the summary', () => {
    expect(parseDailyBriefAnswer('**SUMMARY: s**', []).summary).toBe('s');
  });
});
