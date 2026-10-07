# Brief Redesign — Slice 4 (AI Summary + Thesis Check) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The single AI call per brief returns two things:
- a one-or-two-sentence **summary** of the most important thing today;
- a one-line **thesis check** per mover, which weighs the owner's own entry note and reasons against the move and its headline.

The thesis line fills the `thesis` field that slice 3 shipped as `null`. The response's `narrative`/`narrativeAt` are renamed `summary`/`summaryAt` to match the spec.

**Architecture:**
- The model answers in a small tagged text format: `SUMMARY:` followed by one `THESIS <SYMBOL>:` line per mover.
- A pure parser in `backend/src/llm/daily-brief-answer.ts` reads that answer. It tolerates a malformed answer: the whole text becomes the summary and there are no thesis lines.
- Thesis lines are only accepted for symbols that are actually movers.
- `TradesService.openTradeEntries()` also returns the opening entry's note (journal `body`), so the facts can quote it.
- The existing per-user narrative cache now stores `{ summary, thesis }`. Its signature is unchanged (session, queue, movers + headline URL, watch triggers, macro).

**Tech Stack:** NestJS, Gemini via `backend/src/llm/llm.client.ts` (the only AI SDK boundary), React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-06-brief-redesign-design.md`, section "AI". This is delivery slice 4 of 4. Slices 1–3 are shipped.

## Global Constraints

- Read `AGENTS.md` and `backend/src/llm/prompts.ts`. The system role's "never invent or recompute a number" rule is unchanged and is reused through `buildSystemPrompt`.
- There is still **one** AI call per brief, plus the cache. No per-mover calls.
- The model only gets facts the backend already computed. The owner's note is quoted verbatim, truncated to 300 characters with `…`.
- An AI failure, an unconfigured AI, or an unparseable answer must never break the brief. In each case `summary` is null or holds the raw text as specified, and `thesis` stays null. Chips and headlines render as before.
- A thesis line for a symbol that is not a mover is discarded, never shown.
- The frontend renders `summary` (Markdown, as today) and `thesis` (plain text) verbatim.
- Per-user reads stay filtered by `userId`. The new `note` comes from the same user-filtered journal read.
- Tests never call an LLM or the network.
- Never touch the real `trader` DB destructively.
- Commits use `feat(brief): …`, are made locally on `main`, and are not pushed. End every commit message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KSLpjvWMhkHqfbWoTYBnE1
  ```

## Review Focus

1. **The model ignores the format and writes prose.** Expected: the prose becomes `summary`, and every `thesis` is null. Pinned in Task 1.
2. **The model writes a THESIS line for a symbol that isn't a mover, or names it in lowercase.** Expected: a non-mover is dropped. Symbol matching is case-insensitive and the stored key uses the mover's own casing. Pinned in Task 1.
3. **The cached answer is reused after a mover's headline changes.** Expected: it is not reused, because the signature already includes the headline URL. A rank swap alone still reuses it. Pinned in Task 3; the existing slice-3 tests must still pass.
4. **A weekend or closed session.** Expected: the prompt tells the model that the moves are from the last session, not "today". Pinned in Task 1 through the prompt text.
5. **The owner's note is very long or empty.** Expected: it is truncated at 300 characters with `…`. An empty note writes `No entry note.` Pinned in Task 2.

---

### Task 1: Prompt and answer parser

**Files:**
- Modify (rewrite): `backend/src/llm/daily-brief-prompt.ts`, `backend/src/llm/daily-brief-prompt.spec.ts`
- Create: `backend/src/llm/daily-brief-answer.ts`, `backend/src/llm/daily-brief-answer.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // daily-brief-prompt.ts
  export function buildDailyBriefUserPrompt(factsBlock: string, moverSymbols: readonly string[]): string;
  // daily-brief-answer.ts
  export interface DailyBriefAnswer { summary: string | null; thesis: Record<string, string> }
  export function parseDailyBriefAnswer(text: string, moverSymbols: readonly string[]): DailyBriefAnswer;
  ```

- [ ] **Step 1: Write the failing tests**

`daily-brief-answer.spec.ts`:

```ts
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
});
```

`daily-brief-prompt.spec.ts` (replace the file):

```ts
import { describe, expect, it } from 'vitest';
import { buildDailyBriefUserPrompt } from './daily-brief-prompt.js';

describe('buildDailyBriefUserPrompt', () => {
  it('carries the exact facts block through untouched', () => {
    const facts = 'FACTS (daily brief as of 2026-09-16T14:00:00.000Z)\n- something';
    expect(buildDailyBriefUserPrompt(facts, [])).toContain(facts);
  });

  it('asks for a prioritized summary, not a restatement', () => {
    const prompt = buildDailyBriefUserPrompt('f', []);
    expect(prompt).toMatch(/prioritized/i);
    expect(prompt).toContain('SUMMARY:');
  });

  it('asks for one thesis line per mover, by symbol, and only for those', () => {
    const prompt = buildDailyBriefUserPrompt('f', ['NVDA', 'MSTR']);
    expect(prompt).toContain('THESIS NVDA:');
    expect(prompt).toContain('THESIS MSTR:');
    expect(prompt).toMatch(/only for these symbols/i);
  });

  it('asks for no thesis lines when nothing moved', () => {
    expect(buildDailyBriefUserPrompt('f', [])).not.toContain('THESIS');
  });

  it('warns that a closed-session brief describes the last session, not today', () => {
    expect(buildDailyBriefUserPrompt('f', [])).toMatch(/market session is CLOSED.*last session/is);
  });
});
```

Run: `cd backend && npx vitest run src/llm/daily-brief-answer.spec.ts src/llm/daily-brief-prompt.spec.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

`daily-brief-answer.ts`:

```ts
/**
 * Reads the Daily Brief's one model answer: a SUMMARY plus one THESIS line
 * per mover. Pure and forgiving — a model that ignores the format still
 * yields its prose as the summary, and a thesis line for a symbol that is
 * not a mover is dropped rather than shown, so the model can never attach
 * an opinion to a position the app did not put in front of it.
 */
export interface DailyBriefAnswer {
  summary: string | null;
  thesis: Record<string, string>;
}

const SUMMARY = /^\s*\**\s*SUMMARY\s*:\s*\**\s*/i;
const THESIS = /^\s*\**\s*THESIS\s+([A-Za-z0-9.^-]+)\s*:\s*\**\s*(.*)$/i;

export function parseDailyBriefAnswer(text: string, moverSymbols: readonly string[]): DailyBriefAnswer {
  const bySymbol = new Map(moverSymbols.map((s) => [s.toUpperCase(), s]));
  const thesis: Record<string, string> = {};
  const summaryLines: string[] = [];
  let inThesis = false;

  for (const line of text.split('\n')) {
    const match = THESIS.exec(line);
    if (match) {
      inThesis = true;
      const symbol = bySymbol.get(match[1].toUpperCase());
      const body = match[2].trim();
      if (symbol && body && !(symbol in thesis)) thesis[symbol] = body;
      continue;
    }
    if (!inThesis) summaryLines.push(line.replace(SUMMARY, ''));
  }

  const summary = summaryLines.join('\n').trim();
  return { summary: summary === '' ? null : summary, thesis };
}
```

`daily-brief-prompt.ts` (rewrite):

```ts
/**
 * The Daily Brief's user turn: an instruction plus the facts block from
 * daily-brief-context.ts. Shares prompts.ts's system role (same trader,
 * same "never invent a number" discipline). Asks for ONE answer in a small
 * tagged format that daily-brief-answer.ts parses: a summary, then one
 * thesis line per mover — one model call for the whole brief.
 */
export function buildDailyBriefUserPrompt(factsBlock: string, moverSymbols: readonly string[]): string {
  const thesisSpec =
    moverSymbols.length === 0
      ? ''
      : `

Then, for each mover, one line weighing MY entry note and reasons against
the move and its headline: does my original thesis still hold, is it in
question, or is the move unrelated to why I entered? One sentence each,
only for these symbols, in this order:
${moverSymbols.map((s) => `THESIS ${s}: <one sentence>`).join('\n')}`;

  return `Turn today's brief into a short, prioritized read — not a list read
back to me, a judgement about what actually matters.

Start with a line beginning "SUMMARY:" — lead with the single fact most
worth my attention right now (something in Needs attention first, if
anything is there), and only if it adds something the facts alone do not,
connect two facts. One or two sentences.${thesisSpec}

If the market session is CLOSED, the moves and headlines are from the
last session — do not call them "today".

${factsBlock}`;
}
```

- [ ] **Step 3: Run the tests and type-check**

Run: `cd backend && npx vitest run src/llm && npx tsc --noEmit -p tsconfig.json`

Expected: the two new specs pass. tsc **will** error in `daily-brief.service.ts`, because it calls `buildDailyBriefUserPrompt(facts)` with a single argument. Task 3 fixes that call; confirm that it is the only error.

- [ ] **Step 4: Commit**

`feat(brief): one-call prompt for a summary plus a thesis line per mover, and its parser`

---

### Task 2: The owner's entry note reaches the facts

**Files:**
- Modify: `backend/src/portfolio/trades.service.ts`, `backend/src/portfolio/trades.service.open-entries.spec.ts`
- Modify: `backend/src/llm/daily-brief-context.ts`, `backend/src/llm/daily-brief-context.spec.ts`

**Interfaces:**
- `openTradeEntries()` items gain `note: string`. It is the opening entry's `body`, or `''` when there is no entry.
- `ContextMover` gains `reasons: string[]` (labels) and `note: string`.

- [ ] **Step 1: Write the failing tests**

- In `trades.service.open-entries.spec.ts`:
  - Give the stub entry `body: 'Broke out of a 3-month base on 2x volume.'`.
  - Assert `note` equals that string in the first test.
  - Assert `note: ''` in the no-entry test.
- In `daily-brief-context.spec.ts`:
  - Add `reasons: []` and `note: ''` to existing mover fixtures.
  - Add:

```ts
  it('quotes the owner\'s entry reasons and note under each mover, truncating a long note', () => {
    const long = 'x'.repeat(320);
    const facts = buildDailyBriefContext(input({
      movers: [
        { symbol: 'NVDA', changePct: 0.042, atrMultiple: 2.31, dollarChange: 1234.5, extended: false, stale: false,
          headline: null, reasons: ['Breakout', 'Volume'], note: 'Broke out of a 3-month base.' },
        { symbol: 'MRNA', changePct: 0.03, atrMultiple: 1.2, dollarChange: -600, extended: false, stale: false,
          headline: null, reasons: [], note: long },
        { symbol: 'AMD', changePct: 0.02, atrMultiple: 1.1, dollarChange: 100, extended: false, stale: false,
          headline: null, reasons: [], note: '' },
      ],
    }));
    expect(facts).toContain('  Entry reasons: Breakout, Volume. Entry note: "Broke out of a 3-month base."');
    expect(facts).toContain(`  Entry reasons: none recorded. Entry note: "${'x'.repeat(300)}…"`);
    expect(facts).toContain('  Entry reasons: none recorded. No entry note.');
  });
```

Run both specs. Expected: FAIL.

- [ ] **Step 2: Implement**

- In `openTradeEntries`:
  - Build `const bodyById = new Map(entries.map((e) => [e.id, e.body]))` next to `reasonsById`.
  - Add `note: bodyById.get(t.fills[0]?.entryId ?? '') ?? ''` to each item.
  - Update the return type.
- In `daily-brief-context.ts`:
  - Add `reasons: string[]; note: string;` to `ContextMover`.
  - In `moverLines`, after each mover's line, push a second line:
    ```ts
    const reasons = m.reasons.length > 0 ? m.reasons.join(', ') : 'none recorded';
    const note = m.note.trim() === ''
      ? 'No entry note.'
      : `Entry note: "${m.note.trim().length > 300 ? `${m.note.trim().slice(0, 300)}…` : m.note.trim()}"`;
    lines.push(`  Entry reasons: ${reasons}. ${note}`);
    ```
    Switch `moverLines` from `map` to `flatMap` as needed.

Run: `cd backend && npx vitest run src/llm src/portfolio`. Expected: PASS.

- [ ] **Step 3: Commit**

`feat(brief): the owner's entry reasons and note reach the AI facts for each mover`

---

### Task 3: Service — one call, summary + thesis, renamed fields

**Files:**
- Modify: `backend/src/market-data/daily-brief.service.ts`, `daily-brief.service.spec.ts`

**Interfaces:**
- `DailyBriefResponse`:
  - `narrative` is renamed `summary` and `narrativeAt` is renamed `summaryAt`, with the same semantics.
  - `movers[i].thesis` is filled from the answer when the model gave a line for that symbol.
- The cache entry becomes `{ signature, summary: string | null, thesis: Record<string, string>, at }`. The signature is unchanged.
- `BriefFacts.movers` must carry `reasons` (labels) and `note`. The service maps each `MoverRow`'s `reasons` to their labels, and takes `note` from `openTradeEntries`.

- [ ] **Step 1: Write the failing tests**

In `daily-brief.service.spec.ts`:
- Rename every `narrative`/`narrativeAt` assertion to `summary`/`summaryAt`. Keep the assertions themselves.
- Update the `tradesStub` entries so they carry `note`.
- Add:

```ts
  it('fills each mover\'s thesis from the one AI answer and the summary from its SUMMARY line', async () => {
    const complete = vi.fn().mockResolvedValue('SUMMARY: NVDA is running on the deal.\nTHESIS NVDA: The deal confirms your breakout thesis.');
    const llm = { isConfigured: () => true, complete } as any;
    // movers fixture as in the slice-3 movers tests: NVDA 2.5× ATR, entry reasons ['ENTRY_BREAKOUT'], note 'Base breakout.'
    const result = await service.get({ now: new Date('2026-10-07T15:00:00Z') });
    expect(result.summary).toBe('NVDA is running on the deal.');
    expect(result.movers[0].thesis).toBe('The deal confirms your breakout thesis.');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].user).toContain('THESIS NVDA:');
    expect(complete.mock.calls[0][0].user).toContain('Entry note: "Base breakout."');
  });

  it('reuses the cached thesis lines with the cached summary', async () => {
    // same service, two get() calls 5 minutes apart with unchanged facts → complete called once,
    // second result still has movers[0].thesis === 'The deal confirms your breakout thesis.'
  });

  it('keeps thesis null and the brief served when the AI fails', async () => {
    // complete rejects → summary null, every mover.thesis null, movers/headlines intact
  });
```

Build the movers fixture with the same `flat` bars, the `position()` helper and the `newsStub` used in the slice-3 movers `describe` block. Reuse those helpers. The two outlined tests must be written out in full, with real assertions.

Run the spec. Expected: FAIL.

- [ ] **Step 2: Implement**

In `daily-brief.service.ts`:
1. Rename the response fields and every internal use. `buildNarrative` becomes `buildAiTake`, and returns `{ summary: string | null; thesis: Record<string, string>; at: Date } | null`.
2. Build the user prompt with `buildDailyBriefUserPrompt(facts, facts.movers.map((m) => m.symbol))`. Parse the model's text with `parseDailyBriefAnswer(text, moverSymbols)`. Cache the parsed `{ summary, thesis }`. On a cache hit, return the cached pair.
3. After the AI take, set `movers = movers.map((m) => ({ ...m, thesis: take?.thesis[m.symbol] ?? null }))`, and return `summary: take?.summary ?? null`, `summaryAt: take ? take.at.toISOString() : null`.
4. When mapping movers into `BriefFacts`, include `reasons: m.reasons.map((r) => r.label)` and `note: openEntries.find((e) => e.symbol === m.symbol)?.note ?? ''`.
5. Keep the doc comments truthful: say "AI take" (summary plus thesis) where they say "narrative".

Run: `cd backend && npx vitest run src/market-data src/llm src/portfolio && npx tsc --noEmit -p tsconfig.json`, then `npm run test:e2e --prefix backend`.
Expected: PASS.

The e2e server stubs `LlmClient` to return a fixed `[RANK]` block for every call. The parser turns that into the summary with no thesis lines. If any e2e test asserts on `narrative`, update it.

- [ ] **Step 3: Commit**

`feat(brief): one AI answer fills the summary and each mover's thesis check`

---

### Task 4: Frontend — summary rename and the thesis line

**Files:**
- Modify: `frontend/src/api/dailyBrief.ts`, `frontend/src/routes/Brief.tsx`, `frontend/src/routes/Brief.spec.tsx`
- Modify: `frontend/src/components/brief/MoverList.tsx` (the thesis line already renders when it is non-null; check its styling)

- [ ] **Step 1: Write the failing tests**

In `Brief.spec.tsx`:
- Rename `narrative`/`narrativeAt` to `summary`/`summaryAt` in fixtures and assertions. Keep every assertion.
- The "AI take" region and its "AI take as of …" label stay as they are.
- Add:

```ts
it('shows the AI thesis check under a mover, labelled as AI', async () => {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue({
    ...initialBrief, movers: [{ ...initialBrief.movers[0], thesis: 'The deal confirms your breakout thesis.' }],
  });
  renderBrief();
  const movers = await screen.findByRole('region', { name: 'Movers' });
  expect(movers).toHaveTextContent('AI: The deal confirms your breakout thesis.');
});

it('shows no AI line under a mover when there is no thesis', async () => {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
  renderBrief();
  const movers = await screen.findByRole('region', { name: 'Movers' });
  expect(movers).not.toHaveTextContent('AI:');
});
```

Run the spec. Expected: FAIL.

- [ ] **Step 2: Implement**

- `dailyBrief.ts`: rename the two fields, keeping their doc comments.
- `Brief.tsx`: use `brief.summary` / `brief.summaryAt` wherever it used `narrative` / `narrativeAt`.
- `MoverList.tsx`: render a non-null `thesis` as `<p className="text-xs text-muted"><span className="font-medium text-accent">AI:</span> {thesis}</p>`. Keep this as display only; the "AI:" label is the page's own wording.
- `frontend/src/components/AppShell.tsx` only prefetches. Grep `frontend/src` for `narrative` and update any other consumer.

Run: `cd frontend && npx vitest run && npx tsc -b && cd .. && npm test && npm run test:browser`
Expected: PASS.

- [ ] **Step 3: Commit**

`feat(brief): show the AI thesis check under each mover; summary field renamed`
