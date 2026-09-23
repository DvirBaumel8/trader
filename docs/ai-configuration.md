# AI Runtime Configuration

> Read this before changing Trader's in-product AI model, provider, key, grounding, or thinking level.

## Supported settings

The code in `backend/src/llm/llm.client.ts` and
`backend/src/llm/llm.service.ts` is the source of truth. Only
`llm.client.ts` imports the provider SDK; application services depend on
`LlmClient` instead.

| Setting | Default / accepted values | Runtime effect |
| --- | --- | --- |
| `GEMINI_API_KEY` | unset | Preferred secret credential. When it is non-empty, it takes precedence over `LLM_API_KEY`. |
| `LLM_API_KEY` | unset | Legacy secret credential, used only when `GEMINI_API_KEY` is unset. |
| `LLM_PROVIDER` | `gemini` | `gemini` is the only supported value. Any other value leaves the client unconfigured. |
| `LLM_MODEL` | `gemini-2.5-flash` | Model identifier passed to the Gemini client, when a call does not override it. Watchlist ranking used to override this to `gemini-2.5-flash-lite` for its larger free-tier quota, but that model rejects `thinkingConfig` outright ("Thinking level is not supported for this model") and, with no thinking budget to spend on it, was unreliable about following the ranking's `[RANK]` output format — it now uses the default model like every other feature. |
| `LLM_THINKING_LEVEL` | unset; `MINIMAL`, `LOW`, `MEDIUM`, or `HIGH` | Sets Gemini's thinking level, when a call does not override it. An unset or unrecognised value is ignored, preserving the provider default. Trade idea and symbol pattern always request `MINIMAL` instead — both are short, structured output where a full budget added no visible answer quality, only latency. A fourth per-call value, `NONE`, means "never send `thinkingConfig`" (not merely "no opinion, inherit the default") — for a model that rejects the field entirely rather than one that merely doesn't need much of it. |
| `LLM_GROUNDED` | unset / false; exactly `true` enables it | Enables Google Search grounding for portfolio summaries only. Other AI features explicitly request `grounded: false`. |

Keys are secrets and belong in the local environment or the hosting provider's
environment dashboard. Model, provider, thinking, and grounding settings are
plain runtime configuration, but still need the verification below.

## Model-only change

Use this path when Gemini remains the provider and only its model or a supported
thinking level changes.

1. Make no TypeScript change; set `LLM_MODEL` and, if needed,
   `LLM_THINKING_LEVEL` in the relevant local or production environment.
2. Keep credentials in that environment rather than source control. If both key
   variables are set, remember that `GEMINI_API_KEY` wins.
3. Run the focused LLM tests in [Verification](#verification).
4. Perform an authenticated smoke test of an AI feature, such as requesting a
   portfolio summary, in the environment whose setting changed.

## Provider change

A value other than `gemini` is deliberately disabled today; setting one does not
select another provider. A provider change is application work, not an
environment-only switch.

1. Add an adapter behind `LlmClient`; callers must continue to inject that
   abstraction.
2. Keep every provider SDK import in `backend/src/llm/llm.client.ts`; no other
   application file may import a provider SDK.
3. Add focused fake-client tests for configuration and failure behaviour, with
   no live provider call.
4. Define and test the adapter's explicit behaviour when the provider lacks
   grounding or streaming. Grounding may be safely ignored as the interface
   permits; streaming must have a tested fallback or a clear unavailable result,
   never an implicit mismatch with `completeStream`.
5. Update this reference, `.env.example`, and deployment guidance before making
   the provider selectable.

## Expected disabled behavior

With no usable key, or with any unsupported `LLM_PROVIDER`, `LlmClient` reports
itself unconfigured. Callers check that state and AI features degrade without a
provider request; the portfolio-summary response reports `configured: false`
rather than treating absent configuration as a model failure. A present key
that the provider rejects is a setup problem, not the disabled state.

## Verification

Run these after a configuration or adapter change. The focused tests mock the
provider SDK and must not make a live API call.

```bash
rg -n 'LLM_(API_KEY|PROVIDER|MODEL|THINKING_LEVEL|GROUNDED)|GEMINI_API_KEY' .env.example docs/ai-configuration.md docs/DEPLOYMENT.md backend/src/llm/llm.client.ts backend/src/llm/llm.service.ts render.yaml
npm run test --prefix backend -- --run src/llm/llm.client.spec.ts src/llm/llm.service.spec.ts
```

Then sign in and smoke-test an affected AI feature in the changed environment.

## Update this document when

- an environment setting, default, accepted value, or key precedence changes;
- a provider or model adapter is added, removed, or gains a capability;
- grounding or streaming behaviour changes; or
- an AI feature begins to read a setting or makes a different grounding choice.
