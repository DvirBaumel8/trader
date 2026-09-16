# Documentation Architecture Design

**Date:** 2026-09-16
**Status:** Proposed for implementation
**Purpose:** Make a fresh agent session safe and useful quickly, keep model changes explicit, and retain important project knowledge without turning every task into a documentation-reading exercise.

## Problem

Trader has accumulated valuable product decisions, safety rules, operational knowledge, and implementation history. The material is useful, but the entry path has started to blur four different jobs:

1. rules an agent must know before touching code;
2. facts that change as the product and environment change;
3. focused operational references; and
4. historical design and implementation records.

Today, `CLAUDE.md` and an untracked `AGENTS.md` are near-copies of a 642-line guide. This creates a divergence risk and loads much more than a normal task needs. Several local README files remain framework templates, and some operational statements have become stale. The app's LLM boundary is centralized, but its supported configuration is not documented in one place.

The goal is not to reduce knowledge. It is to make the correct knowledge easy to find and the rest intentionally on-demand.

## Goals

- A new agent can identify the product, safety constraints, correct development commands, and task-specific reference documents in one short entrypoint.
- Changing the development agent's model is deliberate and documented without coupling it to a particular vendor or model name.
- Changing Trader's in-product LLM model or provider has one documented configuration path and verification checklist.
- The project keeps its design and implementation history without making history mandatory reading.
- Living documentation has clear update triggers, so it does not quietly drift.
- The resulting system is small enough to maintain by hand.

## Non-goals

- Introducing a documentation generator, wiki, or docs site.
- Rewriting completed specs and plans into a new format.
- Creating a complete codebase reference that duplicates source code, types, or tests.
- Prescribing a single development-agent vendor, model, or pricing tier.

## Information Architecture

### 1. Canonical entrypoint: `AGENTS.md`

`AGENTS.md` becomes the only full, automatically loaded project guide. It is concise by design: target 150–220 lines, with a hard preference for links over embedded history.

It contains only:

- product purpose and the few invariants that protect real portfolio data;
- non-negotiable safety rules and correct run/test commands;
- UI/mobile verification rules;
- a short architecture map;
- a task-to-document routing table; and
- the documentation update rule.

It does not contain incident narratives, long phase recaps, provider pricing, or detailed subagent economics. Those are useful references only when relevant.

`CLAUDE.md` becomes a short compatibility pointer to `AGENTS.md` if the project still needs to support tools that discover that filename. It must not duplicate substantive content. If it is no longer needed, it is removed instead. The implementation decides this from actual repository/tool compatibility, not assumption.

### 2. Living project state: `docs/current-state.md`

This is the compact answer to “what is true now?” It contains:

- current product surface and notable active work;
- current local/deployed operating facts that affect normal development;
- known user-visible risks or required checkpoints; and
- a `Last verified` date.

It is not a changelog. Each section stays short and links to the backing issue, plan, or source when detail is needed.

Update it when a feature ships, an operating procedure changes, an active risk is discovered or resolved, or its verification date is no longer credible.

### 3. Agent workflow and development-model guidance: `docs/agent-guide.md`

This document explains how to start, resume, hand off, and review work in Trader. It is model-neutral:

- begin with `AGENTS.md`, then read only the reference matched to the task;
- write a self-contained handoff that names current state, files changed, verification evidence, and remaining decisions;
- choose an agent model and reasoning level deliberately for the task's judgment and risk, not by habit;
- use stronger reasoning for architecture, data safety, and final review; use lower-cost models for narrow, well-specified implementation; and
- record any project-wide model-routing decision here rather than in task prompts.

It does not declare a specific vendor/model as required. A user or future maintainer can switch development-agent models while preserving the same workflow and evidence standards.

### 4. In-product LLM configuration: `docs/ai-configuration.md`

This document is the single reference for Trader's AI runtime. It describes the public configuration surface actually supported by the code:

- credentials (`GEMINI_API_KEY` / `LLM_API_KEY` as applicable);
- `LLM_PROVIDER`, `LLM_MODEL`, `LLM_THINKING_LEVEL`, and grounding configuration;
- the adapter boundary (`backend/src/llm/llm.client.ts` is the only AI-SDK import location);
- expected degraded behavior with no configured provider; and
- verification after a model-only change versus a provider-adapter change.

A model-only change remains an environment/configuration change. A provider change requires an adapter implementation and focused tests, but callers must continue using the provider-neutral `LlmClient` contract.

The environment template and deployment instructions must list the same supported settings. Neither document duplicates provider implementation detail.

### 5. Focused references and immutable history

| Category | Documents | Rule |
|---|---|---|
| Durable product intent | `docs/product-brief.md`, `docs/trader-profile.md` | Read when product behavior or trading judgment is involved. |
| Collaboration/safety reference | `docs/working-agreement.md` | Keep durable principles only; link to operating facts elsewhere. |
| Operations | `docs/DEPLOYMENT.md`, `docs/api.md` | Read only for deployment, integration, or API tasks. |
| Active intake | `docs/backlog.md` | Show open work first; condense closed historical narratives. |
| History | `docs/superpowers/specs/`, `docs/superpowers/plans/` | On-demand, immutable records; never normal onboarding. |

Every living document begins with a one-line “Read this when…” statement. The document routing table in `AGENTS.md` is the index; there is no separate documentation hub to maintain.

## Migration Rules

1. Preserve every hard-won invariant and safety rule, but move explanation and incident history out of the loaded entrypoint.
2. Resolve contradictory operational facts from code and recent verified behavior before publishing them. Do not carry both versions forward.
3. Replace framework-template README content with a brief repository-specific pointer or remove it when its directory has no independent setup.
4. Keep completed plan/spec files in place and do not bulk-edit them; they are evidence of past decisions.
5. Add no new living document unless it has a named purpose, update trigger, and routing-table entry.
6. Do not include credentials, production tokens, passwords, or real portfolio data in any documentation.

## Validation

The documentation change is complete only when these checks pass:

1. **Fresh-session check:** Starting at `AGENTS.md`, an agent can find the correct command, safety boundary, and task-specific references for a UI task, a migration task, and a deployment task without reading a historical plan.
2. **Development-agent model check:** An agent can select or change its development model/reasoning level while retaining the project's workflow, testing, and handoff standards.
3. **In-product LLM check:** A maintainer can identify all supported runtime settings, make a model-only environment change, and know the verification required. The guide distinguishes this from adding a provider.
4. **Drift check:** Search for the known stale claims corrected by the migration (for example, root development command and authentication status) and confirm the canonical documents do not contradict code.
5. **Navigation check:** All paths in the `AGENTS.md` routing table exist, and no guide duplicates a large body of another guide.

## Documentation Budget

| Surface | Budget |
|---|---:|
| `AGENTS.md` | 150–220 lines, exceptional additions require replacing or moving something else |
| `docs/current-state.md` | 80–120 lines |
| `docs/agent-guide.md` | 100–160 lines |
| `docs/ai-configuration.md` | 80–140 lines |
| README pointers | 10–30 lines each |

Budgets are signals, not mechanical limits. If a document grows beyond its budget, first move task-specific detail to the relevant focused reference rather than making the entrypoint longer.

## Rollout

One documentation-only implementation slice:

1. inventory the current documents and their authoritative sources;
2. create the three focused living references;
3. reduce and canonicalize the entrypoint, preserving compatibility only where needed;
4. correct stale README, environment, deployment, and working-agreement references in the same slice; and
5. run the validation checklist and capture the outcome in the change summary.

No product behavior, deployment configuration, database data, or model choice changes as part of this documentation work.
