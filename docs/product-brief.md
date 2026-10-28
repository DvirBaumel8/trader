# Trader — Product Brief

Everything below comes from the project owner. It is the "why" behind the code;
`AGENTS.md` is the "how". When a technical decision is ambiguous, this file
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
features that add no value and make the product complex and hard to test.
Every proposed addition should be met with "does this earn its complexity?"

**Free for now.** No paid services while the product serves one user. Market data
comes from Yahoo Finance (free, no API key), and the app makes no AI calls. Paid infrastructure is a decision for
when there are paying subscribers — not before.

**Build it step by step, and test each piece before moving on.** Explicitly
requested: small vertical slices, each ending in something usable and verified by
the owner in the real app on a real phone, before the next one starts. Otherwise
it becomes "a mess and hard to test". See `working-agreement.md`.

**Mobile is the primary device.** Not a responsive afterthought — the owner uses
this on an iPhone, and several bugs have existed *only* on the phone.

**Honest data over pretty data.** Never show a stale price as if it were
fresh. If a figure cannot be computed correctly, say so rather than show
something plausible and wrong.

## The core product idea

Trader was rebuilt after the owner built it and did not use it: most of what it
computed already lives in his broker. It now keeps only what the broker cannot
do for him, and grows one case at a time.

1. **Trader knows what you hold, never your numbers.** No quantities, prices
   paid, cash, balances, P&L or performance. The broker owns those.
2. **No AI calls inside the app.** When Trader cannot answer something itself,
   it produces a ready-to-paste prompt for the owner's single Gemini Pro
   conversation.
3. **One place to talk to it.** A chat-style screen is home. Input is text;
   voice is iPhone keyboard dictation, so the app only ever sees text.
4. **Grow by case.** Start with a small set of commands and one market-data
   answer; add each new kind of question as its own slice once the owner meets
   it in real use.

## Deliberately out of scope

Conversation history, notes or memory; prompt design (a later session); other
market-data questions (price, earnings, list scans) until the owner asks for
them; voice beyond keyboard dictation; Hebrew; seeding from old data; dropping
the old tables; target prices on the watchlist. Also still out: options,
crypto, broker integration, tax reporting, price alerts, multi-currency.

Design: `superpowers/specs/2026-10-28-trader-rebuild-design.md`
