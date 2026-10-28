# Trader Rebuild: Chat, Holdings, Watchlist

**Date:** 2026-10-28
**Status:** Design approved in conversation; awaiting written-spec review.

## Why

The owner built Trader and did not use it. Most of what it computed — cash,
balances, per-position P&L, performance — already lives in his broker, so the
app duplicated the broker and asked for data entry to keep the copy right.
The in-product AI ran on the free Gemini tier, which he considers the wrong
model for the job.

This rebuild keeps only what the broker cannot do for him and grows from there,
one case at a time.

## Principles (replacing the old core idea)

1. **Trader knows what you hold, never your numbers.** No quantities, prices
   paid, cash, balances, P&L or performance. The broker owns those.
2. **No AI calls inside the app.** When Trader cannot answer something itself,
   it produces a ready-to-paste prompt for the owner's single Gemini Pro
   conversation. Prompt content and format are deliberately minimal here and
   will be designed in a later session.
3. **One place to talk to it.** A chat-style screen is home. Input is text;
   voice is iPhone keyboard dictation, so the app only ever sees text.
4. **Grow by case.** Start with a small set of commands and one market-data
   answer; add each new kind of question as its own slice once the owner meets
   it in real use.

Still true from before: mobile-first (iPhone 16 Pro width), world-class UI bar,
no paid services, honest data (stale is labeled stale, missing is said, never
guessed), the frontend displays and the backend computes.

## Scope

### The app after the rebuild

Three screens, with a bottom navigation between them:

1. **Chat** (home). A single input box with a send button. The reply to the
   message just sent appears below it. Nothing is stored: each message is
   handled and forgotten (a command line, not a conversation log). Only the
   effects on holdings and watchlist persist.
2. **Holdings.** Symbols with a Long/Short label. Add, remove and flip are
   available here directly as well as through chat; removal uses the existing
   edit-mode plus second-tap confirmation pattern.
3. **Watchlist.** Symbols only. Add and remove, same patterns.

Both lists start empty. The owner tells Trader his holdings through chat.

### Chat commands (first version)

Parsing is a pure, deterministic function: case-insensitive, filler words
ignored, tickers only (no company-name lookup). English only.

| Message shape | Result |
|---|---|
| `bought X`, `buy X`, `long X` | Add X as LONG. |
| `short X`, `shorted X` | Add X as SHORT. |
| `sold X`, `closed X`, `covered X` | Remove X from holdings. |
| `watch X` | Add X to watchlist. |
| `unwatch X` | Remove X from watchlist. |
| `is X above N SMA` / `below`; also `EMA`, `MA`; `N` any positive integer | Market-data answer (below). |
| anything else | Gemini prompt (below). |

Edge cases:

- **Unknown ticker** on an add or watch: "I don't know the ticker X" — nothing
  is saved. Validation reuses `InstrumentsService`.
- **Remove something not held / not watched:** "You don't hold X" / "X isn't on
  your watchlist".
- **Add something already held in the same direction / already watched:**
  confirm without duplicating ("You already hold X long").
- **Direction conflict** (buy X while X is held short, or short X while held
  long): Trader does not guess. The reply asks and shows two buttons,
  **Flip to long/short** and **Cancel**; Flip calls the holdings endpoint
  directly, with no retyping.
- **Command words around an unrecognised shape** (e.g. "bought some
  lemonade" with no valid ticker) fall through to the Gemini prompt rather
  than erroring.

### Market-data answer: moving average check

`is GOOGL above 150 SMA` returns:

- the verdict (above / below),
- the current price and its session label (pre-market, after-hours, stale,
  as the existing price selection already reports),
- the average's value,
- the percentage distance of price from the average.

SMA and EMA come from the existing indicators code over cached daily closes.
If there are fewer closes than `N`, or no price is available, Trader says so
("Not enough history for a 300-day average on X" / "Couldn't get X's price right
now") and gives no verdict. This is the template for later market-data cases.

### Gemini prompt fallback (minimal)

Any unmatched message returns a prompt containing:

- the owner's message verbatim,
- today's date,
- current holdings as `SYMBOL (long|short)`,
- the watchlist symbols.

The reply shows the prompt text and a **Copy** button. No other context, no
profile document, no market numbers in v1; prompt design is a later session.

## Architecture

Approach: strip and rebuild inside the existing repo. Deployment (Cloudflare
Pages, Render, Neon, and the temporary Mac host) is unchanged.

### Backend

New module `backend/src/assistant/`:

- `parse.ts` — pure `parseMessage(text) -> Intent`, where `Intent` is one of
  `add-holding {symbol, direction}`, `remove-holding {symbol}`,
  `watch {symbol}`, `unwatch {symbol}`, `ma-check {symbol, comparator, period,
  kind: SMA|EMA}`, `unknown`. No I/O.
- `assistant.service.ts` — executes an intent and returns a typed reply.
- `assistant.controller.ts` — `POST /api/assistant {text}`.

Reply shape, one of:

- `{ kind: 'done', message }` — holdings or watchlist changed (or no-op).
- `{ kind: 'confirm', message, action }` — direction conflict; `action` is the
  holdings call the Flip button makes.
- `{ kind: 'answer', message, facts }` — market-data result; `facts` carries the
  numbers the frontend displays (price, session label, average, distance).
- `{ kind: 'prompt', text }` — the Gemini prompt.
- `{ kind: 'error', message }` — unknown ticker, data unavailable, not held.

New module `backend/src/holdings/`: entity `holdings` (`id`, `userId`,
`instrumentId`, `direction` LONG|SHORT, `createdAt`; unique on
`userId, instrumentId`), service, controller (`GET /api/holdings`,
`PUT /api/holdings/:symbol {direction}`, `DELETE /api/holdings/:symbol`),
with a registered TypeORM migration. Every query filters by the current user
via `usersService.currentUser()`.

Watchlist is reduced to symbol add/remove/list. The entity stops mapping the
target, note, tag and ranking columns; the columns and tables themselves stay
in the database.

Kept modules: `auth`, `users`, `instruments`, `health`, `database`,
`market-data` reduced to what quotes, daily closes, session labels and
indicators need.

Removed modules and code: `journal`, `transactions`, `portfolio`,
`performance`, `llm` (and the Gemini SDK dependency), the Brief
(`daily-brief*`, `brief-*`), watchlist ranking and scoring, fundamentals,
news, earnings, economic calendar, Finnhub client, and their tests. The
legacy-path allowlist in `main.ts` is updated for the new and removed routes.

**Data is kept.** No migration drops or truncates existing tables
(`transactions`, `journal_entries`, `cash_flows`, stops, rankings, etc.). They
become unused. Dropping them is a separate, later decision.

### Frontend

- Routes: `/` Chat, `/holdings`, `/watchlist`, plus Login. All other routes and
  their components are removed.
- Chat renders each reply kind; the Copy button uses the clipboard API.
- Reuses `Button`, `inputClasses`, `EditModeToggle`.

### Documentation

Rewrite `AGENTS.md` invariants, `docs/product-brief.md`, `docs/current-state.md`,
`docs/api.md` and `docs/ai-configuration.md` (the latter shrinks to "no
in-product AI; prompts only") to describe the new product. Historical specs and
plans stay as they are.

## Testing

- `parse.ts`: table-driven unit tests for every phrasing and edge case above,
  including fall-through to `unknown`.
- Backend e2e (against `trader_test`, Yahoo stubbed): holdings add/remove/flip
  and per-user isolation; watchlist add/remove; MA check with enough history,
  too little history, and no price; prompt fallback contents.
- Browser test (iPhone WebKit): send a buy, see it in Holdings; send an MA
  question; send free text and copy the prompt.
- Manual check of the real UI at 402px before handoff.

## Rollout

Built and tested locally. When pushed, the frontend deploys to Pages. While
Render is suspended, the Mac host worktree is moved to the new commit and
rebuilt; its start script runs the new `holdings` migration on Neon. When
Render returns, it is deployed and verified before the frontend is pointed back
at it.

## Out of scope for this rebuild

Conversation history, notes or memory; prompt design; other market-data
questions (price, earnings, list scans) until the owner asks for them; voice
beyond keyboard dictation; Hebrew; seeding from old data; dropping old tables;
target prices on the watchlist.
