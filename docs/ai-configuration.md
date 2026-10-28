# AI Configuration

> Read this before adding any AI to Trader.

Trader uses AI for exactly one job: routing a chat message to a predefined
action (`backend/src/assistant/router.ts`). No analysis happens in the app;
that goes to the owner's Gemini Pro conversation as a copy-ready prompt built
in `backend/src/assistant/prompt.ts`.

## The router

- **Boundary.** `backend/src/llm/llm.client.ts` is the only file that imports
  an AI SDK (`@google/genai`). `router.ts` never does.
- **Model.** `LLM_MODEL`, default `gemini-3.6-flash` (free tier).
- **Key.** `GEMINI_API_KEY`, or `LLM_API_KEY` as a fallback. With no key every
  message becomes a prompt.
- **Timeout.** 5 000 ms per call.
- **Output.** The model returns `{ action, symbols }` where action is `buy`,
  `sell`, `watch`, `unwatch` or `none`. Output is validated; the model never
  writes. A message containing `?` never performs an action, whatever the
  model says. More than 50 symbols is treated as `none`.
- **Symbols.** Uppercased, `$` and list numbering stripped, de-duplicated;
  valid shape `^[A-Z]{1,5}(\.[A-Z])?$`. Other strings are reported as
  "Couldn't find".
- **Fallback.** Only a failed or timed-out model call (timeout, HTTP error,
  quota, empty or non-JSON output) or a missing key returns a prompt with the
  note "Couldn't read that automatically — here's a prompt instead." Output
  that parses but is invalid, a message containing `?`, or an action of
  `none` returns a plain prompt with no note. Nothing is written in any of
  these cases.
- **What is sent.** Only the owner's message and the fixed action list, never
  holdings or watchlist.
- **Tests.** Never call Gemini: `LlmClient` is overridden with a stub in the
  unit, e2e and browser suites.

## The prompt for the owner's Gemini

Carries the owner's message, today's date, his holdings and his watchlist
symbols. Its content is deliberately minimal; it is designed in a later
working session (see [the backlog](backlog.md)).

## Update this document when

- the router's model, key, timeout, fallback or what it sends changes;
- the prompt's content or format changes materially; or
- any other in-product AI call is introduced (a deliberate owner decision).
