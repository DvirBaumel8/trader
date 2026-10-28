# Chat AI Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chat's hand-written parser with a free-Gemini router that maps a message to `buy | sell | watch | unwatch | none` (one or many symbols), performs the action with one summary reply, and falls back to the Gemini Pro prompt for everything else.

**Architecture:** A slim `LlmClient` (the only `@google/genai` import) returns structured JSON. Pure `router.ts` holds the system instruction, response schema and validation into a `RouterIntent`. `AssistantService` executes intents in bulk against `HoldingsService`/`WatchlistService`/`InstrumentsService`. The frontend renders `done` (multi-line), `prompt` (with optional note) and `error` only.

**Tech Stack:** NestJS, `@google/genai`, Vitest (unit + e2e with supertest), React + TanStack Query, Playwright (iPhone WebKit).

**Spec:** `docs/superpowers/specs/2026-10-28-chat-ai-router-design.md`

## Global Constraints

- `backend/src/llm/llm.client.ts` is the only file that imports an AI SDK. `router.ts` must not import `@google/genai`.
- Model `process.env.LLM_MODEL ?? 'gemini-3.6-flash'`; key `process.env.GEMINI_API_KEY ?? process.env.LLM_API_KEY`. No key → every message becomes a prompt.
- The model never writes: its output is validated; a message containing `?` never performs an action, whatever the model says.
- Only the owner's message and the action list go to the model — never holdings or watchlist.
- Model call timeout 5 000 ms. Any failure (timeout, HTTP error, quota, bad JSON, invalid shape) → `{ kind: 'prompt', note: "Couldn't read that automatically — here's a prompt instead.", text }`; no write.
- At most 50 symbols per message (more → `none` → prompt). Symbols uppercased, `$` and list numbering stripped, de-duplicated; valid shape `^[A-Z]{1,5}(\.[A-Z])?$`, other strings go to "Couldn't find".
- Tests never call Gemini or Yahoo: override `LlmClient` and `YahooClient` with stubs.
- Never touch the local `trader` DB or a DATABASE_URL in tests.
- Work on local `main`; push only in Task 5.
- Commit trailers: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01KSLpjvWMhkHqfbWoTYBnE1`.

## Review Focus

1. **Model says "buy" for a question** ("should I buy NVDA?") — must be a prompt; pinned by the `?` override unit test in Task 1 and an e2e case in Task 2.
2. **Model returns junk symbols** (lowercase, `$TSLA`, `"4. GSIT"`, `"Lemonade"`, duplicates) — normalised or put in "Couldn't find"; pinned by Task 1 unit cases.
3. **Model hangs or 429s** — the reply is a prompt with the note within ~5 s and nothing is written; pinned by Task 2 unit test with a rejecting/slow stub.
4. **Selling something not held** — reported "Not held", no watchlist add; pinned by Task 2 e2e.
5. **Watchlist full during a bulk watch or sell** — the rest of the batch still completes and the full ones are reported; pinned by Task 2 unit test.

---

### Task 1: LLM client and pure router

**Files:**
- Create: `backend/src/llm/llm.client.ts`, `backend/src/llm/llm.module.ts`, `backend/src/assistant/router.ts`, `backend/src/assistant/router.spec.ts`, `backend/src/llm/llm.client.spec.ts`
- Modify: `backend/package.json` (+ root `package-lock.json`): `npm install @google/genai@^2.21.0 --prefix backend` — run from the repo root with workspaces as the repo already does (`npm install @google/genai@^2.21.0 -w backend`); commit only the root lock.

**Interfaces — Produces:**

```ts
// llm.client.ts
export interface JsonRequest { system: string; user: string; schema: Record<string, unknown>; timeoutMs: number }
export abstract class LlmClient {
  abstract isConfigured(): boolean;
  /** Parsed JSON from the model. Throws on timeout, provider error, empty or non-JSON output. */
  abstract generateJson(req: JsonRequest): Promise<unknown>;
}
export class GeminiClient extends LlmClient { /* @Injectable */ }
// llm.module.ts: providers [{ provide: LlmClient, useClass: GeminiClient }], exports [LlmClient]

// router.ts
export type RouterAction = 'buy' | 'sell' | 'watch' | 'unwatch';
export type RouterIntent =
  | { kind: RouterAction; symbols: string[]; rejected: string[] }
  | { kind: 'none' };
export const ROUTER_SYSTEM: string;
export const ROUTER_SCHEMA: Record<string, unknown>;
export const MAX_SYMBOLS = 50;
export function toIntent(raw: unknown, message: string): RouterIntent;
```

- [ ] **Step 1: Failing router tests** (`router.spec.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { toIntent, MAX_SYMBOLS } from './router.js';

describe('toIntent', () => {
  it('accepts a buy with normalised, de-duplicated symbols', () => {
    expect(toIntent({ action: 'buy', symbols: ['lmnd', '$TSLA', '4. GSIT', 'LMND', ' brk.b '] }, 'bought stuff')).toEqual({
      kind: 'buy',
      symbols: ['LMND', 'TSLA', 'GSIT', 'BRK.B'],
      rejected: [],
    });
  });
  it('puts non-ticker strings in rejected', () => {
    expect(toIntent({ action: 'watch', symbols: ['NVDA', 'Lemonade', 'BTC-USD', ''] }, 'watch these')).toEqual({
      kind: 'watch',
      symbols: ['NVDA'],
      rejected: ['LEMONADE', 'BTC-USD'],
    });
  });
  it.each(['sell', 'unwatch'])('accepts %s', (action) => {
    expect(toIntent({ action, symbols: ['NVDA'] }, 'x')).toEqual({ kind: action, symbols: ['NVDA'], rejected: [] });
  });
  it('a message with "?" is never an action, whatever the model says', () => {
    expect(toIntent({ action: 'buy', symbols: ['NVDA'] }, 'should I buy NVDA?')).toEqual({ kind: 'none' });
  });
  it.each([
    [null],
    ['buy NVDA'],
    [{ action: 'short', symbols: ['NVDA'] }],
    [{ action: 'buy' }],
    [{ action: 'buy', symbols: 'NVDA' }],
    [{ action: 'buy', symbols: [42] }],
    [{ action: 'buy', symbols: [] }],
    [{ action: 'buy', symbols: ['zz zz', '???'] }],
    [{ action: 'none', symbols: [] }],
  ])('invalid or empty output %j is none', (raw) => {
    expect(toIntent(raw, 'bought something')).toEqual({ kind: 'none' });
  });
  it('more than MAX_SYMBOLS is none', () => {
    const symbols = Array.from({ length: MAX_SYMBOLS + 1 }, (_, i) => `A${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`);
    expect(toIntent({ action: 'buy', symbols }, 'bought')).toEqual({ kind: 'none' });
  });
});
```

Note the `[{ action: 'buy', symbols: ['zz zz', '???'] }]` case: every symbol rejected and none valid → `none` (nothing to do; the owner gets a prompt).

- [ ] **Step 2: Run, expect FAIL** — `cd backend && npx vitest run src/assistant/router.spec.ts` → module not found.

- [ ] **Step 3: Implement `router.ts`**

```ts
/**
 * Routes one chat message to a predefined action using a free Gemini model
 * (docs/superpowers/specs/2026-10-28-chat-ai-router-design.md).
 *
 * The model only proposes: `toIntent` decides. Anything off-shape, any
 * message with a question mark, and anything with nothing valid to act on
 * is `none`, which the caller turns into a Gemini Pro prompt — so a model
 * mistake costs the owner a copy-paste, never a wrong write.
 *
 * Deliberately free of any AI SDK import: llm.client.ts is the boundary.
 */
export type RouterAction = 'buy' | 'sell' | 'watch' | 'unwatch';

export type RouterIntent =
  | { kind: RouterAction; symbols: string[]; rejected: string[] }
  | { kind: 'none' };

export const MAX_SYMBOLS = 50;

const ACTIONS: readonly RouterAction[] = ['buy', 'sell', 'watch', 'unwatch'];
const TICKER = /^[A-Z]{1,5}(\.[A-Z])?$/;

export const ROUTER_SYSTEM = `You route messages from a stock trader's portfolio app to exactly one action. Reply only with JSON matching the schema.

Actions:
- buy: the user records that they bought one or more stocks (e.g. "bought LMND", "I bought: LMND, TSLA", "Bought:" followed by a list).
- sell: the user records that they sold or closed one or more positions (e.g. "sold LMND", "closed TSLA and NVDA").
- watch: the user asks to add one or more stocks to their watchlist.
- unwatch: the user asks to remove one or more stocks from their watchlist.
- none: anything else — questions, opinions, plans or intentions ("should I sell X", "thinking of buying X", "what do you think of NVDA"), market questions, mixed actions, or when unsure.

Rules:
- symbols: US ticker symbols, uppercase, without "$", list numbers or bullets. If the user names a company instead of a ticker, include its primary US ticker only if you are certain; otherwise leave it out.
- For none, symbols is [].
- Never invent symbols that the message does not mention.`;

export const ROUTER_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    action: { type: 'STRING', enum: ['buy', 'sell', 'watch', 'unwatch', 'none'] },
    symbols: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['action', 'symbols'],
};

const NONE: RouterIntent = { kind: 'none' };

function normalise(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .replace(/^\d+[.)]\s*/, '')
    .replace(/^[-•*]\s*/, '')
    .replace(/^\$/, '')
    .trim();
}

export function toIntent(raw: unknown, message: string): RouterIntent {
  if (message.includes('?')) return NONE;
  if (typeof raw !== 'object' || raw === null) return NONE;
  const { action, symbols } = raw as { action?: unknown; symbols?: unknown };
  if (!ACTIONS.includes(action as RouterAction)) return NONE;
  if (!Array.isArray(symbols) || symbols.some((s) => typeof s !== 'string')) return NONE;
  if (symbols.length > MAX_SYMBOLS) return NONE;

  const valid: string[] = [];
  const rejected: string[] = [];
  for (const s of (symbols as string[]).map(normalise)) {
    if (s === '') continue;
    const bucket = TICKER.test(s) ? valid : rejected;
    if (!bucket.includes(s)) bucket.push(s);
  }
  if (valid.length === 0) return NONE;
  return { kind: action as RouterAction, symbols: valid, rejected };
}
```

Check the `'zz zz'`/`'???'` case: normalised to `'ZZ ZZ'`/`'???'`, both rejected, no valid → `none`. Check `'BTC-USD'` → rejected.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: LLM client** (`llm.client.ts`)

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ApiError, GoogleGenAI, ThinkingLevel } from '@google/genai';

/**
 * The only file permitted to import an AI SDK, as yahoo.client.ts is for
 * Yahoo. Used for one job: routing a chat message to a predefined action
 * (assistant/router.ts). No analysis happens in the app — that goes to the
 * owner's Gemini Pro conversation as a copy-ready prompt.
 */
export interface JsonRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  timeoutMs: number;
}

export abstract class LlmClient {
  abstract isConfigured(): boolean;
  /** Parsed JSON from the model. Throws on timeout, provider error, empty or non-JSON output. */
  abstract generateJson(req: JsonRequest): Promise<unknown>;
}

@Injectable()
export class GeminiClient extends LlmClient {
  private readonly logger = new Logger(GeminiClient.name);
  private readonly apiKey = process.env.GEMINI_API_KEY ?? process.env.LLM_API_KEY ?? '';
  private readonly model = process.env.LLM_MODEL ?? 'gemini-3.6-flash';
  private client: GoogleGenAI | null = null;

  isConfigured(): boolean {
    return this.apiKey !== '';
  }

  async generateJson({ system, user, schema, timeoutMs }: JsonRequest): Promise<unknown> {
    if (!this.isConfigured()) throw new Error('LlmClient is not configured');
    const call = (thinking: boolean) =>
      this.ai().models.generateContent({
        model: this.model,
        contents: user,
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseSchema: schema,
          ...(thinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } } : {}),
        },
      });
    const response = await withTimeout(
      call(true).catch((err) => {
        // Some models reject an explicit thinking level; retry once without.
        if (err instanceof ApiError && err.status === 400 && /thinking/i.test(err.message)) return call(false);
        throw err;
      }),
      timeoutMs,
    );
    const text = response.text;
    if (!text) throw new Error('Gemini returned an empty response');
    try {
      return JSON.parse(text);
    } catch {
      this.logger.warn(`Gemini returned non-JSON: ${text.slice(0, 200)}`);
      throw new Error('Gemini returned non-JSON output');
    }
  }

  private ai(): GoogleGenAI {
    this.client ??= new GoogleGenAI({ apiKey: this.apiKey });
    return this.client;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Gemini timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
```

If `responseSchema` typing rejects a plain object, cast with `as never` at that one line and say so in a comment. `llm.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { GeminiClient, LlmClient } from './llm.client.js';

@Module({
  providers: [{ provide: LlmClient, useClass: GeminiClient }],
  exports: [LlmClient],
})
export class LlmModule {}
```

- [ ] **Step 6: Client unit test** (`llm.client.spec.ts`): only the pure helpers that need no network — `new GeminiClient().isConfigured()` is false when both env vars are unset (set/unset `process.env` around the test, restoring after), and `generateJson` rejects with "not configured" without a key. Do not mock the SDK beyond that.

- [ ] **Step 7: Run** `cd backend && npx vitest run src/assistant/router.spec.ts src/llm && npx tsc --noEmit -p tsconfig.json` → PASS.

- [ ] **Step 8: Commit** `feat(assistant): free-Gemini router client and output validation`

---

### Task 2: Assistant executes routed actions in bulk

**Files:**
- Modify: `backend/src/assistant/assistant.service.ts` (rewrite), `assistant.module.ts`, `assistant.service.spec.ts` (rewrite), `backend/test/assistant.e2e-spec.ts` (rewrite)
- Delete: `backend/src/assistant/parse.ts`, `parse.spec.ts`

**Interfaces — Consumes:** `LlmClient`, `ROUTER_SYSTEM`, `ROUTER_SCHEMA`, `toIntent`, `RouterIntent` (Task 1); `HoldingsService.find/set/remove/list`; `WatchlistService.add/remove/list`; `InstrumentsService.findOrCreate` (throws `NotFoundException` when unknown); `buildPrompt` (prompt.ts, unchanged).
**Produces:**

```ts
export type AssistantReply =
  | { kind: 'done'; message: string }
  | { kind: 'prompt'; text: string; note?: string }
  | { kind: 'error'; message: string };
export const ROUTER_TIMEOUT_MS = 5000;
export const FALLBACK_NOTE = "Couldn't read that automatically — here's a prompt instead.";
```

Summary message: group lines joined with `\n`, in this order, empty groups omitted, each `"<Label>: SYM, SYM"`:

| Action | Groups (label → when) |
|---|---|
| buy | `Added (long)` → newly set LONG · `Already held` → `holdings.find` not null · `Couldn't find` → findOrCreate NotFound, plus `rejected` |
| sell | `Sold and moved to watchlist` → removed and watched (or already watched) · `Sold (watchlist full, not added)` → removed but watchlist.add threw BadRequest · `Not held` → remove returned false · `Couldn't find` → `rejected` |
| watch | `Watching` → added · `Already watching` → `added: false` · `Watchlist full, not added` → BadRequest · `Couldn't find` → NotFound, plus `rejected` |
| unwatch | `Stopped watching` → removed · `Not on watchlist` → false · `Couldn't find` → `rejected` |

`sell` and `unwatch` do not call Yahoo for validation (nothing is created). `buy` validates with `findOrCreate` (5 at a time) before `holdings.set`; `watch` relies on `watchlist.add`'s own validation (sequential).

- [ ] **Step 1: Failing unit tests** (`assistant.service.spec.ts`) with plain mocks:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AssistantService, FALLBACK_NOTE } from './assistant.service.js';

function make(llm: { isConfigured?: () => boolean; generateJson: (...a: unknown[]) => Promise<unknown> }, over: Record<string, unknown> = {}) {
  const holdings = { find: vi.fn(async () => null), set: vi.fn(async (s: string) => ({ symbol: s, direction: 'LONG', previous: null })), remove: vi.fn(async () => true), list: vi.fn(async () => []) , ...(over.holdings as object) };
  const watchlist = { add: vi.fn(async (s: string) => ({ added: true, symbol: s })), remove: vi.fn(async () => true), list: vi.fn(async () => []), ...(over.watchlist as object) };
  const instruments = { findOrCreate: vi.fn(async (s: string) => { if (s.startsWith('ZZZZ')) throw new NotFoundException(); return { id: s, symbol: s }; }) };
  const service = new AssistantService(holdings as never, watchlist as never, instruments as never, { isConfigured: () => true, ...llm } as never);
  return { service, holdings, watchlist };
}

describe('AssistantService', () => {
  it('buy: adds new, reports already held and unknown', async () => {
    const { service, holdings } = make(
      { generateJson: async () => ({ action: 'buy', symbols: ['LMND', 'NVDA', 'ZZZZ', 'Lemonade'] }) },
      { holdings: { find: vi.fn(async (s: string) => (s === 'NVDA' ? 'LONG' : null)) } },
    );
    expect(await service.handle('Bought: LMND NVDA ZZZZ Lemonade')).toEqual({
      kind: 'done',
      message: 'Added (long): LMND\nAlready held: NVDA\nCouldn\'t find: ZZZZ, LEMONADE',
    });
    expect(holdings.set).toHaveBeenCalledTimes(1);
  });

  it('sell: removes and watches; not held is reported and not watched', async () => {
    const { service, watchlist } = make(
      { generateJson: async () => ({ action: 'sell', symbols: ['LMND', 'TSLA'] }) },
      { holdings: { remove: vi.fn(async (s: string) => s === 'LMND') } },
    );
    expect(await service.handle('sold LMND and TSLA')).toEqual({
      kind: 'done',
      message: 'Sold and moved to watchlist: LMND\nNot held: TSLA',
    });
    expect(watchlist.add).toHaveBeenCalledWith('LMND');
    expect(watchlist.add).not.toHaveBeenCalledWith('TSLA');
  });

  it('sell with a full watchlist still sells and says so', async () => {
    const { service } = make(
      { generateJson: async () => ({ action: 'sell', symbols: ['LMND'] }) },
      { watchlist: { add: vi.fn(async () => { throw new BadRequestException('full'); }) } },
    );
    expect(await service.handle('sold LMND')).toEqual({ kind: 'done', message: 'Sold (watchlist full, not added): LMND' });
  });

  it('watch: added, already, full and unknown in one batch', async () => {
    const add = vi.fn(async (s: string) => {
      if (s === 'AMD') return { added: false, symbol: s };
      if (s === 'SMCI') throw new BadRequestException('full');
      if (s === 'ZZZZ') throw new NotFoundException();
      return { added: true, symbol: s };
    });
    const { service } = make({ generateJson: async () => ({ action: 'watch', symbols: ['NVDA', 'AMD', 'SMCI', 'ZZZZ'] }) }, { watchlist: { add } });
    expect(await service.handle('watch NVDA AMD SMCI ZZZZ')).toEqual({
      kind: 'done',
      message: "Watching: NVDA\nAlready watching: AMD\nWatchlist full, not added: SMCI\nCouldn't find: ZZZZ",
    });
  });

  it('unwatch: stopped and not on watchlist', async () => {
    const { service } = make(
      { generateJson: async () => ({ action: 'unwatch', symbols: ['NVDA', 'AMD'] }) },
      { watchlist: { remove: vi.fn(async (s: string) => s === 'NVDA') } },
    );
    expect(await service.handle('unwatch NVDA, AMD')).toEqual({ kind: 'done', message: 'Stopped watching: NVDA\nNot on watchlist: AMD' });
  });

  it('none → prompt without a note', async () => {
    const { service } = make({ generateJson: async () => ({ action: 'none', symbols: [] }) });
    const reply = await service.handle('what about semis', new Date('2026-10-28T12:00:00Z'));
    expect(reply).toMatchObject({ kind: 'prompt' });
    expect(reply).not.toHaveProperty('note');
  });

  it('a question never acts even if the model says buy', async () => {
    const { service, holdings } = make({ generateJson: async () => ({ action: 'buy', symbols: ['NVDA'] }) });
    expect((await service.handle('should I buy NVDA?')).kind).toBe('prompt');
    expect(holdings.set).not.toHaveBeenCalled();
  });

  it('model failure → prompt with the fallback note, no writes', async () => {
    const { service, holdings } = make({ generateJson: async () => { throw new Error('429'); } });
    const reply = await service.handle('bought LMND');
    expect(reply).toMatchObject({ kind: 'prompt', note: FALLBACK_NOTE });
    expect(holdings.set).not.toHaveBeenCalled();
  });

  it('no API key → prompt with the fallback note, model not called', async () => {
    const generateJson = vi.fn();
    const { service } = make({ isConfigured: () => false, generateJson });
    expect(await service.handle('bought LMND')).toMatchObject({ kind: 'prompt', note: FALLBACK_NOTE });
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('sends only the message and the router instruction to the model', async () => {
    const generateJson = vi.fn(async () => ({ action: 'none', symbols: [] }));
    const { service } = make({ generateJson });
    await service.handle('hello there');
    expect(generateJson).toHaveBeenCalledWith(expect.objectContaining({ user: 'hello there', timeoutMs: 5000 }));
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** Rewrite `assistant.service.ts`:

```ts
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
    return { kind: 'done', message: await this.execute(intent) };
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
```

`assistant.module.ts`: imports `HoldingsModule, WatchlistModule, InstrumentsModule, LlmModule` (drop `TypeOrmModule.forFeature([DailyClose])` and `MarketDataModule`). Delete `parse.ts` and `parse.spec.ts`. Keep `moving-average.ts` and `HistoryService.ensureDepth` (spec: unused, kept for later).

- [ ] **Step 4: Run unit tests → PASS.**

- [ ] **Step 5: Rewrite e2e** (`backend/test/assistant.e2e-spec.ts`): same harness as now, plus `.overrideProvider(LlmClient).useValue(llmStub)` where

```ts
const routes: Record<string, unknown> = {
  'bought LMND and NVDA': { action: 'buy', symbols: ['LMND', 'NVDA'] },
  'Bought: 1. TSLA 2. ZZZZ': { action: 'buy', symbols: ['TSLA', 'ZZZZ'] },
  'sold LMND': { action: 'sell', symbols: ['LMND'] },
  'sold AAPL': { action: 'sell', symbols: ['AAPL'] },
  'watch AMD': { action: 'watch', symbols: ['AMD'] },
  'unwatch AMD': { action: 'unwatch', symbols: ['AMD'] },
  'should I buy NVDA?': { action: 'buy', symbols: ['NVDA'] },
};
const llmStub = {
  isConfigured: () => true,
  generateJson: async ({ user }: { user: string }) => {
    if (user === 'model is down') throw new Error('503');
    return routes[user] ?? { action: 'none', symbols: [] };
  },
};
```

Cases (exact messages from Task 2's table): buy two → `Added (long): LMND, NVDA`; repeat → `Already held: LMND, NVDA`; numbered buy with unknown → `Added (long): TSLA\nCouldn't find: ZZZZ` and ZZZZ not saved; `sold LMND` → `Sold and moved to watchlist: LMND`, then `GET /holdings` lacks LMND and `GET /watchlist` contains LMND; `sold AAPL` (not held) → `Not held: AAPL` and AAPL not on the watchlist; watch/unwatch AMD; `should I buy NVDA?` → prompt and NVDA not held; `model is down` → prompt with `note` equal to the fallback note; free text → prompt containing holdings and watchlist; empty/oversized text → 400. Truncate `holdings, watchlist_items, daily_closes` in `beforeEach`.

- [ ] **Step 6: Run** `cd backend && npx tsc --noEmit -p tsconfig.json && npm test && npm run test:e2e` → PASS.

- [ ] **Step 7: Commit** `feat(assistant): route chat with free Gemini; bulk buy/sell/watch/unwatch`

---

### Task 3: Chat screen renders the new replies

**Files:** Modify `frontend/src/api/assistant.ts`, `frontend/src/routes/Chat.tsx`, `frontend/src/routes/Chat.spec.tsx`.

**Interfaces — Consumes:** `AssistantReply` from Task 2 (copy the union exactly into `api/assistant.ts`).

- [ ] **Step 1: Tests first** in `Chat.spec.tsx`: remove the confirm/flip and answer tests; add:
  - a multi-line `done` reply (`'Added (long): LMND\nAlready held: NVDA'`) renders both lines (assert each line text is visible; the element has class `whitespace-pre-line`);
  - a `prompt` reply with `note` shows the note text above "Prompt for Gemini";
  - a `prompt` without `note` shows no note.
  Keep the send/clear, failure-keeps-text, Shift+Enter, Copy, copy-failure, disabled-while-pending and stale-reply tests (adjust any that used confirm).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** `api/assistant.ts`: the new union. `Chat.tsx`: remove the `flip` mutation, `Shown`/`flipped`, confirm and answer branches, and the `setHolding` import; `busy` becomes `send.isPending`; `done` renders `<p className="whitespace-pre-line">{reply.message}</p>`; `prompt` renders `{reply.note && <p className="text-muted">{reply.note}</p>}` before the heading row. Keep invalidating `HOLDINGS_KEY` and `WATCHLIST_KEY` on success.
- [ ] **Step 4: Run** `cd frontend && npx tsc -b && npm test && npx vite build` → PASS.
- [ ] **Step 5: Commit** `feat(chat): multi-line summaries and fallback note`

---

### Task 4: Browser server stub, browser tests, docs, deploy config

**Files:** Modify `backend/src/main.e2e.ts`, `e2e/chat.spec.ts`, `AGENTS.md`, `docs/ai-configuration.md`, `docs/api.md`, `docs/current-state.md`, `render.yaml`, `.env.example`.

- [ ] **Step 1: `main.e2e.ts`** — add `.overrideProvider(LlmClient).useValue(...)` with a stub whose `generateJson` maps: `'bought NVDA'` → buy NVDA; `'sold NVDA'` → sell NVDA; `'watch AAPL'` → watch AAPL; `'Bought: 1. AMD 2. SMCI'` → buy AMD, SMCI; anything else → none. Comment why (no real model in browser tests).
- [ ] **Step 2: `e2e/chat.spec.ts`** — keep the buy→Holdings flow (expect `Added (long): NVDA`), then `sold NVDA` → `Sold and moved to watchlist: NVDA` and the Watch screen shows `watch-NVDA`; a pasted list `Bought: 1. AMD 2. SMCI` → both rows on Holdings; free text → "Prompt for Gemini" with `My watchlist:` containing AAPL after `watch AAPL`. Remove the moving-average test.
- [ ] **Step 3: Run** `npm run test:browser` (repo root) → PASS; read the full output.
- [ ] **Step 4: Docs/config.** `AGENTS.md`: add back the rule "`backend/src/llm/llm.client.ts` is the only AI SDK import boundary; the app uses AI only to route chat messages (assistant/router.ts), never for analysis"; update the chat description. `docs/ai-configuration.md`: describe the router (model, keys `GEMINI_API_KEY`/`LLM_API_KEY`, `LLM_MODEL`, 5 s timeout, fallback, what is sent). `docs/api.md`: new `AssistantReply` union and summary groups. `docs/current-state.md`: chat routed by free Gemini; MA check removed from chat. `render.yaml`: add `- key: GEMINI_API_KEY` with `sync: false`. `.env.example`: add commented `GEMINI_API_KEY=` and `LLM_MODEL=gemini-3.6-flash`.
- [ ] **Step 5: Run** `cd backend && npm test` (doc-only edits shouldn't affect it) → PASS.
- [ ] **Step 6: Commit** `test+docs: chat router in browser tests and docs`

---

### Task 5: Release (controller)

- [ ] Full verification: `npm test && npm run test:e2e --prefix backend && npm run test:browser && (cd backend && npx tsc -p tsconfig.build.json --noEmit) && (cd frontend && npx tsc -b)`.
- [ ] Push `main`; wait for `deploy-web` success.
- [ ] Mac host: checkout `origin/main` in `~/trader-mac-host`, `npm ci --include=dev && npm run build` in `backend/`, `launchctl kickstart -k gui/$(id -u)/com.trader.api`; confirm `LLM_API_KEY`/`LLM_MODEL` are in `~/.config/trader-host/prod.env`.
- [ ] Live check with a throwaway account against the real model: `Bought: 4. GSIT 5. USAR 6. LMND`, `I bought: META`, `sold META`, `watch NVDA and AMD`, `should I buy NVDA?`, a free-text question; then clean up the throwaway data.
