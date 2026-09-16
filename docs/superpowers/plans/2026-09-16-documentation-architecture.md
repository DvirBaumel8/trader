# Documentation Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Trader one concise, model-neutral agent entrypoint plus focused living references, while preserving historical decisions without making them onboarding material.

**Architecture:** `AGENTS.md` becomes the tracked canonical entrypoint and routes an agent to narrow references according to its task. `docs/current-state.md`, `docs/agent-guide.md`, and `docs/ai-configuration.md` hold changing operational, development-agent, and in-product-AI facts respectively; historical specs and plans remain on demand. Compatibility files and stale framework READMEs become short pointers rather than duplicate guides.

**Tech Stack:** Markdown, Git, npm workspaces, NestJS configuration in `backend/src/llm/llm.client.ts`, and Render Blueprint configuration in `render.yaml`.

**Spec:** `docs/superpowers/specs/2026-09-16-documentation-architecture-design.md`

## Global Constraints

- This is documentation-only work: do not change product behavior, deployment configuration, database data, or the selected AI model/provider.
- `AGENTS.md` is the only substantive auto-loaded guide; target 150–220 lines.
- Keep completed files in `docs/superpowers/specs/` and `docs/superpowers/plans/` intact as historical records.
- Do not place credentials, passwords, JWTs, production tokens, or real portfolio data in documentation.
- Resolve living operational claims from current code/configuration before documenting them.
- Do not run a backend build while `npm run start:dev --prefix backend` is watching; documentation verification needs no build.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `docs/current-state.md` | Create | Concise, date-stamped statement of currently shipped surface, operating facts, and active risks/checkpoints. |
| `docs/agent-guide.md` | Create | Model-neutral fresh-session, handoff, review, and development-agent model-selection guidance. |
| `docs/ai-configuration.md` | Create | One runtime-AI configuration reference and model/provider swap checklist. |
| `AGENTS.md` | Replace and add to Git | Canonical concise project entrypoint and document router. |
| `CLAUDE.md` | Replace | Compatibility pointer to `AGENTS.md`; no duplicate rules. |
| `.env.example` | Modify | List every supported runtime-AI environment variable, including `LLM_THINKING_LEVEL`. |
| `docs/DEPLOYMENT.md` | Modify | Point to runtime-AI configuration and correct local iteration commands. |
| `docs/working-agreement.md` | Modify | Retain durable collaboration rules and remove stale operational claims. |
| `docs/product-brief.md` | Modify | Point technical decisions to `AGENTS.md`. |
| `docs/api.md` | Modify | Point codebase-work guidance to `AGENTS.md`. |
| `docs/backlog.md` | Modify | Retain open work; condense resolved history into short re-open notes. |
| `backend/README.md` | Replace | Short backend-specific pointer, not the Nest starter README. |
| `frontend/README.md` | Replace | Short frontend-specific pointer, not the Vite starter README. |

## Task 1: Add the living project-state reference

**Files:**
- Create: `docs/current-state.md`
- Read: `package.json`, `backend/package.json`, `render.yaml`, `docs/DEPLOYMENT.md`, `docs/backlog.md`, `backend/src/auth/auth.module.ts`, `backend/src/main.ts`

**Interfaces:**
- Produces: a routeable `docs/current-state.md` with the exact headings `Current product`, `Operating facts`, `Active checkpoints`, and `Update this document when`.
- Consumed by: `AGENTS.md`, `docs/agent-guide.md`, and future task handoffs.

- [ ] **Step 1: Capture only verified current facts**

Read the listed sources and collect facts in these groups:

```markdown
- Current product: portfolio/diary, benchmarks, replay, AI features, and watchlist ranking that are shipped.
- Operating facts: two-process local iteration, production-shaped root command, deployed architecture, authentication, and database separation.
- Active checkpoints: the unchecked items in `docs/backlog.md` that require the owner's eye or a concrete input.
```

Do not copy phase history, implementation narratives, account data, URLs that may change, or a backlog item merely because it is closed.

- [ ] **Step 2: Write `docs/current-state.md`**

Use this outline and keep it below 120 lines:

```markdown
# Current State

> Read this when you need to know what is true now before planning, resuming, deploying, or testing work.

**Last verified:** YYYY-MM-DD against the named source files.

## Current product

## Operating facts

## Active checkpoints

## Update this document when
```

State that it is a current-state document, not a changelog; link to the source document for detail.

- [ ] **Step 3: Verify the document is concise and routeable**

Run:

```bash
wc -l docs/current-state.md
rg -n '^#|^##|^> Read this when|\*\*Last verified:\*\*' docs/current-state.md
```

Expected: no more than 120 lines, every required heading appears once, and the first prose tells a future agent when to read it.

- [ ] **Step 4: Commit the current-state reference**

```bash
git add docs/current-state.md
git commit -m "docs: add current project state"
```

## Task 2: Add model-neutral development-agent guidance

**Files:**
- Create: `docs/agent-guide.md`
- Read: `docs/working-agreement.md`, `docs/current-state.md`, `AGENTS.md`, and the repository's available Codex/task tooling instructions at execution time

**Interfaces:**
- Produces: a concise guide with `Start or resume`, `Choose the development agent model`, `Handoffs`, `Review and verification`, and `Update this document when` sections.
- Consumed by: a fresh agent after reading `AGENTS.md`; no runtime application code reads this file.

- [ ] **Step 1: Define the agent-model policy without choosing a vendor**

Write the policy in outcome terms:

```markdown
- Use stronger reasoning for architecture, real-data safety, debugging, migrations, and final review.
- Use a lower-cost model for a narrow task whose files, acceptance criteria, and test command are already explicit.
- Set model and reasoning level deliberately for delegated work when the host supports them.
- Keep a task handoff self-contained enough that a different model can continue without replaying a long conversation.
```

Do not name a preferred model, quote pricing, or duplicate host-specific tool instructions that are not committed to this repository.

- [ ] **Step 2: Write `docs/agent-guide.md`**

Use this outline and keep it below 160 lines:

```markdown
# Agent Guide

> Read this when starting, resuming, handing off, delegating, or reviewing work in Trader.

## Start or resume

## Choose the development agent model

## Handoffs

## Review and verification

## Update this document when
```

The handoff template must require: objective, current decision, files changed, verification run and result, known risks, and the next concrete action. Link task-specific instructions back to `AGENTS.md` and `docs/current-state.md` instead of repeating them.

- [ ] **Step 3: Verify it is vendor/model neutral**

Run:

```bash
wc -l docs/agent-guide.md
rg -n 'gpt-|gemini|claude|price|pricing|vendor' docs/agent-guide.md
```

Expected: at most 160 lines; the second command has no matches unless a neutral warning is unavoidable and explicitly justified in the document review.

- [ ] **Step 4: Commit the development-agent guide**

```bash
git add docs/agent-guide.md
git commit -m "docs: add agent workflow guide"
```

## Task 3: Document the in-product AI configuration boundary

**Files:**
- Create: `docs/ai-configuration.md`
- Modify: `.env.example`
- Modify: `docs/DEPLOYMENT.md`
- Read: `backend/src/llm/llm.client.ts`, `backend/src/llm/llm.service.ts`, `backend/src/llm/llm.client.spec.ts`, `render.yaml`

**Interfaces:**
- Produces: one canonical explanation of runtime AI settings and model/provider change verification.
- Consumed by: local and production maintainers; `AGENTS.md` routes AI-related tasks here.

- [ ] **Step 1: Derive the supported configuration from code, not comments alone**

Confirm these current semantics before writing:

```text
GEMINI_API_KEY takes precedence over LLM_API_KEY.
LLM_PROVIDER defaults to gemini and any other value leaves the client unconfigured.
LLM_MODEL defaults to gemini-2.5-flash.
LLM_THINKING_LEVEL accepts MINIMAL, LOW, MEDIUM, or HIGH; unknown values are ignored.
LLM_GROUNDED is true only when its value is exactly "true" and currently affects portfolio summaries; other documented AI features request grounded: false.
```

Also confirm `backend/src/llm/llm.client.ts` is the only application file importing the AI SDK.

- [ ] **Step 2: Write `docs/ai-configuration.md`**

Use this outline and keep it below 140 lines:

```markdown
# AI Runtime Configuration

> Read this before changing Trader's in-product AI model, provider, key, grounding, or thinking level.

## Supported settings

## Model-only change

## Provider change

## Expected disabled behavior

## Verification

## Update this document when
```

Include a settings table whose source of truth is the code. The `Model-only change` checklist must state that no TypeScript change is needed, settings are changed in the relevant environment, and focused LLM tests plus an authenticated feature smoke test are required. The `Provider change` checklist must require a new adapter behind `LlmClient`, no provider SDK imports outside `llm.client.ts`, focused fake-client tests, and explicit behavior for unsupported grounding/streaming.

- [ ] **Step 3: Align environment and deployment references**

Add `LLM_THINKING_LEVEL=` to `.env.example` beside the existing `LLM_*` entries. In `docs/DEPLOYMENT.md`, add a short optional runtime-AI configuration subsection that links to `docs/ai-configuration.md`, distinguishes secret keys from plain model/thinking settings, and does not instruct a user to publish a key in Git.

Do not change `render.yaml`: this task documents its existing `LLM_THINKING_LEVEL=MINIMAL` value and must not change production behavior.

- [ ] **Step 4: Run the configuration coherence checks**

Run:

```bash
rg -n 'LLM_(API_KEY|PROVIDER|MODEL|THINKING_LEVEL|GROUNDED)|GEMINI_API_KEY' .env.example docs/ai-configuration.md docs/DEPLOYMENT.md backend/src/llm/llm.client.ts backend/src/llm/llm.service.ts render.yaml
npm run test --prefix backend -- --run src/llm/llm.client.spec.ts src/llm/llm.service.spec.ts
```

Expected: `.env.example` includes all supported knobs, the documentation does not invent a setting absent from code, and the focused configuration tests pass without a live API call.

- [ ] **Step 5: Commit the runtime-AI documentation**

```bash
git add docs/ai-configuration.md .env.example docs/DEPLOYMENT.md
git commit -m "docs: clarify AI runtime configuration"
```

## Task 4: Canonicalize the automatic entrypoint and task routing

**Files:**
- Modify and add to Git: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/product-brief.md`
- Modify: `docs/api.md`
- Modify: `docs/backlog.md`
- Read: `docs/superpowers/specs/2026-09-16-documentation-architecture-design.md`, `docs/current-state.md`, `docs/agent-guide.md`, `docs/ai-configuration.md`

**Interfaces:**
- Produces: a tracked `AGENTS.md` that a new agent can read first, and a compatibility `CLAUDE.md` that directs tools to the same source of truth.
- Consumes: the focused documents created in Tasks 1–3.

- [ ] **Step 1: Extract only entrypoint-worthy rules from the existing long guide**

Create an outline containing only these sections:

```markdown
# Trader

## First read
## Product and data invariants
## Safe local workflow
## Verification rules
## Architecture map
## Find the right document
## Keep documentation current
```

Preserve the hard requirements: positions are derived; journal entries are the only portfolio write path; real portfolio data is never destructively reset; services resolve the request user; stale/extended prices are labelled; frontend displays while backend computes; migrations are required; correct two-process development commands; and browser/phone visual verification for UI changes.

Move detailed incident narratives, phase histories, route-level API notes, provider behavior, and model-routing guidance to the focused documents rather than retaining them here.

- [ ] **Step 2: Replace `AGENTS.md` with the concise canonical guide**

Write the outline from Step 1 in 150–220 lines. The routing table must include exact links and triggers:

```markdown
| When the task involves… | Read… |
|---|---|
| current shipped behavior, active work, or operating reality | `docs/current-state.md` |
| starting, handing off, delegating, or selecting a development agent model | `docs/agent-guide.md` |
| Trader's in-product AI model/provider/configuration | `docs/ai-configuration.md` |
| product intent | `docs/product-brief.md` |
| deployment | `docs/DEPLOYMENT.md` |
| public API behavior | `docs/api.md` |
| a past design decision or implementation | the matching file under `docs/superpowers/specs/` or `docs/superpowers/plans/` |
```

End with a rule that a new living document requires a purpose, update trigger, and routing-table entry.

- [ ] **Step 3: Turn `CLAUDE.md` into a compatibility pointer**

Replace its body with no more than 20 lines:

```markdown
# Trader

The canonical project instructions are in [`AGENTS.md`](AGENTS.md).
Read that file before acting; it routes task-specific references.
```

Retain only any syntax that a verified committed tool requires to load `AGENTS.md`; do not duplicate rules. Do not remove `CLAUDE.md` unless an execution-time compatibility check proves no supported tool uses it.

- [ ] **Step 4: Repair live cross-references only**

Change the source-of-truth wording in `docs/product-brief.md`, `docs/api.md`, and the active-intake preamble of `docs/backlog.md` from `CLAUDE.md` to `AGENTS.md`. Do not edit historical specs/plans that mention `CLAUDE.md`; they describe the project as it was at the time.

- [ ] **Step 5: Verify the entrypoint contract**

Run:

```bash
wc -l AGENTS.md CLAUDE.md
rg -n 'CLAUDE\.md|AGENTS\.md|current-state\.md|agent-guide\.md|ai-configuration\.md' AGENTS.md CLAUDE.md docs/product-brief.md docs/api.md docs/backlog.md
for path in docs/current-state.md docs/agent-guide.md docs/ai-configuration.md docs/product-brief.md docs/DEPLOYMENT.md docs/api.md; do test -f "$path" || exit 1; done
```

Expected: `AGENTS.md` is 150–220 lines, `CLAUDE.md` is at most 20 lines, every routing target exists, and the live documents no longer call `CLAUDE.md` the canonical guide.

- [ ] **Step 6: Commit the canonical entrypoint**

```bash
git add AGENTS.md CLAUDE.md docs/product-brief.md docs/api.md docs/backlog.md
git commit -m "docs: centralize agent entrypoint"
```

## Task 5: Remove stale operational copies and make references honest

**Files:**
- Modify: `docs/working-agreement.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/backlog.md`
- Modify: `backend/README.md`
- Modify: `frontend/README.md`
- Read: `package.json`, `backend/package.json`, `frontend/package.json`, `backend/src/auth/auth.module.ts`, `docs/current-state.md`

**Interfaces:**
- Produces: accurate short references that defer current facts to the canonical entrypoint/current-state document.
- Consumed by: people opening a package directory, deployment maintainers, and agents following a project task.

- [ ] **Step 1: Correct the working agreement without turning it into an operations manual**

Keep the durable rules about small slices, real database safety, phone verification, outward-facing approval, and communication. Replace the stale claim that the app has no authentication with the durable instruction to treat user data and credentials as private and follow the current authentication flow in `docs/api.md`.

Replace the stale root-`npm run dev` environment claim with a link to `AGENTS.md`/`docs/current-state.md`; include the two iteration commands only if they remain current:

```bash
npm run start:dev --prefix backend
npm run dev --prefix frontend
```

State that root `npm run dev` is production-shaped and not hot reload.

- [ ] **Step 2: Correct the deployment document's local-development section**

Replace the root-only local command with separate **Iterating** and **Production-shaped** commands. Keep migration guidance accurate:

```bash
npm run start:dev --prefix backend
npm run dev --prefix frontend

cd backend && npm run migration:run

npm run dev
```

Explain that the final command builds and serves on port 3000, so it must not be run while the backend watcher is active. Link AI settings to `docs/ai-configuration.md` rather than duplicating the configuration table.

- [ ] **Step 3: Replace framework-template package READMEs with useful pointers**

Replace `backend/README.md` and `frontend/README.md` with 10–30-line project-specific files. Each must name the package's responsibility, link to `../AGENTS.md`, name its normal command, and link to its focused API/deployment reference. Do not retain Nest, Vite, sponsor, or generic framework setup prose.

- [ ] **Step 4: Make the backlog active-work-first without destroying useful re-open context**

Keep unchecked work and its actionable evidence. For resolved narratives, replace multi-paragraph closed sections with a compact `## Resolved notes` section containing one line each: date, outcome, and exact condition for reopening. Preserve the current e2e-flake note as a compact re-open condition and preserve the AI-thinking result as a link to `docs/ai-configuration.md`; do not delete the details from Git history.

The result must preserve the opening promise: backlog is current work, not a second implementation history. Historical specs/plans remain untouched.

- [ ] **Step 5: Run the stale-claim and size checks**

Run:

```bash
rg -n -i 'no authentication|npm run dev.*nothing else required|NestJS starter|React \+ TypeScript \+ Vite|nestjs.com|mau deploy' docs/working-agreement.md docs/DEPLOYMENT.md backend/README.md frontend/README.md
wc -l backend/README.md frontend/README.md docs/backlog.md
```

Expected: no stale authentication/root-development/template claims, both package READMEs are 10–30 lines, and `docs/backlog.md` is materially shorter while still containing every unchecked item.

- [ ] **Step 6: Commit the reference cleanup**

```bash
git add docs/working-agreement.md docs/DEPLOYMENT.md docs/backlog.md backend/README.md frontend/README.md
git commit -m "docs: refresh operational references"
```

## Task 6: Perform the fresh-session and documentation-drift acceptance audit

**Files:**
- Read: `AGENTS.md`, `CLAUDE.md`, `docs/current-state.md`, `docs/agent-guide.md`, `docs/ai-configuration.md`, `.env.example`, `docs/DEPLOYMENT.md`, `docs/api.md`, `docs/working-agreement.md`
- Modify only if a failed acceptance check reveals a gap: the exact referenced document

**Interfaces:**
- Produces: documented verification evidence in the final commit message/summary; no application code changes.
- Consumes: all prior documentation tasks.

- [ ] **Step 1: Run three fresh-session walkthroughs**

Starting from `AGENTS.md` only, answer each question by following its routing table:

```text
UI task: Which command starts hot reload, which command proves the production shape, and what visual verification is required?
Migration task: What data must never be reset, where does a migration live, and what command applies it locally?
Deployment task: Which document controls deployment, what credentials must remain private, and where is runtime-AI configuration documented?
```

Expected: each answer is available without opening a historical spec/plan and no two living documents give conflicting commands.

- [ ] **Step 2: Run two model-change walkthroughs**

Starting from `AGENTS.md`, answer:

```text
Development-agent change: How does a maintainer choose a different model/reasoning level while keeping a safe handoff and review standard?
Trader AI change: Which environment settings change a Gemini model only, what values are valid for thinking level, and what distinguishes that from adding a new provider?
```

Expected: the first answer comes from `docs/agent-guide.md`, the second from `docs/ai-configuration.md`, and neither needs a model-specific rule in `AGENTS.md`.

- [ ] **Step 3: Run the navigation and contradiction checks**

Run:

```bash
rg -o '`docs/[^`]+\.md`' AGENTS.md | tr -d '`' | sort -u | while read -r path; do test -f "$path" || { echo "Missing: $path"; exit 1; }; done
rg -n -i 'no authentication|npm run dev from the repo root, nothing else required|CLAUDE\.md is the "how"|CLAUDE\.md says how to work' AGENTS.md CLAUDE.md docs .env.example backend/README.md frontend/README.md --glob '*.md' --glob '.env.example' --glob '!docs/superpowers/**'
git diff --check HEAD~5..HEAD
```

Expected: every entrypoint-linked document exists; the contradiction search returns no live-document matches (historical specs/plans are excluded from this check); and the documentation-only diff has no whitespace errors.

- [ ] **Step 4: Inspect final scope and commit any acceptance fixes**

Run:

```bash
git status --short
git log --oneline -6
git diff --stat HEAD~5..HEAD
```

Expected: only documentation/config-template files named in this plan changed; no credentials or production data appear in the diff. If an acceptance check required a correction, stage only the named documentation files that changed and commit with:

```bash
git add AGENTS.md CLAUDE.md docs/current-state.md docs/agent-guide.md docs/ai-configuration.md .env.example docs/DEPLOYMENT.md docs/working-agreement.md docs/product-brief.md docs/api.md docs/backlog.md backend/README.md frontend/README.md
git commit -m "docs: verify documentation entrypoints"
```

## Self-Review

- **Spec coverage:** Tasks 1–3 implement the three focused living references; Task 4 creates the single concise entrypoint and preserves history; Task 5 corrects stale copies and backlog role; Task 6 covers fresh-session, development-agent-model, in-product-AI-model, drift, and navigation validation.
- **Scope:** No code behavior, runtime model selection, deployment setting, or data mutation is part of the plan.
- **Placeholder scan:** Every file, heading, command, source, and expected result is named. No task relies on a prior task without stating its produced document.
- **Consistency:** The source of truth is `AGENTS.md`; `CLAUDE.md` is compatibility only; `docs/current-state.md`, `docs/agent-guide.md`, and `docs/ai-configuration.md` have distinct update responsibilities.
