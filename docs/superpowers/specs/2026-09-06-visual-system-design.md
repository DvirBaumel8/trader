# A visual system: type scale and spacing

## Why

The owner asked to stop and think about the UI, from requirement 15 — "maybe
we can use more classic UI components, maybe investigate other products and
think deeply what the perfect UI would be". He was explicit that he was not
reporting a fault: *"I did not say something is bad, I just want to think if
we want to improve things."*

Two questions narrowed it. His dominant use of the app is **logging a trade he
just made**, and that flow is **fine as it is** — so this is not an
information-architecture or navigation problem, and nothing here changes tabs,
routes or the entry sheet. What drives the request is **how it looks**: it does
not yet look like a product he could charge for. The visual direction he chose
is **dense / professional-tool** — TradingView, IBKR — rather than
consumer-fintech calm.

## The actual finding

The app has no system. Measured, before any change:

- **13 distinct font sizes**, seven of them arbitrary pixel values. Five of
  those (`9px`, `10px`, `11px`, `12px`, `13px`) sit inside a four-pixel band,
  so they produce no hierarchy — only the impression of something slightly
  off.
- **8 vertical padding values**, chosen ad hoc.
- **24 distinct button class strings** across 33 call sites, and no generic
  primitives at all. (Addressed separately, already landed: `Button`,
  `inputClasses`.)

A dense professional tool takes its authority from a strict, small scale used
consistently — where a size *means* something — not from being small. That is
the gap between "good but homemade" and "product", and it is the whole subject
of this spec.

## The type scale

Five tokens, each with one job, added to the existing `@theme` block beside
the `--color-*` tokens so they read the same way:

| Token | px | Job | Absorbs |
|---|---|---|---|
| `text-micro` | 10 | badges, uppercase tags — SHORT, STALE, LONG | `[9px]`, `[10px]` (38 uses) |
| `text-meta` | 12 | secondary text, captions, the quiet supporting line | `text-xs`, `[11px]`, `[12px]` (113) |
| `text-body` | 14 | default reading size, labels, buttons | `text-sm`, `[13px]` (60) |
| `text-value` | 16 | the numbers in a row, and inputs | `[15px]`, `text-base` (11) |
| `text-hero` | 24 | the one dominant number on a screen | `text-2xl`, `text-xl`, `[19px]` (4) |

The two largest groups do not move: `text-xs` stays 12px and `text-sm` stays
14px, so roughly 145 of ~230 usages are visually unchanged. The churn falls
where the arbitrary values are, which is where the problem is.

**`text-lg` (18px, 11 uses) is dropped.** Those are mostly screen titles, which
become `text-value` at semibold — a dense tool gets title-ness from weight
rather than size, and it holds the scale at five. This is the reversible half
of the design: if titles read weak on the phone, a sixth token is one line.

**`[11px]` grows to 12px** (25 uses). This is what collapses five near-identical
steps into two real ones, and is the only other change visible at a glance.

## Spacing

A convention, not tokens. Tailwind already has a numeric scale; the fault is
that eight values are picked ad hoc, not that one is missing. Custom spacing
tokens would fight the framework. The shortlist:

- `py-0.5` — badges
- `py-1.5` — dense rows
- `py-2.5` — default
- `py-3` — panels and sheets

## What this does not touch

Tabs, routes, navigation, the entry sheet, the logging flow, the chart's
internals, colour tokens, and the four components already extracted. No new
components. No layout restructuring. Density of the position and stop rows is
explicitly **out of scope** — it was offered and deferred until the scale can
be seen on a real device.

## Verification

This is the uncomfortable part and the reason for the rollout shape: **type and
spacing changes are invisible to the test suite.** All 183 frontend tests and
`tsc` stay green whatever this does, because nothing asserts on rendered size.
The `Button` spec pins its own classes exactly, which protects that component
but nothing else.

So verification is the owner's eye, and the plan is built around making that
cheap:

- One screen per step, pushed on its own, checked on the phone before the next.
- Highest-traffic screens first — Portfolio, then Stops, Journal, TradeDetail,
  Ideas — so a wrong scale is found on step one, not step five.
- No step depends on a later one, so stopping after any step leaves the app
  coherent: a screen either uses the scale or it uses what it uses today.

## Risks

- **The scale is wrong for the phone.** Mitigated by ordering: Portfolio first,
  and it is one `@theme` edit to adjust every size at once.
- **Mixed state while rolling out.** Two screens on different scales for a day.
  Accepted deliberately over a big-bang change no one can verify.
- **Churn without payoff.** The honest failure mode. If Portfolio lands and the
  owner cannot see a difference, the right response is to stop, not to finish
  the remaining four screens for consistency's sake.
