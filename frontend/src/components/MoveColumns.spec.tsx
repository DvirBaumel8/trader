// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fmtAtr, fmtMove, moveTone, MoveCells, MovesHeader } from './MoveColumns';

afterEach(cleanup);

const mv = (over: Partial<{ atrPercent: number | null; movePercent: number | null; live: boolean }> = {}) => ({
  symbol: 'AMD',
  atrPercent: 3.2,
  movePercent: 4.1,
  live: true,
  asOf: '2026-10-29',
  ...over,
});

it('formats ATR and the move', () => {
  expect(fmtAtr(3.2)).toBe('3.2%');
  expect(fmtAtr(null)).toBe('—');
  expect(fmtMove(4.1)).toBe('+4.1%');
  expect(fmtMove(-2.3)).toBe('−2.3%');
  expect(fmtMove(0)).toBe('0.0%');
  expect(fmtMove(-0)).toBe('0.0%');
  expect(fmtMove(null)).toBe('—');
});

it('colours only when the move is bigger than the ATR', () => {
  expect(moveTone(mv())).toBe('up');
  expect(moveTone(mv({ movePercent: -4.1 }))).toBe('down');
  expect(moveTone(mv({ movePercent: 3.2 }))).toBeNull();
  expect(moveTone(mv({ movePercent: -3.2 }))).toBeNull();
  expect(moveTone(mv({ movePercent: 1 }))).toBeNull();
  expect(moveTone(mv({ atrPercent: null }))).toBeNull();
  expect(moveTone(mv({ movePercent: null }))).toBeNull();
  expect(moveTone(undefined)).toBeNull();
});

it('renders the cells with the tone class and dashes for nulls', () => {
  render(<MoveCells symbol="AMD" move={mv({ movePercent: -4.1 })} />);
  expect(screen.getByTestId('atr-AMD')).toHaveTextContent('3.2%');
  expect(screen.getByTestId('today-AMD')).toHaveTextContent('−4.1%');
  expect(screen.getByTestId('today-AMD')).toHaveClass('text-down');
  cleanup();
  render(<MoveCells symbol="AMD" move={mv({ atrPercent: null, movePercent: null })} />);
  expect(screen.getByTestId('atr-AMD')).toHaveTextContent('—');
  expect(screen.getByTestId('today-AMD')).toHaveTextContent('—');
});

it('labels the header Today while live and Today (close) when every move is closed', () => {
  const { rerender } = render(<MovesHeader moves={[mv(), mv({ live: false })]} />);
  expect(screen.getByText('Today')).toBeInTheDocument();
  rerender(<MovesHeader moves={[mv({ live: false }), mv({ live: false })]} />);
  expect(screen.getByText('Today (close)')).toBeInTheDocument();
  rerender(<MovesHeader moves={undefined} />);
  expect(screen.getByText('Today')).toBeInTheDocument();
  expect(screen.getByText('Ticker')).toBeInTheDocument();
  expect(screen.getByText('ATR')).toBeInTheDocument();
});
