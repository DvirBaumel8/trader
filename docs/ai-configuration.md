# AI Configuration

> Read this before adding any AI to Trader.

Trader makes no in-product AI calls. Gemini is used by the owner directly with
prompts Trader builds in `backend/src/assistant/prompt.ts`. The backend has no
AI provider SDK, key or runtime setting.

The prompt currently carries the owner's message, today's date, his holdings
and his watchlist symbols. Its content is deliberately minimal; it is designed
in a later working session (see [the backlog](backlog.md)).

## Update this document when

- the prompt's content or format changes materially; or
- an in-product AI call is ever introduced (a deliberate owner decision).
