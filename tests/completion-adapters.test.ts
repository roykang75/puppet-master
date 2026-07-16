import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { AnthropicAdapter, type AnthropicLikeClient } from '../src/main/completion/anthropic-adapter';
import { OpenAIAdapter, type OpenAILikeClient } from '../src/main/completion/openai-adapter';
import { classifyError } from '../src/main/completion/errors';
import { MAX_COMPLETION_TOKENS, STOP_SEQUENCES, type BuiltContext } from '../src/main/completion/prompt';

function ctx(over: Partial<BuiltContext> = {}): BuiltContext {
  return {
    path: 'src/app.ts',
    languageId: 'typescript',
    prefix: 'function add(a, b) {\n  return ',
    suffix: '\n}',
    symbolSignatures: [],
    ...over,
  };
}

describe('AnthropicAdapter', () => {
  it('올바른 파라미터를 전달하고 text 블록을 후처리해 반환한다', async () => {
    let seen: any = null;
    const fake: AnthropicLikeClient = {
      messages: {
        create: async (params) => {
          seen = params;
          return { content: [{ type: 'text', text: 'a + b;' }] } as any;
        },
      },
    };
    const adapter = new AnthropicAdapter({ model: 'claude-haiku-4-5', apiKey: 'sk-x' }, fake);
    const out = await adapter.complete(ctx());
    expect(out).toBe('a + b;');
    expect(seen.model).toBe('claude-haiku-4-5');
    expect(seen.max_tokens).toBe(MAX_COMPLETION_TOKENS);
    expect(typeof seen.system).toBe('string');
    expect(seen.system.length).toBeGreaterThan(0);
    expect(seen.stop_sequences).toEqual(STOP_SEQUENCES);
    expect(seen.messages).toEqual([{ role: 'user', content: expect.stringContaining('<CURSOR>') }]);
  });

  it('여러 블록 중 text 블록들만 합친다', async () => {
    const fake: AnthropicLikeClient = {
      messages: {
        create: async () =>
          ({ content: [{ type: 'thinking' }, { type: 'text', text: 'x();' }] }) as any,
      },
    };
    const adapter = new AnthropicAdapter({ model: 'm', apiKey: 'k' }, fake);
    expect(await adapter.complete(ctx())).toBe('x();');
  });

  it('text가 공백뿐이면 null', async () => {
    const fake: AnthropicLikeClient = {
      messages: { create: async () => ({ content: [{ type: 'text', text: '   ' }] }) as any },
    };
    const adapter = new AnthropicAdapter({ model: 'm', apiKey: 'k' }, fake);
    expect(await adapter.complete(ctx())).toBeNull();
  });
});

describe('OpenAIAdapter', () => {
  it('system+user 메시지와 stop/max_tokens를 전달하고 content를 후처리한다', async () => {
    let seen: any = null;
    const fake: OpenAILikeClient = {
      chat: {
        completions: {
          create: async (params) => {
            seen = params;
            return { choices: [{ message: { content: 'a + b;' } }] } as any;
          },
        },
      },
    };
    const adapter = new OpenAIAdapter({ model: 'local-model', baseURL: 'http://x/v1' }, fake);
    const out = await adapter.complete(ctx());
    expect(out).toBe('a + b;');
    expect(seen.model).toBe('local-model');
    expect(seen.max_tokens).toBe(MAX_COMPLETION_TOKENS);
    expect(seen.stop).toEqual(STOP_SEQUENCES);
    expect(seen.messages[0].role).toBe('system');
    expect(seen.messages[1].role).toBe('user');
    expect(seen.messages[1].content).toContain('<CURSOR>');
  });

  it('content가 없으면 null', async () => {
    const fake: OpenAILikeClient = {
      chat: { completions: { create: async () => ({ choices: [{ message: { content: null } }] }) as any } },
    };
    const adapter = new OpenAIAdapter({ model: 'm' }, fake);
    expect(await adapter.complete(ctx())).toBeNull();
  });
});

describe('classifyError', () => {
  it('상태 코드 기반 분류', () => {
    expect(classifyError({ status: 401 })).toBe('auth');
    expect(classifyError({ status: 403 })).toBe('auth');
    expect(classifyError({ status: 429 })).toBe('transient');
    expect(classifyError({ status: 500 })).toBe('transient');
    expect(classifyError({ status: 503 })).toBe('transient');
    expect(classifyError({ status: 400 })).toBe('other');
    expect(classifyError({ status: undefined })).toBe('other');
    expect(classifyError(new Error('nope'))).toBe('other');
    expect(classifyError(null)).toBe('other');
  });

  it('Anthropic.APIConnectionError 실인스턴스 → transient', () => {
    const e = new Anthropic.APIConnectionError({ message: 'boom' });
    expect(classifyError(e)).toBe('transient');
  });

  it('OpenAI.APIConnectionError 실인스턴스 → transient', () => {
    const e = new OpenAI.APIConnectionError({ message: 'boom' });
    expect(classifyError(e)).toBe('transient');
  });
});
