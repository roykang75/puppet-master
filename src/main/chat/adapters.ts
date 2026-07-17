// 스트리밍 채팅 어댑터 — 클라이언트 주입 가능 (completion 어댑터와 같은 패턴).
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { buildChatSystemPrompt, CHAT_MAX_TOKENS } from './prompt';
import type { ChatContext, ChatMessage } from '../../shared/protocol';

export interface ChatAdapter {
  chatStream(
    messages: ChatMessage[],
    context: ChatContext | null,
    onChunk: (text: string) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

// ── Anthropic ──
export interface AnthropicChatClient {
  messages: {
    create(
      params: {
        model: string;
        max_tokens: number;
        stream: true;
        system: string;
        messages: ChatMessage[];
      },
      opts: { signal: AbortSignal },
    ): Promise<AsyncIterable<{ type: string; delta?: { type?: string; text?: string } }>>;
  };
}

export class AnthropicChatAdapter implements ChatAdapter {
  private client: AnthropicChatClient;

  constructor(
    private cfg: { model: string; apiKey: string },
    client?: AnthropicChatClient,
  ) {
    this.client = client ?? (new Anthropic({ apiKey: cfg.apiKey, maxRetries: 0 }) as unknown as AnthropicChatClient);
  }

  async chatStream(
    messages: ChatMessage[],
    context: ChatContext | null,
    onChunk: (text: string) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const stream = await this.client.messages.create(
      {
        model: this.cfg.model,
        max_tokens: CHAT_MAX_TOKENS,
        stream: true,
        system: buildChatSystemPrompt(context),
        messages,
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
        onChunk(event.delta.text);
      }
    }
  }
}

// ── OpenAI 호환 ──
export interface OpenAIChatClient {
  chat: {
    completions: {
      create(
        params: {
          model: string;
          max_tokens: number;
          stream: true;
          messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
        },
        opts: { signal: AbortSignal },
      ): Promise<AsyncIterable<{ choices: Array<{ delta?: { content?: string | null } }> }>>;
    };
  };
}

export class OpenAIChatAdapter implements ChatAdapter {
  private client: OpenAIChatClient;

  constructor(
    private cfg: { model: string; apiKey?: string; baseURL?: string },
    client?: OpenAIChatClient,
  ) {
    this.client =
      client ??
      (new OpenAI({ apiKey: cfg.apiKey ?? 'local', baseURL: cfg.baseURL, maxRetries: 0 }) as unknown as OpenAIChatClient);
  }

  async chatStream(
    messages: ChatMessage[],
    context: ChatContext | null,
    onChunk: (text: string) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.cfg.model,
        max_tokens: CHAT_MAX_TOKENS,
        stream: true,
        messages: [{ role: 'system', content: buildChatSystemPrompt(context) }, ...messages],
      },
      { signal },
    );
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) onChunk(text);
    }
  }
}
