# Chat: free-Gemini action router (phase 1)

**Date:** 2026-10-28
**Status:** Awaiting owner review.
**Amends:** `2026-10-28-trader-rebuild-design.md` — principle 2 ("no AI calls inside the app") becomes "no AI *analysis* inside the app".

## Why

The rebuild's chat used a hand-written parser (verb lists, filler words, ticker shapes). The owner finds it brittle and not good enough. A free Gemini model is good at turning a short sentence into a fixed action, so the chat uses one for that one job. Analysis and opinions still go to the owner's Gemini Pro conversation as copy-ready prompts.

## Behaviour

One message in, one reply out. Not interactive in phase 1.

1. The backend sends the message to free Gemini with the list of supported actions and asks for strict JSON.
2. If the model returns a supported action, Trader performs it and replies with one summary.
3. Otherwise (no action, unusable output, or the model is unavailable) the reply is the Gemini Pro prompt, as today.

### Supported actions (phase 1)

All of them take one or many symbols.

| Action | Example phrasings | Effect |
|---|---|---|
| `buy` | "bought LMND", "I bought: LMND, TSLA", a pasted numbered list after "Bought:" | Add each as a LONG holding. Already held (either direction) → "already held", unchanged. |
| `sell` | "sold LMND", "closed TSLA and NVDA" | Remove each from holdings **and** add it to the watchlist. Not held → reported, and nothing is changed for that symbol (no watchlist add either). |
| `watch` | "watch NVDA", "add AMD and SMCI to my watchlist" | Add each to the watchlist. |
| `unwatch` | "unwatch NVDA", "remove AMD from watchlist" | Remove each from the watchlist. |
| `none` | questions, opinions, intentions ("should I sell X?", "thinking of buying X"), anything else | Gemini Pro prompt. |

The moving-average check is removed from chat for now; such questions become prompts. Shorts are not set through chat; the Holdings screen keeps its Long/Short controls.

### Reply

One summary for the whole message, in groups. Empty groups are omitted. For example:

> Added (long): GSIT, USAR, LMND, META
> Already held: NVDA
> Couldn't find: SPCX

`sell` has the groups "Sold and moved to watchlist", "Not held". `watch` has "Watching" and "Already watching". `unwatch` has "Stopped watching" and "Not on watchlist". Every action has a "Couldn't find" group. The reply kind is `done`, with the summary as its message, so the frontend needs no change beyond rendering line breaks.

## Guardrails

- **The model never writes directly.** It returns JSON, and the backend validates its shape (known action, symbols array of 1–50 strings). Anything invalid → prompt.
- **Every symbol is validated against Yahoo** (`InstrumentsService.findOrCreate`) before any write. Unknown symbols go into "Couldn't find". Symbols are uppercased and de-duplicated.
- **Questions and intentions are not actions.** The system instruction says so explicitly, with examples. A message containing "?" never performs an action: the backend enforces this even if the model returns one.
- **Model failure is never a write.** On timeout (5 s), HTTP error, quota error or bad JSON, the reply is the prompt with a short note first: "Couldn't read that automatically — here's a prompt instead."
- **No account numbers go to the model.** The request carries only the owner's message and the action list, not holdings or watchlist.

## Technical shape

- `backend/src/llm/llm.client.ts` returns as the only AI SDK import boundary (`@google/genai`), slimmed to one method: `classify(message): Promise<RouterResult | null>`. It uses structured JSON output (response schema), thinking set to minimal, and the model from `LLM_MODEL` (currently `gemini-3.6-flash`, free tier) with key `GEMINI_API_KEY`, falling back to `LLM_API_KEY`. With no key configured, every message becomes a prompt.
- `backend/src/assistant/router.ts`: system instruction, response schema, and pure validation of the model output into an `Intent` (`buy | sell | watch | unwatch` with `symbols[]`, or `none`).
- `AssistantService` uses the router instead of `parse.ts`. `parse.ts` and its spec are deleted. The `ma-check` path and its tests are removed from the assistant. `moving-average.ts` and `HistoryService.ensureDepth` stay, unused, for when the action comes back.
- Bulk execution validates symbols in parallel (bounded to 5 at a time) and persists sequentially.
- Tests never call Gemini: the e2e and browser servers override `LlmClient` with a stub that maps fixed messages to fixed JSON. The validation in `router.ts` is unit-tested with good, malformed and hostile model outputs.
- Docs: `AGENTS.md` restores the LLM import-boundary rule; `docs/ai-configuration.md` describes the router; `render.yaml` gets `GEMINI_API_KEY` back (`sync: false`). The Mac host already has the key.

## Out of scope (phase 1)

Interactive follow-ups, "did you mean", moving-average and other data questions, shorts via chat, conversation history.
