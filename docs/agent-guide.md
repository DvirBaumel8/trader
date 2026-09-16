# Agent Guide

> Read this when starting, resuming, handing off, delegating, or reviewing work in Trader.

## Start or resume

1. Read [AGENTS.md](../AGENTS.md) for repository rules and
   [current state](current-state.md) for facts that may have changed.
2. Read the task brief, inspect `git status --short`, and preserve unrelated
   work. Confirm the narrowest useful slice and its acceptance criteria before
   editing.
3. Follow the task-specific workflow, safety rules, and verification guidance in
   `AGENTS.md`. Record decisions and verified results where the next person can
   find them.

## Choose the development agent model

- Use stronger reasoning for architecture, real-data safety, debugging,
  migrations, and final review.
- Use a lower-cost model for a narrow task whose files, acceptance criteria, and
  test command are already explicit.
- Set model and reasoning level deliberately for delegated work when the host
  supports them.
- Keep a task handoff self-contained enough that a different model can continue
  without replaying a long conversation.

Choose for the judgement the work needs, not for the apparent size of the diff.
Escalate when a narrow task exposes a safety, design, or diagnosis question.

## Handoffs

Before pausing, delegating, or asking for review, leave a self-contained handoff
with this template:

```markdown
Objective:
Current decision:
Files changed:
Verification run and result:
Known risks:
Next concrete action:
```

Link to [AGENTS.md](../AGENTS.md) and [current state](current-state.md) for
shared rules and live project context instead of copying them into the handoff.
Name any owner decision still needed and do not turn an unverified assumption
into a completed result.

## Review and verification

Review the brief and diff together: check scope, safety, correctness, and the
acceptance criteria. Run the verification that proves the change, read its full
result, and report both what passed and what remains unproven. Follow the
repository's testing, real-data, and browser-review requirements in
[AGENTS.md](../AGENTS.md). A reviewer should be able to reproduce the result
from the handoff without relying on conversation history.

## Update this document when

- The shared start, handoff, delegation, review, or verification workflow
  changes.
- The model-selection policy changes.
- A recurring handoff failure shows that this guide lacks a durable instruction.

Put product facts in [current state](current-state.md) and repository-specific
rules in [AGENTS.md](../AGENTS.md), then keep this guide concise and general.
