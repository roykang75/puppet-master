import Anthropic from '@anthropic-ai/sdk';
import {
  buildSystemPrompt,
  buildUserPrompt,
  postProcess,
  STOP_SEQUENCES,
  MAX_COMPLETION_TOKENS,
  type BuiltContext,
} from './prompt';

export interface ProviderAdapter {
  complete(ctx: BuiltContext): Promise<string | null>;
}

// 어댑터가 의존하는 최소 인터페이스 (테스트에서 fake 주입 가능)
export interface AnthropicLikeClient {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: 'user'; content: string }>;
      stop_sequences: string[];
    }): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

export class AnthropicAdapter implements ProviderAdapter {
  private client: AnthropicLikeClient;

  constructor(
    private cfg: { model: string; apiKey: string },
    client?: AnthropicLikeClient,
  ) {
    this.client = client ?? new Anthropic({ apiKey: cfg.apiKey, timeout: 10_000, maxRetries: 0 });
  }

  async complete(ctx: BuiltContext): Promise<string | null> {
    const res = await this.client.messages.create({
      model: this.cfg.model,
      max_tokens: MAX_COMPLETION_TOKENS,
      system: buildSystemPrompt(ctx),
      messages: [{ role: 'user', content: buildUserPrompt(ctx) }],
      stop_sequences: STOP_SEQUENCES,
    });
    const text = res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    return postProcess(text, ctx.prefix);
  }
}
