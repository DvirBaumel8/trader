/**
 * Assembles the facts block the model reads for the Daily Brief narrative.
 * Every figure is quoted from what DailyBriefService already computed —
 * nothing here recalculates one, in the same spirit as portfolio-context.ts.
 * Pure and dependency-free so it is covered by fixture-driven tests.
 */
import type { Mood } from '../market-data/brief-mood.js';
import type { MarketSession } from '../market-data/market-session.js';

export interface ContextLine {
  title: string;
  detail: string;
}

export interface DailyBriefContextInput {
  generatedAt: string;
  session: MarketSession;
  mood: Mood;
  events: ContextLine[];
  holdingNotes: ContextLine[];
  watchTriggers: ContextLine[];
}

function percent(fraction: number): string {
  return `${fraction >= 0 ? '+' : '-'}${(Math.abs(fraction) * 100).toFixed(2)}%`;
}

function points(value: number): string {
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}`;
}

function moodLines(mood: Mood): string[] {
  const lines: string[] = [];
  for (const index of mood.indices) {
    const parts = [`${index.symbol}: ${index.trend ?? 'trend unknown'}`];
    if (index.changePct !== null) parts.push(`, ${percent(index.changePct)} since prior close`);
    if (index.extended) parts.push(' (extended-hours print)');
    if (index.stale) parts.push(' (stale)');
    lines.push(`- ${parts.join('')}`);
  }
  if (mood.vix) {
    const change = mood.vix.change !== null ? ` (${points(mood.vix.change)})` : '';
    lines.push(`- VIX: ${mood.vix.level.toFixed(2)}${change}${mood.vix.stale ? ' (stale)' : ''}`);
  }
  if (mood.leader) lines.push(`- Leading sector: ${mood.leader.name} (${mood.leader.symbol}) ${percent(mood.leader.changePct)}`);
  if (mood.laggard) lines.push(`- Lagging sector: ${mood.laggard.name} (${mood.laggard.symbol}) ${percent(mood.laggard.changePct)}`);
  return lines.length > 0 ? lines : ['- Market mood unavailable.'];
}

function section(heading: string, items: ContextLine[], empty: string): string[] {
  return [
    heading,
    ...(items.length === 0 ? [`- ${empty}`] : items.map((item) => `- ${item.title}: ${item.detail}`)),
    '',
  ];
}

export function buildDailyBriefContext(input: DailyBriefContextInput): string {
  return [
    `FACTS (daily brief as of ${input.generatedAt}, market session ${input.session}, computed by the app — quote these, do not recalculate)`,
    '',
    'Market mood',
    ...moodLines(input.mood),
    '',
    ...section('Economic events this week', input.events, 'No economic events this week.'),
    ...section('Your holdings', input.holdingNotes, 'Nothing notable on your holdings today.'),
    ...section('Watchlist triggers', input.watchTriggers, 'No new watchlist triggers.'),
  ].join('\n').trimEnd();
}
