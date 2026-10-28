import { Injectable, Logger } from '@nestjs/common';
import { ApiError, GoogleGenAI, ThinkingLevel } from '@google/genai';

/**
 * The only file permitted to import an AI SDK, as yahoo.client.ts is for
 * Yahoo. Used for one job: routing a chat message to a predefined action
 * (assistant/router.ts). No analysis happens in the app — that goes to the
 * owner's Gemini Pro conversation as a copy-ready prompt.
 */
export interface JsonRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  timeoutMs: number;
}

export abstract class LlmClient {
  abstract isConfigured(): boolean;
  /** Parsed JSON from the model. Throws on timeout, provider error, empty or non-JSON output. */
  abstract generateJson(req: JsonRequest): Promise<unknown>;
}

@Injectable()
export class GeminiClient extends LlmClient {
  private readonly logger = new Logger(GeminiClient.name);
  private readonly apiKey = process.env.GEMINI_API_KEY ?? process.env.LLM_API_KEY ?? '';
  private readonly model = process.env.LLM_MODEL ?? 'gemini-3.6-flash';
  private client: GoogleGenAI | null = null;

  isConfigured(): boolean {
    return this.apiKey !== '';
  }

  async generateJson({ system, user, schema, timeoutMs }: JsonRequest): Promise<unknown> {
    if (!this.isConfigured()) throw new Error('LlmClient is not configured');
    const call = (thinking: boolean) =>
      this.ai().models.generateContent({
        model: this.model,
        contents: user,
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseSchema: schema,
          ...(thinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } } : {}),
        },
      });
    const response = await withTimeout(
      call(true).catch((err) => {
        // Some models reject an explicit thinking level; retry once without.
        if (err instanceof ApiError && err.status === 400 && /thinking/i.test(err.message)) return call(false);
        throw err;
      }),
      timeoutMs,
    );
    const text = response.text;
    if (!text) throw new Error('Gemini returned an empty response');
    try {
      return JSON.parse(text);
    } catch {
      this.logger.warn(`Gemini returned non-JSON: ${text.slice(0, 200)}`);
      throw new Error('Gemini returned non-JSON output');
    }
  }

  private ai(): GoogleGenAI {
    this.client ??= new GoogleGenAI({ apiKey: this.apiKey });
    return this.client;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Gemini timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
