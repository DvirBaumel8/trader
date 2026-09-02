import { Injectable, Logger } from '@nestjs/common';
import { ApiError, GoogleGenAI } from '@google/genai';

export interface CompleteParams {
  /** The role/system prompt — see prompts.ts. */
  system: string;
  /** The user turn — typically the assembled facts block. */
  user: string;
  /**
   * Requests web-search grounding when the provider supports it, per the
   * owner's "browse the internet if needed" requirement. Providers that
   * cannot ground silently ignore this rather than failing the call.
   */
  grounded?: boolean;
}

/**
 * The only file permitted to import an AI SDK, exactly as `yahoo.client.ts`
 * is the only file permitted to import `yahoo-finance2`. Swapping providers
 * (or adding a second one behind `LLM_PROVIDER`) should touch only this file.
 *
 * An abstract class rather than a plain `interface` so it doubles as a Nest
 * DI token: callers inject `LlmClient` and tests substitute a fake via
 * `{ provide: LlmClient, useValue: fake }` without needing a separate symbol.
 */
export abstract class LlmClient {
  /** False when no provider is configured — callers must degrade, not throw. */
  abstract isConfigured(): boolean;
  abstract complete(params: CompleteParams): Promise<string>;
  /** Which model a `complete()` call would use — recorded alongside saved summaries. */
  abstract modelName(): string;
}

/**
 * The distinct ways a `complete()` call can fail, coarse enough that the UI
 * can say something true and different for each without knowing anything
 * about the provider:
 *
 * - `busy` — the model is temporarily overloaded (Gemini free tier returns
 *   503 UNAVAILABLE under load). Worth another tap in a moment.
 * - `quota_exceeded` — a 429 rate limit that retrying did not clear, which
 *   on the free tier usually means the daily allotment is spent. Not worth
 *   retrying now.
 * - `setup_problem` — the request cannot succeed no matter how many times
 *   it's retried: bad/expired key (401/403), wrong model name (404), or a
 *   malformed request (400). A developer problem, not a transient one.
 * - `unknown` — anything else (network failure, an empty response body,
 *   etc.) — falls back to the old generic copy.
 */
export type LlmFailureKind = 'busy' | 'quota_exceeded' | 'setup_problem' | 'unknown';

/** Thrown by `complete()` once retries are exhausted or a non-transient failure is hit. */
export class LlmFailure extends Error {
  readonly kind: LlmFailureKind;

  constructor(kind: LlmFailureKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LlmFailure';
    this.kind = kind;
  }
}

const RETRYABLE_KINDS: ReadonlySet<LlmFailureKind> = new Set(['busy', 'quota_exceeded']);

/** Classifies a raw error from the provider SDK. Anything without a recognised HTTP status is `unknown` and is never retried. */
function classify(err: unknown): LlmFailureKind {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 503:
        return 'busy';
      case 429:
        return 'quota_exceeded';
      case 400:
      case 401:
      case 403:
      case 404:
        return 'setup_problem';
      default:
        return 'unknown';
    }
  }
  return 'unknown';
}

export interface RetryOptions {
  /** Total attempts including the first — default 3, i.e. up to 2 retries. */
  maxAttempts?: number;
  /** Delay before the first retry; doubles each attempt after. Default 1000ms. */
  baseDelayMs?: number;
  /** Injectable so tests can skip real waiting. Defaults to a real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retries `fn` on the transient failure kinds (`busy`, `quota_exceeded`)
 * with short exponential backoff, then gives up and throws `LlmFailure`.
 * Everything else fails on the first attempt — retrying a bad API key or a
 * bad model name cannot succeed, and would just make the owner wait longer
 * for the same answer.
 *
 * With the defaults (3 attempts, 1s base delay) the added wait if every
 * attempt fails is 1s + 2s = 3s total — enough to ride out a momentary
 * blip, short enough that a phone user isn't left staring at a spinner.
 *
 * Exported (rather than kept private to `GeminiClient`) so tests can drive
 * it directly against a mocked `fn` and an instant `sleep`, without needing
 * a real model call or a real clock.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const sleep = opts.sleep ?? defaultSleep;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const kind = classify(err);
      if (!RETRYABLE_KINDS.has(kind) || attempt >= maxAttempts) {
        const message = err instanceof Error ? err.message : String(err);
        throw new LlmFailure(kind, message, { cause: err });
      }
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
}

/**
 * Google Gemini, chosen because its free tier covers this use (Flash: 10
 * req/min, 250 req/day) and it offers Google Search grounding (5,000 free
 * grounded prompts/month) — the only free option meeting the "browse the
 * internet if needed" requirement. See docs/trader-profile.md's neighbours
 * for the reasoning; nothing else in the repo should import `@google/genai`.
 */
@Injectable()
export class GeminiClient extends LlmClient {
  private readonly logger = new Logger(GeminiClient.name);
  private readonly apiKey = process.env.LLM_API_KEY;
  private readonly provider = process.env.LLM_PROVIDER ?? 'gemini';
  private readonly model = process.env.LLM_MODEL ?? 'gemini-2.5-flash';
  private client: GoogleGenAI | null = null;

  isConfigured(): boolean {
    // The env carries the choice of provider even though this class only
    // implements one: an unrecognised LLM_PROVIDER must not silently call
    // Gemini with someone else's key, it must report itself unconfigured.
    return this.provider === 'gemini' && Boolean(this.apiKey);
  }

  modelName(): string {
    return this.model;
  }

  async complete({ system, user, grounded }: CompleteParams): Promise<string> {
    if (!this.isConfigured()) {
      throw new LlmFailure('setup_problem', 'LlmClient is not configured (LLM_API_KEY is unset)');
    }

    let attempt = 0;
    return withRetry(async () => {
      attempt += 1;
      try {
        const response = await this.ai().models.generateContent({
          model: this.model,
          contents: user,
          config: {
            systemInstruction: system,
            // Gemini enables Google Search grounding by attaching the tool;
            // no grounded request is made unless the caller opts in.
            ...(grounded ? { tools: [{ googleSearch: {} }] } : {}),
          },
        });

        const text = response.text;
        if (!text) {
          throw new Error('Gemini returned an empty response');
        }
        return text;
      } catch (err) {
        // Attempt-level visibility, distinct from the single final warning
        // LlmService logs once retries are exhausted — this is what shows
        // whether a blip cleared on retry or persisted across all of them.
        this.logger.warn(`Gemini call attempt ${attempt} failed: ${(err as Error).message}`);
        throw err;
      }
    });
  }

  private ai(): GoogleGenAI {
    // Constructed lazily so a missing key never throws at module load —
    // only a real `complete()` call needs a live client, and isConfigured()
    // already gates every caller before that happens.
    if (!this.client) {
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
    }
    return this.client;
  }
}
