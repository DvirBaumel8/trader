# Working Agreement

How work on this project is expected to proceed. These are the owner's explicit
instructions, plus lessons that cost real time to learn.

## Build in small, testable slices

The owner's instruction, close to verbatim: build it **step by step, super
slowly**, letting him test every small thing and getting it right before moving to
the next part — otherwise it becomes a mess and hard to test.

In practice this means:

- **Vertical slices, never horizontal layers.** Each step ends with something
  running that he can open on his phone and poke at. Never "the database is done"
  or "the API is done" — those cannot be tested and they pile up.
- **Explicit test checkpoints.** Work stops at a checkpoint, states exactly what
  to test and what to look for, and does not continue until he responds.
- **One phase at a time.** The plan for the next phase is written *after* the
  previous one has been used, so it is informed by real usage rather than guesses.

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
or sending data anywhere is his decision, made with the risks stated plainly —
particularly while the app has no authentication and holds his real positions.

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

- Runs locally: `npm run dev` from the repo root, nothing else required
- Postgres 18 via Homebrew, already running; no Docker
- He reaches the app from his iPhone at the Mac's LAN address on the same Wi-Fi
- **Remote access is not set up yet.** Tailscale was chosen for this and needs
  physical access to the Mac (sudo password, VPN approval dialog) — it cannot be
  done from the phone. Pending.
