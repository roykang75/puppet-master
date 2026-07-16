import OpenAI from 'openai';
import {
  buildSystemPrompt,
  buildUserPrompt,
  postProcess,
  STOP_SEQUENCES,
  MAX_COMPLETION_TOKENS,
  type BuiltContext,
} from './prompt';
import type { ProviderAdapter } from './anthropic-adapter';

// 어댑터가 의존하는 최소 인터페이스 (테스트에서 fake 주입 가능)
export interface OpenAILikeClient {
  chat: {
    completions: {
      create(params: {
        model: string;
        max_tokens: number;
        stop: string[];
        messages: Array<{ role: 'system' | 'user'; content: string }>;
      }): Promise<{ choices: Array<{ message?: { content?: string | null } }> }>;
    };
  };
}

export class OpenAIAdapter implements ProviderAdapter {
  private client: OpenAILikeClient;

  constructor(
    private cfg: { model: string; apiKey?: string; baseURL?: string },
    client?: OpenAILikeClient,
  ) {
    this.client =
      client ??
      new OpenAI({
        apiKey: cfg.apiKey ?? 'local',
        baseURL: cfg.baseURL,
        timeout: 10_000,
        maxRetries: 0,
      });
  }

  async complete(ctx: BuiltContext): Promise<string | null> {
    const res = await this.client.chat.completions.create({
      model: this.cfg.model,
      max_tokens: MAX_COMPLETION_TOKENS,
      stop: STOP_SEQUENCES,
      messages: [
        { role: 'system', content: buildSystemPrompt(ctx) },
        { role: 'user', content: buildUserPrompt(ctx) },
      ],
    });
    const content = res.choices[0]?.message?.content;
    if (!content) return null;
    return postProcess(content, ctx.prefix);
  }
}
