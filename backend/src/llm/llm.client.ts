import { Injectable } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

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
 * Google Gemini, chosen because its free tier covers this use (Flash: 10
 * req/min, 250 req/day) and it offers Google Search grounding (5,000 free
 * grounded prompts/month) — the only free option meeting the "browse the
 * internet if needed" requirement. See docs/trader-profile.md's neighbours
 * for the reasoning; nothing else in the repo should import `@google/genai`.
 */
@Injectable()
export class GeminiClient extends LlmClient {
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
      throw new Error('LlmClient is not configured (LLM_API_KEY is unset)');
    }

    const response = await this.ai().models.generateContent({
      model: this.model,
      contents: user,
      config: {
        systemInstruction: system,
        // Gemini enables Google Search grounding by attaching the tool; no
        // grounded request is made unless the caller opts in.
        ...(grounded ? { tools: [{ googleSearch: {} }] } : {}),
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error('Gemini returned an empty response');
    }
    return text;
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
