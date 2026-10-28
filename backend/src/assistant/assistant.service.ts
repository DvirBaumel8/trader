import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { buildPrompt } from './prompt.js';
import { ROUTER_SCHEMA, ROUTER_SYSTEM, toIntent, type RouterIntent } from './router.js';
import { LlmClient } from '../llm/llm.client.js';
import { HoldingsService } from '../holdings/holdings.service.js';
import { WatchlistService } from '../watchlist/watchlist.service.js';
import { InstrumentsService } from '../instruments/instruments.service.js';

export type AssistantReply =
  | { kind: 'done'; message: string }
  | { kind: 'prompt'; text: string; note?: string }
  | { kind: 'error'; message: string };

export const ROUTER_TIMEOUT_MS = 5000;
export const FALLBACK_NOTE = "Couldn't read that automatically — here's a prompt instead.";
const VALIDATE_CONCURRENCY = 5;

type Groups = [label: string, symbols: string[]][];

const summary = (groups: Groups) =>
  groups.filter(([, s]) => s.length > 0).map(([label, s]) => `${label}: ${s.join(', ')}`).join('\n');

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly holdings: HoldingsService,
    private readonly watchlist: WatchlistService,
    private readonly instruments: InstrumentsService,
    private readonly llm: LlmClient,
  ) {}

  async handle(text: string, now: Date = new Date()): Promise<AssistantReply> {
    const message = text.trim();
    if (!this.llm.isConfigured()) return this.prompt(message, now, FALLBACK_NOTE);
    let raw: unknown;
    try {
      raw = await this.llm.generateJson({ system: ROUTER_SYSTEM, user: message, schema: ROUTER_SCHEMA, timeoutMs: ROUTER_TIMEOUT_MS });
    } catch (err) {
      this.logger.warn(`router call failed: ${(err as Error).message}`);
      return this.prompt(message, now, FALLBACK_NOTE);
    }
    const intent = toIntent(raw, message);
    if (intent.kind === 'none') return this.prompt(message, now);
    try {
      return { kind: 'done', message: await this.execute(intent) };
    } catch (err) {
      // Anything unexpected (e.g. a DB error) may have struck after part of
      // the batch was written; say so instead of a bare 500.
      this.logger.error(`assistant execute failed: ${(err as Error).message}`, (err as Error).stack);
      return { kind: 'error', message: 'Something went wrong partway through — check Holdings and Watchlist before resending.' };
    }
  }

  private async execute(intent: Exclude<RouterIntent, { kind: 'none' }>): Promise<string> {
    const { symbols, rejected } = intent;
    switch (intent.kind) {
      case 'buy': {
        const known: string[] = [];
        const unknown: string[] = [];
        for (let i = 0; i < symbols.length; i += VALIDATE_CONCURRENCY) {
          const batch = symbols.slice(i, i + VALIDATE_CONCURRENCY);
          const results = await Promise.allSettled(batch.map((s) => this.instruments.findOrCreate(s)));
          results.forEach((r, j) => {
            if (r.status === 'fulfilled') known.push(r.value.symbol);
            else if (r.reason instanceof NotFoundException) unknown.push(batch[j]);
            else throw r.reason;
          });
        }
        const added: string[] = [];
        const already: string[] = [];
        for (const s of known) {
          if ((await this.holdings.find(s)) !== null) already.push(s);
          else added.push((await this.holdings.set(s, 'LONG')).symbol);
        }
        return summary([['Added (long)', added], ['Already held', already], ["Couldn't find", [...unknown, ...rejected]]]);
      }
      case 'sell': {
        const moved: string[] = [];
        const full: string[] = [];
        const notHeld: string[] = [];
        for (const s of symbols) {
          if (!(await this.holdings.remove(s))) { notHeld.push(s); continue; }
          try {
            await this.watchlist.add(s);
            moved.push(s);
          } catch (err) {
            if (err instanceof BadRequestException) full.push(s);
            else throw err;
          }
        }
        return summary([['Sold and moved to watchlist', moved], ['Sold (watchlist full, not added)', full], ['Not held', notHeld], ["Couldn't find", rejected]]);
      }
      case 'watch': {
        const watching: string[] = [];
        const already: string[] = [];
        const full: string[] = [];
        const unknown: string[] = [];
        for (const s of symbols) {
          try {
            const res = await this.watchlist.add(s);
            (res.added ? watching : already).push(res.symbol);
          } catch (err) {
            if (err instanceof NotFoundException) unknown.push(s);
            else if (err instanceof BadRequestException) full.push(s);
            else throw err;
          }
        }
        return summary([['Watching', watching], ['Already watching', already], ['Watchlist full, not added', full], ["Couldn't find", [...unknown, ...rejected]]]);
      }
      case 'unwatch': {
        const stopped: string[] = [];
        const notOn: string[] = [];
        for (const s of symbols) ((await this.watchlist.remove(s)) ? stopped : notOn).push(s);
        return summary([['Stopped watching', stopped], ['Not on watchlist', notOn], ["Couldn't find", rejected]]);
      }
    }
  }

  private async prompt(message: string, now: Date, note?: string): Promise<AssistantReply> {
    const text = buildPrompt({
      message,
      date: now.toISOString().slice(0, 10),
      holdings: (await this.holdings.list()).map((h) => ({ symbol: h.symbol, direction: h.direction })),
      watchlist: (await this.watchlist.list()).map((w) => w.symbol),
    });
    return note ? { kind: 'prompt', text, note } : { kind: 'prompt', text };
  }
}
