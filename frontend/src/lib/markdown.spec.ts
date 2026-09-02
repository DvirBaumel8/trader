import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';

describe('parseInline', () => {
  it('returns a single plain segment with no bold markers', () => {
    expect(parseInline('plain text')).toEqual([{ text: 'plain text', bold: false }]);
  });

  it('splits a single bold run', () => {
    expect(parseInline('up **12.4%** this month')).toEqual([
      { text: 'up ', bold: false },
      { text: '12.4%', bold: true },
      { text: ' this month', bold: false },
    ]);
  });

  it('handles multiple bold runs in one line', () => {
    expect(parseInline('**AAPL** and **MSFT** both moved')).toEqual([
      { text: 'AAPL', bold: true },
      { text: ' and ', bold: false },
      { text: 'MSFT', bold: true },
      { text: ' both moved', bold: false },
    ]);
  });

  it('degrades an unclosed bold marker to literal text', () => {
    expect(parseInline('this **never closes')).toEqual([
      { text: 'this **never closes', bold: false },
    ]);
  });

  it('handles an empty string', () => {
    expect(parseInline('')).toEqual([{ text: '', bold: false }]);
  });
});

describe('parseMarkdown', () => {
  it('parses a plain paragraph', () => {
    expect(parseMarkdown('Just a sentence.')).toEqual([
      { kind: 'paragraph', inline: [{ text: 'Just a sentence.', bold: false }] },
    ]);
  });

  it('parses ### and ## headings', () => {
    expect(parseMarkdown('### Critical Risk & Concentration')).toEqual([
      {
        kind: 'heading',
        level: 3,
        inline: [{ text: 'Critical Risk & Concentration', bold: false }],
      },
    ]);
    expect(parseMarkdown('## Overview')).toEqual([
      { kind: 'heading', level: 2, inline: [{ text: 'Overview', bold: false }] },
    ]);
  });

  it('parses a bullet list using * markers', () => {
    expect(
      parseMarkdown('* **LMND fits your stated failure mode** for concentration.\n* Second point.'),
    ).toEqual([
      {
        kind: 'list',
        items: [
          [
            { text: 'LMND fits your stated failure mode', bold: true },
            { text: ' for concentration.', bold: false },
          ],
          [{ text: 'Second point.', bold: false }],
        ],
      },
    ]);
  });

  it('parses a bullet list using - markers', () => {
    expect(parseMarkdown('- first\n- second')).toEqual([
      { kind: 'list', items: [[{ text: 'first', bold: false }], [{ text: 'second', bold: false }]] },
    ]);
  });

  it('joins consecutive non-blank lines into one paragraph', () => {
    expect(parseMarkdown('Line one\nLine two continues.')).toEqual([
      { kind: 'paragraph', inline: [{ text: 'Line one Line two continues.', bold: false }] },
    ]);
  });

  it('separates blocks on blank lines', () => {
    expect(parseMarkdown('First paragraph.\n\nSecond paragraph.')).toEqual([
      { kind: 'paragraph', inline: [{ text: 'First paragraph.', bold: false }] },
      { kind: 'paragraph', inline: [{ text: 'Second paragraph.', bold: false }] },
    ]);
  });

  it('renders the exact shape the model produces: heading directly followed by bullets, no blank line', () => {
    const source = '### Critical Risk & Concentration\n* **LMND fits your stated failure mode** for concentration.\n* Another risk.';
    expect(parseMarkdown(source)).toEqual([
      {
        kind: 'heading',
        level: 3,
        inline: [{ text: 'Critical Risk & Concentration', bold: false }],
      },
      {
        kind: 'list',
        items: [
          [
            { text: 'LMND fits your stated failure mode', bold: true },
            { text: ' for concentration.', bold: false },
          ],
          [{ text: 'Another risk.', bold: false }],
        ],
      },
    ]);
  });

  it('handles a full multi-section summary shape', () => {
    const source = [
      '### Overview',
      'Your book is up **4.2%** this month.',
      '',
      '### Risk',
      '* Concentration in **tech names**.',
      '* No stop on **LMND**.',
      '',
      'Consider trimming.',
    ].join('\n');

    expect(parseMarkdown(source)).toEqual([
      { kind: 'heading', level: 3, inline: [{ text: 'Overview', bold: false }] },
      {
        kind: 'paragraph',
        inline: [
          { text: 'Your book is up ', bold: false },
          { text: '4.2%', bold: true },
          { text: ' this month.', bold: false },
        ],
      },
      { kind: 'heading', level: 3, inline: [{ text: 'Risk', bold: false }] },
      {
        kind: 'list',
        items: [
          [
            { text: 'Concentration in ', bold: false },
            { text: 'tech names', bold: true },
            { text: '.', bold: false },
          ],
          [
            { text: 'No stop on ', bold: false },
            { text: 'LMND', bold: true },
            { text: '.', bold: false },
          ],
        ],
      },
      { kind: 'paragraph', inline: [{ text: 'Consider trimming.', bold: false }] },
    ]);
  });

  it('degrades a level-4 heading (unsupported) to plain paragraph text', () => {
    expect(parseMarkdown('#### Too deep')).toEqual([
      { kind: 'paragraph', inline: [{ text: '#### Too deep', bold: false }] },
    ]);
  });

  it('degrades a malformed heading with no space after the hashes', () => {
    expect(parseMarkdown('###NoSpace')).toEqual([
      { kind: 'paragraph', inline: [{ text: '###NoSpace', bold: false }] },
    ]);
  });

  it('ignores a lone asterisk mid-sentence rather than starting a list', () => {
    expect(parseMarkdown('2 * 3 = 6')).toEqual([
      { kind: 'paragraph', inline: [{ text: '2 * 3 = 6', bold: false }] },
    ]);
  });

  it('handles an empty string with no blocks', () => {
    expect(parseMarkdown('')).toEqual([]);
  });

  it('handles a string of only blank lines with no blocks', () => {
    expect(parseMarkdown('\n\n   \n')).toEqual([]);
  });

  it('never throws on malformed input', () => {
    const inputs = [
      '**',
      '***',
      '#',
      '##',
      '###',
      '* ',
      '- ',
      '\r\n\r\n',
      '**bold** * item\nnot a list',
    ];
    for (const input of inputs) {
      expect(() => parseMarkdown(input)).not.toThrow();
    }
  });
});
