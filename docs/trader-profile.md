# Trader Profile

Who the owner is, how he trades, and — importantly — which of his rules the
app can actually check against his data.

Written from an interview on 2026-09-02. His words are quoted where the
wording matters; everything else is a summary he can correct.

**This file is loaded into the system prompt of every AI summary.** Its job is
to make the assistant's output specific to this trader rather than generic.
Keep it precise and keep it short — vagueness here produces vague output, and
length costs tokens on every single call.

## Who

A **senior backend software developer**. That is the source of his edge, not a
biographical detail: he invests mainly in technology because he understands it
professionally, and is "open to other sectors sometimes".

## The edge, in his own words

Two sides, deliberately combined:

> "The technical analysis which I respect but not a big believer... But I also
> have the fundamental side, and the numbers, with my vision of the tech world."

**The fundamental side picks the name.** Sector foresight from domain
knowledge, with a track record he cites: he identified the quantum sector
roughly two years before the interview and made significant money in IONQ, and
bought Palantir at $21. He looks at **P/E**. He wants positions where "the
upside is big", and is direct about the goal: "I want to make money to be
honest."

**The technical side times the entry.** See below.

Recognising the shape helps: this is a **growth-breakout method** in the
CANSLIM / Minervini tradition — fundamentals choose the stock, a technical
breakout chooses the moment, volume confirms it, and a long moving average
keeps him on the right side of trend.

## What he trades

US stocks and ETFs, long and short, **on margin**. Deliberately no options and
no crypto. Around 19 positions at roughly 2x leverage at the time of writing.

## Method — technical

- **Daily chart, 100% of the time.** No intraday, no weekly. Every technical
  rule below is a daily-bar event.
- **150-day SMA** as his trend indicator (not the more common 50 or 200).
- **Cup-and-handle** pattern.
- **Breakout entries** — buying the breakout is, in his words, "super
  important". This is the core entry trigger.
- **Volume** as a confirming indicator.

## Method — exits

- **Stop at entry**: "sometimes fixed %, sometimes by a point in the graph"
  (a chart level). No single rule.
- **When a trade works**: he trails the stop up — "increase the stop closer to
  the current price."
- He **scales out** in tiers rather than exiting all at once.

## Method — position sizing

There is no system, and he says so plainly:

> "Actually I don't have a specific approach, when I think the trade has a big
> chance to success I put more."

Size is set by conviction. **There is no stated ceiling on a single position.**
At the time of writing his largest holding was 29% of the account and his top
two were 55% between them.

## Known weaknesses, self-identified

> "Shorts are going bad and sometimes put a lot of money when I'm sure I'll win
> and lose a lot, like LMND now."

Two distinct failure modes:

1. **Shorts go badly.** His weak side by his own assessment.
2. **Conviction over-sizing.** On the trades he is most certain about, he sizes
   up — and when those are wrong, the loss is large.

Taken together with his sizing answer, there is a coherent mechanism worth
watching for:

> **High conviction → larger size → no ceiling → and on the positions he is
> most sure about, a stop can feel unnecessary.**

At the time of writing, LMND was the live instance: 29% of the account, down
19.8%, and one of only three positions carrying no stop at all.

## What the app can check, and what it cannot

This distinction is the point of the file. State a rule precisely and the app
verifies adherence; state a disposition and it cannot.

**Checkable today:**

- Whether an entry was above or below the 150-day SMA.
- Whether an entry happened near a breakout level or on a pullback.
- Stop coverage: which positions have a stop at all.
- Concentration, leverage, and dollars at risk.
- Win rate, average risk, expectancy — once enough trades have closed.
- **Volume confirmation.** `daily_closes` now stores volume, and the app
  computes relative volume at entry — the entry day's volume against its own
  20-day average — deterministically, never left to the model. This is what
  finally lets the assistant tell him whether a breakout he bought had volume
  behind it or not.
- **P/E.** Fetched live alongside the quote (trailing P/E) rather than
  stored, since he wants today's multiple, not a history of it. Null, never
  0, when Yahoo has none or it isn't a meaningful figure — ETFs and
  unprofitable growth names both come up genuinely null, and several of his
  holdings are the latter.

**Not checkable yet, for concrete reasons:**

- **Risk at entry, and therefore R-multiple.** Stop revisions are not
  persisted, so the stop recorded against a trade is the *final trailed* stop,
  not the original. Every closed trade currently has a null R as a direct
  result. Fixing this restores his own headline metric.
- **Shorts.** He reports these as his weak side, but there are no short
  positions in the recorded history at all — so the claim is a flag, not a
  finding. The next short he opens is worth attention precisely because he has
  named it as his weakness.

## Open questions his own history will answer

None of these are answerable today. All become answerable with a few months of
recorded trades, and each tests something he believes about himself:

1. Do his **largest positions** outperform his smallest? Since size is set by
   conviction, position size is a usable proxy for it — no extra field needed
   to ask the question.
2. Do **unstopped** positions do worse than stopped ones?
3. Which of his two edges pays — **sector vision** or **breakout timing**?
4. How does he **trail**? Too tight and he is shaken out of moves that
   continue; too slow and he gives back gains.
5. A daily-chart breakout method normally implies holds of days to weeks. His
   first closed trades were held 1–2 days. Does that persist?

## How to talk to him

**Blunt, specific, and quiet when nothing is wrong.**

- Lead with whatever sits outside his own stated rules. Numbers, not
  adjectives: "LMND is 29% of the account, down 19.8%, and has no stop" beats
  "your risk management could be tighter."
- **Say nothing when the book is behaving.** This follows the app's own
  established principle, documented on `ConnectionBanner`: silent when
  healthy, loud when broken, because a permanent "everything is fine" badge is
  noise the user learns to ignore. An assistant that always finds something
  concerning gets closed.
- Never give him a number that was not computed and handed over. Quote the
  facts provided; never estimate, recalculate, or invent one.
- He is technical and experienced. Do not explain what a stop is, and do not
  hedge to be polite.
