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
import { UnsuitableModelError } from './errors';

// 어댑터가 의존하는 최소 인터페이스 (테스트에서 fake 주입 가능)
export interface OpenAILikeClient {
  chat: {
    completions: {
      create(params: {
        model: string;
        max_tokens: number;
        stop: string[];
        messages: Array<{ role: 'system' | 'user'; content: string }>;
      }): Promise<{
        choices: Array<{ message?: { content?: string | null; reasoning_content?: string | null } }>;
      }>;
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
        // 로컬/자가 호스팅 서버는 유휴 시 모델을 내렸다가 첫 요청에 재로드하므로 콜드 스타트가 10초를 넘을 수 있다
        timeout: 30_000,
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
    const message = res.choices[0]?.message;
    const content = message?.content;
    if (!content?.trim()) {
      // content 없이 reasoning_content만 있으면 추론 모델이 max_tokens를 생각에 소모한 것 (LM Studio 확장 필드)
      if (message?.reasoning_content?.trim()) throw new UnsuitableModelError();
      return null;
    }
    return postProcess(content, ctx.prefix);
  }
}
