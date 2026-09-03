import { describe, expect, it } from 'vitest';
import { parseProposedLevels, stripLevelsBlock } from './trade-idea-parse.js';

const body = 'Some prose about the trade.\n\n';

describe('parseProposedLevels', () => {
  it('reads the levels the model was asked to end with', () => {
    expect(parseProposedLevels(`${body}LEVELS\nstop: 41.20\ntarget: 58.00`)).toEqual({
      stop: 41.2,
      target: 58,
    });
  });

  it('tolerates a dollar sign, commas and stray whitespace', () => {
    expect(
      parseProposedLevels(`${body}LEVELS\n  stop:  $1,041.20 \n  target: $1,158 `),
    ).toEqual({ stop: 1041.2, target: 1158 });
  });

  it('returns null when the block is missing entirely', () => {
    expect(parseProposedLevels('Just prose, no levels.')).toBeNull();
  });

  it('returns null when only one level is present', () => {
    expect(parseProposedLevels(`${body}LEVELS\nstop: 41.20`)).toBeNull();
  });

  it('returns null for a non-numeric or non-positive level', () => {
    expect(parseProposedLevels(`${body}LEVELS\nstop: n/a\ntarget: 58`)).toBeNull();
    expect(parseProposedLevels(`${body}LEVELS\nstop: 0\ntarget: 58`)).toBeNull();
  });

  it('does not mistake prose that merely mentions a stop for the block', () => {
    // The words appear, the block does not. Reading a level out of prose is
    // how a sentence like "I would not put a stop at 41.20" becomes a stop.
    expect(
      parseProposedLevels('I would not put a stop: 41.20 here, and target: 58 is optimistic.'),
    ).toBeNull();
  });
});

describe('stripLevelsBlock', () => {
  it('removes the machine-readable block from what the owner reads', () => {
    expect(stripLevelsBlock(`${body}LEVELS\nstop: 41.20\ntarget: 58.00`).trim()).toBe(
      'Some prose about the trade.',
    );
  });

  it('leaves prose untouched when there is no block', () => {
    expect(stripLevelsBlock('Just prose.')).toBe('Just prose.');
  });
});
