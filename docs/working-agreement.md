# Working Agreement

How work on this project is expected to proceed. These are the owner's explicit
instructions, plus lessons that cost real time to learn.

## Build in small, testable slices

Build in small steps, each one right before the next begins, so problems stay
small and easy to test.

- **Vertical slices, never horizontal layers.** Each slice ends with something
  running that the owner can open on the phone and poke at. Never "the database
  is done" or "the API is done" — those cannot be tested and they pile up.
- **Say what to check.** When a slice is done and verified, state exactly what
  to test on the phone and what to look for, then keep going. Stop and wait only
  when the owner asked to review first, or when the next step needs a decision
  from the owner.
- **Plan from real usage.** Plan a later phase once the earlier one has been
  used, so the plan reflects real usage rather than guesses.

## Process that produced this project

Spec → plan → execute, using the `superpowers` skills:

1. `brainstorming` — the design spec, one question at a time
2. `writing-plans` — a full implementation plan per phase, with TDD steps
3. `executing-plans` — inline execution, human review at each checkpoint

Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`.
Plans record their **deviations** as they are hit, so the document stays true to
what was actually built.

## Rules learned the hard way

**Never run destructive commands against the `trader` database.** It holds the
owner's real portfolio. Verification uses `trader_test` or read-only calls. This
rule exists because a test-prep `DELETE /portfolio/reset` destroyed his seeded
portfolio, and he then spent time debugging a screen that was showing cached data
for rows that no longer existed.

**Verify on the phone, not just in the type checker.** Multiple bugs have existed
only on the device: an unusable numeric keypad, a form that lost its contents, a
date field overlapping its neighbour. A clean `tsc` and a passing curl prove very
little about a mobile UI.

**Do not edit files while he is testing.** Hot reload will yank the page out from
under him, and he will spend time chasing a bug that is really just a reload.

**Ask before doing anything outward-facing.** Exposing the app publicly, deploying,
or sending data anywhere is his decision, made with the risks stated plainly.
Treat user data and credentials as private, and follow the current authentication
flow in [docs/api.md](api.md).

## Tone of collaboration

- Give a **recommendation**, not a menu of equal options. He will overrule it when
  he wants to, and that is a fine outcome.
- **Push back when something is wrong**, briefly, then do what he decides.
- **Flag real problems immediately**, including self-inflicted ones. He would
  rather hear "I deleted your data and here is why" than a plausible theory about
  a bug that does not exist.
- **No progress theatre.** Report what is done, what is verified, and what is
  merely written but unproven.

## Environment

- Local commands and operating facts live in [AGENTS.md](../AGENTS.md) and
  [docs/current-state.md](current-state.md).
- Postgres 18 via Homebrew, already running; no Docker.
- The owner reaches the dev app from the iPhone at the Mac's LAN address on the
  same Wi-Fi, and the deployed app from anywhere (see
  [DEPLOYMENT.md](DEPLOYMENT.md)).
