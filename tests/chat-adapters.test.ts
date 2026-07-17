import { describe, it, expect } from 'vitest';
import { AnthropicChatAdapter, OpenAIChatAdapter, type AnthropicChatClient, type OpenAIChatClient } from '../src/main/chat/adapters';
import { CHAT_MAX_TOKENS } from '../src/main/chat/prompt';
import type { ChatContext, ChatMessage } from '../src/shared/protocol';

const msgs: ChatMessage[] = [
  { role: 'user', content: '이 함수 설명해줘' },
  { role: 'assistant', content: '어떤 함수인가요?' },
  { role: 'user', content: 'add 함수' },
];
const ctx: ChatContext = {
  path: 'a.ts', languageId: 'typescript', code: 'function add() {}',
  isSelection: false, startLine: 1, signatures: [],
};

async function* anthropicEvents() {
  yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '안녕' } };
  yield { type: 'content_block_delta', delta: { type: 'input_json_delta' } }; // 무시 대상
  yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '하세요' } };
  yield { type: 'message_stop' };
}

describe('AnthropicChatAdapter', () => {
  it('파라미터(system/messages/max_tokens/stream) + text_delta만 onChunk', async () => {
    let seen: any = null;
    let seenOpts: any = null;
    const fake: AnthropicChatClient = {
      messages: {
        create: async (params, opts) => {
          seen = params;
          seenOpts = opts;
          return anthropicEvents() as any;
        },
      },
    };
    const chunks: string[] = [];
    const ac = new AbortController();
    const adapter = new AnthropicChatAdapter({ model: 'claude-haiku-4-5', apiKey: 'sk-x' }, fake);
    await adapter.chatStream(msgs, ctx, (t) => chunks.push(t), ac.signal);
    expect(chunks).toEqual(['안녕', '하세요']);
    expect(seen.model).toBe('claude-haiku-4-5');
    expect(seen.max_tokens).toBe(CHAT_MAX_TOKENS);
    expect(seen.stream).toBe(true);
    expect(seen.system).toContain('function add() {}'); // 컨텍스트가 system에
    expect(seen.messages).toEqual(msgs); // 이력 그대로 (system 별도)
    expect(seenOpts.signal).toBe(ac.signal);
  });
});

async function* openaiChunks() {
  yield { choices: [{ delta: { content: 'A' } }] };
  yield { choices: [{ delta: {} }] }; // content 없는 청크 무시
  yield { choices: [{ delta: { content: 'B' } }] };
}

describe('OpenAIChatAdapter', () => {
  it('system 메시지 선두 + delta.content만 onChunk + signal 전달', async () => {
    let seen: any = null;
    let seenOpts: any = null;
    const fake: OpenAIChatClient = {
      chat: {
        completions: {
          create: async (params, opts) => {
            seen = params;
            seenOpts = opts;
            return openaiChunks() as any;
          },
        },
      },
    };
    const chunks: string[] = [];
    const ac = new AbortController();
    const adapter = new OpenAIChatAdapter({ model: 'local', baseURL: 'http://x/v1' }, fake);
    await adapter.chatStream(msgs, null, (t) => chunks.push(t), ac.signal);
    expect(chunks).toEqual(['A', 'B']);
    expect(seen.model).toBe('local');
    expect(seen.stream).toBe(true);
    expect(seen.max_tokens).toBe(CHAT_MAX_TOKENS);
    expect(seen.messages[0].role).toBe('system');
    expect(seen.messages.slice(1)).toEqual(msgs);
    expect(seenOpts.signal).toBe(ac.signal);
  });

  it('스트림 도중 예외는 그대로 전파', async () => {
    async function* failing() {
      yield { choices: [{ delta: { content: 'x' } }] };
      throw new Error('boom');
    }
    const fake: OpenAIChatClient = {
      chat: { completions: { create: async () => failing() as any } },
    };
    const adapter = new OpenAIChatAdapter({ model: 'm' }, fake);
    await expect(
      adapter.chatStream(msgs, null, () => {}, new AbortController().signal),
    ).rejects.toThrow('boom');
  });
});
