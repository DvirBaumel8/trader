# Stop Executions — Design

**Date:** 2026-09-03
**Status:** Approved, not yet planned

## The problem

A stop tier is recorded when a position is opened and is never touched
again. When a stop actually fires, nothing anywhere records that it fired.
The app infers it: `computeEffectiveStops` matches a reducing fill to the
tier whose price is closest and calls that tier consumed.

That inference is right often enough to be dangerous. Checking the owner's
ten historical exits by hand found one it would have got wrong — MSTR, where
the only tier was a trailing stop and the exit was above it. A price matcher
has no way to know the difference between "my stop fired" and "I sold near
where my stop happened to be", and the two mean opposite things about how a
trader is performing.

Four things depend on knowing which it was:

1. **An honest stop plan.** A tier that fired should leave the live plan as a
   recorded fact, not as a guess that could be re-derived differently
   tomorrow.
2. **Exit statistics.** How often exits are forced versus chosen is a real
   signal about discipline, and it is unanswerable today.
3. **Correct R.** Which tier fired determines which risk the result is
   measured against on a scaled position.
4. **A readable record.** "Stop at 36.92 hit on Aug 30" should be visible on
   the trade.

## Decisions

**No profit targets.** The owner does not use them. Every tier is a genuine
stop, including one raised above entry to lock in a gain — which is what
SMCI's 36.92 tier was. Nothing in the model needs a second concept, and
adding one would have been a feature nobody asked for.

**R stays anchored to entry.** Recording executions tells us *which* tier
fired; it does not redefine R. R remains result over dollar-risk-at-entry,
because that is the only definition comparable across trades, and because a
stop raised above entry would otherwise make risk negative and R undefined.
Invariant 3 and the expectancy stat are unaffected.

**The app guesses, the owner confirms.** The entry sheet pre-selects the
closest tier when a journal entry reduces a stopped position. One tap
accepts. The stored record is always an explicit human decision — the
matcher only ever supplies the default.

**At risk keeps its current formula** — `(current − stop) × shares` — and
gains a per-tier column on the Stops table. See below.

**No review screen for history.** Ten rows do not justify a screen. The
historical attributions were settled by hand and are applied by SQL, once.

## Schema

One migration:

**`stop_executions`** — the confirmed link between a fill and the tier it
executed.

| column | notes |
|---|---|
| `id` | uuid |
| `stopLevelId` | FK to `stop_levels` |
| `transactionId` | FK to `transactions` |
| `quantity` | numeric; less than the tier's own quantity for a partial fill |
| `confirmedAt` | timestamp |

Indexed on `transactionId` and on `stopLevelId`.

A partial fill is one row with a smaller quantity. A fill spanning two tiers
is two rows. This is why the link is its own table rather than a column: a
column can express neither.

**`transactions.exitKind`** — nullable, `STOP` or `DISCRETIONARY`. `null`
means the exit has not been classified. Exit statistics count only
non-null rows and state how many are outstanding, so they can never imply
a completeness they do not have.

**Backfill `stop_levels.createdAt`.** It is `NULL` on every existing row.
`computeEffectiveStops` uses the latest revision's timestamp as the cutoff
for which fills a revision could have consumed, and falls back to the
position's open date when it is missing. Set it to the owning transaction's
`executedAt` so the fallback stops being load-bearing.

`stop_levels` itself stays append-only. Nothing marks a tier executed in
place; the execution is a separate fact pointing at it.

## At risk, shown per tier

The formula is unchanged: `(currentPrice − stop) × shares`. It answers "how
much of my equity right now would I give back if this stop fired", and it is
the number the Stops headline and the Dashboard's At-risk box already show.
An earlier draft of this spec proposed re-anchoring it to entry so a stop
raised above entry would read as a negative, locked-in gain; that was
considered and rejected — give-back-from-here is the number that matters
when deciding what to do today.

What is new is that **each row of the Stops table gains a dollar column**
carrying its own contribution. Today the page shows only distance as a
percentage ("17.20% room"), so the tier costing the most money is not
visible — a 17% cushion on a small position and a 3% cushion on a large one
say nothing about which one matters. The column is the missing half of that
picture, and the headline is its sum.

**A passed stop stays floored at zero in the headline.** When the current
price has already crossed a stop, the formula goes negative, and letting
that net against real risk elsewhere would report a *lower* total precisely
when a stop should have fired and did not. The per-row column shows the true
signed figure — the row is already labelled as passed — while the headline
keeps the existing `Math.max(0, ...)` per position. If this proves wrong in
use it is a one-line change.

## Stop CRUD

Add, edit and remove tiers on any open position: `GET` and `PATCH
/portfolio/trades/:id/stops` (the `PATCH` already exists and has no caller),
plus an editor on the trade detail reachable from the Stops page.

Every change writes a **new revision**. Removing a tier means writing a
revision in which it is absent, never deleting a row. The UI offers ordinary
edit-and-delete; the history of what the plan was on any past date survives,
which is what keeps R and expectancy reconstructible after the fact.

The editor reuses the entry sheet's existing tiered stop input rather than
introducing a second one, including its minus-key-free numeric handling.

## Recording an execution

When a journal entry reduces a position carrying live tiers, the entry sheet
asks **"Was this a stop?"**, offering the closest tier pre-selected, the
other live tiers, and "No — my own decision".

Saving writes the transaction, any `stop_executions` rows and `exitKind`
inside the same database transaction as the journal entry. A half-written
state is impossible, and journal entries remain the only write path into the
portfolio.

## Derivation

`computeEffectiveStops` reads `stop_executions` as fact. Price-proximity
matching survives only for fills that are still unclassified, where it seeds
the entry sheet's default. It stops being something the numbers rest on.

A `DISCRETIONARY` exit still reduces coverage — the shares are gone — but is
attributed to no tier.

## Exit statistics

The Journal stats header gains "stopped out on X% of exits", counting
classified exits only and naming the number still unclassified.

## Historical backfill

Applied once, by SQL, against the real `trader` database. A `pg_dump` is
taken first and every statement is shown before it runs.

All ten reducing fills are classified `STOP`:

| Symbol | Fill | Tier |
|---|---|---|
| AVGO | SELL 40 @ 349.91 | 349.93 × 40 |
| BE | SELL 45 @ 206.90 | 207.08 × 45 |
| BITX | SELL 1000 @ 17.46 | 17.46 × 1000 |
| BITX | SELL 800 @ 17.07 | 17.07 × 800 |
| BMNR | SELL 500 @ 24.34 | 24.34 × 500 |
| MRNA | BUY 200 @ 149.65 | 149.64 × 200 |
| MSTR | SELL 100 @ 123.07 | trailing 11.9% |
| NVDA | SELL 151 @ 220.07 | 220.07 × 151 |
| PLTR | SELL 120 @ 167.15 | 167.13 × 120 |
| SMCI | SELL 600 @ 36.92 | 36.92 × 600 |

Every quantity matches its tier exactly, so no partial executions are
modelled in the backfill.

One tier is deleted rather than linked: **`b23d5bef` — AVGO, 200 @ 161.93**,
attached to AVGO's sell transaction. It is a MRNA stop that was filed
against the wrong entry; MRNA's own second sell already carries an identical
200 @ 161.93. No AVGO fill of 200 shares exists.

AVGO's post-rebuy tier stays at **339.93** as stored.

## Known discrepancy, not addressed here

MSTR's recorded trail is 11.9% against a high-water of 135.97, which puts the
stop at 119.79 — but the exit was at 123.07, and the owner confirms it was a
stop. Either the trail percentage is wrong or the daily bars are short of the
real high (123.07 implies a high of 139.69; a 9.5% trail against 135.97 gives
123.05). `resolveStopPrice` prices every live trailing stop from exactly
these two inputs, so whichever is wrong is also wrong on the Stops page
today. Worth its own investigation.

## Testing

**Pure, fixture-driven:**
- the tier matcher that supplies the entry sheet's default
- `computeEffectiveStops` preferring records over inference, and mixing both
- the per-tier dollar contribution, including a passed stop showing signed
  in its row while contributing zero to the headline

**e2e:** journal a sell, confirm the stop, and assert the `stop_executions`
row is written, coverage drops, and `exitKind` is set.

**On the phone**, at the end of each slice.

## Slices

1. Migration, `createdAt` backfill, and the per-tier dollar column on the
   Stops table — visible immediately
2. Stop CRUD editor
3. Execution recording in the entry sheet
4. Historical backfill by SQL
5. Exit statistics

Slice 1 alone corrects the number the owner flagged.

## Out of scope

Profit targets. A historical review screen. Any change to how R,
expectancy, or at-risk are defined. Reconciling the app against the broker.
