# Trader — Product Brief

Everything below comes from the project owner. It is the "why" behind the code;
`CLAUDE.md` is the "how". When a technical decision is ambiguous, this file
should break the tie.

## Who this is for

The owner is an **active stock trader** of several years who trades **every day**
— not a buy-and-hold investor checking in monthly. That single fact drives most
of the design:

- Screens must be fast to read at a glance, not exploratory dashboards
- Entry friction is the enemy; anything typed daily must be quick on a phone
- The product must respect that he already knows what he is doing

**What he actually trades:** US stocks and ETFs, both long and short, on margin.
Deliberately **not** options or crypto — those were considered and cut from v1 to
keep the model small. Real usage confirms it: roughly 20 positions, six figures
deployed, a negative cash balance.

**Related prior work** in adjacent directories, useful for context and possible
future integration:

- `stock-investigator` — multi-agent LLM stock analysis (React + NestJS + Postgres)
- `algoTrade`, `polymarket-agent` — earlier trading and agent experiments

## Purpose

Two horizons, in order:

**1. Give value to the owner first.** The point is to trade in a more
**data-driven** way — more information, better recall of his own reasoning,
eventually more AI. If it does not earn daily use by him, nothing else matters.

**2. Then distribute it.** Friends, then friends of friends, then a **monthly
subscription**. This is the reason the quality bar is a product bar rather than a
personal-tool bar, from the very first screen.

The second goal is why **the UI must be world class**. It is not decoration; it is
the thing that makes the app shareable and eventually chargeable.

## Principles

**Start slow. Resist features.** In the owner's words, it is easy to add many
features that add no value and make the product complex and hard to test. v1 does
three things: portfolio, diary, benchmark comparison. Every proposed addition
should be met with "does this earn its complexity?"

**Free for now.** No paid services while the product serves one user. Market data
comes from Yahoo Finance (free, no API key), Postgres runs locally via Homebrew,
there is no hosting bill and no LLM spend. Paid infrastructure is a decision for
when there are paying subscribers — not before.

**Build it step by step, and test each piece before moving on.** Explicitly
requested: small vertical slices, each ending in something usable and verified by
the owner in the real app on a real phone, before the next one starts. Otherwise
it becomes "a mess and hard to test". See `working-agreement.md`.

**Mobile is the primary device.** Not a responsive afterthought — the owner uses
this on an iPhone, and several bugs have existed *only* on the phone.

**Honest numbers over pretty numbers.** Never show a stale price as if it were
fresh. Never let a deposit look like a gain. If a figure cannot be computed
correctly, show nothing rather than something plausible and wrong.

## The core product idea

**Seed the portfolio once; from then on, the diary maintains it.**

There is no separate "log a transaction" chore. Journaling a trade *is* what moves
the portfolio. This collapses two features into one and makes the journal
self-sustaining — which is the reason most trading journals rot and this one
might not.

## Deliberately out of scope for v1

Options, crypto, AI features, broker integration, tax reporting, watchlists, price
alerts, screeners, multi-currency, dividend tracking, multi-user accounts.

**On AI specifically:** the owner wants "more AI" and then chose *no AI in v1* —
because a coach reading an empty journal has nothing useful to say. The schema is
designed so AI is cheap to add once real history exists. The first AI feature will
be auto-enrichment of trade entries, because it works from day one and builds the
dataset every later feature needs.

## Roadmap

| Phase | What it delivers | Status |
|---|---|---|
| 1 | Portfolio, live — seed, positions, cash, live pricing | Complete |
| 2 | The diary — trade entries, notes, cash entries, tags | Not started |
| 3 | Vs the market — price history and the benchmark chart | Not started |
| Later | AI enrichment, hosting with accounts, options, broker import | Future |

Full detail: `superpowers/specs/2026-08-28-trader-design.md`
