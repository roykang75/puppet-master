// 채팅 스트리밍 오케스트레이션 — electron 임포트 금지. 무상태(이력은 렌더러 소유), 동시 1개.
import { AnthropicChatAdapter, OpenAIChatAdapter, type ChatAdapter } from './adapters';
import { classifyError } from '../completion/errors';
import type { ChatContext, ChatEvent, ChatMessage } from '../../shared/protocol';

export interface ChatDeps {
  getSettings(): { provider: 'none' | 'anthropic' | 'openai'; model: string; baseURL?: string };
  getApiKey(): string | null;
  adapterFactory?: (
    provider: 'anthropic' | 'openai',
    cfg: { model: string; apiKey: string | null; baseURL?: string },
  ) => ChatAdapter;
}

const defaultFactory: NonNullable<ChatDeps['adapterFactory']> = (provider, cfg) =>
  provider === 'anthropic'
    ? new AnthropicChatAdapter({ model: cfg.model, apiKey: cfg.apiKey ?? '' })
    : new OpenAIChatAdapter({ model: cfg.model, apiKey: cfg.apiKey ?? undefined, baseURL: cfg.baseURL });

export class ChatService {
  private controller: AbortController | null = null;
  private readonly factory: NonNullable<ChatDeps['adapterFactory']>;

  constructor(private deps: ChatDeps) {
    this.factory = deps.adapterFactory ?? defaultFactory;
  }

  isStreaming(): boolean {
    return this.controller !== null;
  }

  async send(messages: ChatMessage[], context: ChatContext | null, onEvent: (e: ChatEvent) => void): Promise<void> {
    if (this.controller) {
      onEvent({ type: 'error', kind: 'other' }); // 동시 1개 — 기존 스트림 유지
      return;
    }
    const settings = this.deps.getSettings();
    if (settings.provider === 'none') {
      onEvent({ type: 'error', kind: 'other' });
      return;
    }
    const apiKey = this.deps.getApiKey();
    if (settings.provider === 'anthropic' && !apiKey) {
      onEvent({ type: 'error', kind: 'auth' });
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    try {
      const adapter = this.factory(settings.provider, {
        model: settings.model,
        apiKey,
        baseURL: settings.baseURL,
      });
      await adapter.chatStream(messages, context, (text) => onEvent({ type: 'chunk', text }), controller.signal);
      onEvent({ type: 'done' });
    } catch (e) {
      if (controller.signal.aborted) {
        onEvent({ type: 'done' }); // 취소는 오류가 아님 — 부분 응답 유지 (스펙 §4)
      } else {
        const err = e as { status?: number; message?: string };
        console.error(`[chat] provider error kind=${classifyError(e)} status=${err?.status ?? '-'}: ${err?.message ?? e}`);
        onEvent({ type: 'error', kind: classifyError(e) === 'unsuitable' ? 'other' : (classifyError(e) as 'auth' | 'transient' | 'other') });
      }
    } finally {
      this.controller = null;
    }
  }

  cancel(): void {
    this.controller?.abort();
  }
}
