# Backlog

Everything raised and not yet done. Newest intake at the top of each section.
Finished items are removed once the work is committed — this file is meant to
be read as "what's left," not a history of what happened (that's `git log`).

**Read this before picking up work.** `CLAUDE.md` says what the project is;
this says what is outstanding.

## Bugs — correctness

- [ ] **Trade chart shows prices that are visibly wrong.** Called out as a basic
  feature that must be right. Needs its own investigation; do not patch symptoms.
  Worth re-checking after the freshness fix, for the same reason.
- [ ] **Stop Plan editor shows entry-anchored risk, not give-back-from-here.**
  Found on VST: entry $141.26, current $148.41, draft stop $139.51 x100
  showed "Total risk $175.00" (`(avgEntry - stop) x qty`, `computeRisk`) when
  the design doc (`2026-09-03-stop-executions-design.md`, "At risk, shown per
  tier") explicitly settled on give-back-from-here — `(currentPrice - stop) x
  qty`, `computeRiskFromCurrentPrice` — as "the number that matters when
  deciding what to do today," which is what the Stops headline and
  Dashboard's At-risk box already use. Correct figure here is $890.00.
  Root cause: `StopPlanEditor` (editing stops on an open, already-moved
  position) reuses `EntrySheet`'s `StopLevelEditor` / `useStopRisk` /
  `POST /portfolio/stop-risk`, which is entry-anchored — right for the entry
  sheet, wrong for this screen. Needs the draft priced from current price
  (and high-water price, for trailing tiers) when editing an existing
  position; entry sheet keeps pricing from entry.

## UI

- [ ] **2 of 19 frontend lint warnings remain**, both `set-state-in-effect`
  (`EntrySheet.tsx:105`, `Journal.tsx:378`). Left deliberately: both are
  effects synchronizing local state with genuine external events (which
  entry/draft session is active; an async fetch resolving) rather than
  derivable-during-render state, and forcing either into a render-time or
  remount pattern would touch the app's most iOS-draft-loss-prone code for a
  cosmetic warning. The other 17 were fixed at the root: `BenchmarkChart.tsx`
  and `TradeChart.tsx` (`Range`/`Point`/`RANGES` moved to
  `lib/benchmarkRange.ts`; `TradeChart`'s replay `step` now resets via
  remount — `TradeDetail` keys it on trade id — instead of a reset effect)
  and `Journal.tsx`'s 12 `react(refs)` warnings (the `restored` value moved
  from a mutated ref to a plain `useState` capture, with a `restoreDone` flag
  replacing the "null the ref to mark consumed" trick).
- [ ] **The trade-idea result buries its numbers** under ~400 words of prose.
  A compact verdict strip above the writing, prose collapsible below.
- [ ] **Look hard at the UI as a whole.** More conventional components? Study
  comparable products and decide what the right shape actually is.

## The trade-idea prompt (design agreed, not built)

Approved in conversation, no code yet. The failure that motivated it: an
opinion on buying BITX that lectured the owner about having no crypto in his
profile, while he held 4,600 shares of it. It answered "should I open this?"
when the question was "should I add to this winner?".

- [ ] **Check the enlarged prompt actually improved the answer.** It is
  materially longer now; re-ask BITX and confirm it reads as an add/trim
  decision, and that the extra context sharpened rather than diluted it.
- [ ] **Ideas answers are slow.** Look at streaming, a smaller model for the
  first pass, or cutting prompt size.

## Tech debt

Raised as a block; each needs its own slice.

- [ ] Replace hand-rolled code where a library does it properly. Check what is
  actually maintained before adopting anything.
- [ ] Remove duplicated tests — an e2e test may already cover what a unit test
  asserts.
- [ ] **Major dependency upgrades.** Wanted, but deliberately not bundled with
  the security patch in `0e2cb55` — a green suite after six majors at once
  proves nothing about any one of them. Take them in separate commits, in
  roughly this order, easiest to hairiest:

  | Upgrade | From → to | What to watch |
  |---|---|---|
  | `@types/node` | 24 → 26 | Types only. Should be noise; if it is not, that is informative. |
  | `@testing-library/jest-dom` | 6 → 7 | Matcher signatures. Test-only. |
  | `jsdom` | 27 → 30 | The DOM tests lean on it (`EntrySheet`, `Journal`, `persistentState`). Watch `localStorage` and timer behaviour. |
  | `vite-tsconfig-paths` | 5 → 6 | Path alias resolution; both vitest configs load it. Vite 8 may resolve paths natively now — the plugin already prints a deprecation notice, so this may be a deletion rather than an upgrade. |
  | `vitest` + `@vitest/coverage-v8` | 4 → 5 | Must move together. The blob-report merge behind `test:cov:all` is the fragile part, along with `--merge-reports`. |
  | `typescript` | 6 → 7 | Last and alone. New inference and stricter checks reach every file, and both packages compile with different strictness. |

  Do not run `nest build` while `npm run dev` is running while doing this —
  it wipes `dist` under the watcher and looks like an upgrade breaking the app
  when it is not.

- [ ] **Still unprobed**: date-range validation (`?from=hello` returns 200 and
  silently filters everything out rather than 400), and concurrent edits to
  the same journal entry.
- [ ] A pass for best practices — interfaces, generics, inheritance where they
  genuinely earn their place.
- [ ] `getPortfolio` (`portfolio.service.ts`) is still ~240 lines — it fetches,
  derives, prices, resolves trailing stops and assembles a response in one
  method. Next candidate for the same by-question split that produced
  `TradesService` and `SeedService`.
- [ ] Loosen tight coupling.
- [ ] Documentation and `.md` files aimed at agent integration.
- [ ] Review sync vs async boundaries.
