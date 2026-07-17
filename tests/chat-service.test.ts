import { describe, it, expect } from 'vitest';
import { ChatService } from '../src/main/chat/service';
import type { ChatAdapter } from '../src/main/chat/adapters';
import type { ChatEvent } from '../src/shared/protocol';

const settings = { provider: 'openai' as const, model: 'm', baseURL: 'http://x/v1' };

function makeAdapter(impl: ChatAdapter['chatStream']): ChatAdapter {
  return { chatStream: impl };
}

const collect = () => {
  const events: ChatEvent[] = [];
  return { events, on: (e: ChatEvent) => events.push(e) };
};

describe('ChatService', () => {
  it('정상 스트림: chunk들 → done', async () => {
    const svc = new ChatService({
      getSettings: () => settings,
      getApiKey: () => null,
      adapterFactory: () =>
        makeAdapter(async (_m, _c, onChunk) => {
          onChunk('A');
          onChunk('B');
        }),
    });
    const { events, on } = collect();
    await svc.send([{ role: 'user', content: 'q' }], null, on);
    expect(events).toEqual([{ type: 'chunk', text: 'A' }, { type: 'chunk', text: 'B' }, { type: 'done' }]);
    expect(svc.isStreaming()).toBe(false);
  });

  it('provider none → error other (2차 방어)', async () => {
    const svc = new ChatService({ getSettings: () => ({ provider: 'none', model: '' }), getApiKey: () => null });
    const { events, on } = collect();
    await svc.send([{ role: 'user', content: 'q' }], null, on);
    expect(events).toEqual([{ type: 'error', kind: 'other' }]);
  });

  it('anthropic인데 키 없음 → error auth', async () => {
    const svc = new ChatService({
      getSettings: () => ({ provider: 'anthropic', model: 'claude-haiku-4-5' }),
      getApiKey: () => null,
    });
    const { events, on } = collect();
    await svc.send([{ role: 'user', content: 'q' }], null, on);
    expect(events).toEqual([{ type: 'error', kind: 'auth' }]);
  });

  it('동시 1개 가드: 진행 중 send는 error other, 기존 스트림 유지', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const svc = new ChatService({
      getSettings: () => settings,
      getApiKey: () => null,
      adapterFactory: () =>
        makeAdapter(async (_m, _c, onChunk) => {
          onChunk('1');
          await gate;
        }),
    });
    const a = collect();
    const first = svc.send([{ role: 'user', content: 'q' }], null, a.on);
    await new Promise((r) => setTimeout(r, 20));
    const b = collect();
    await svc.send([{ role: 'user', content: 'q2' }], null, b.on);
    expect(b.events).toEqual([{ type: 'error', kind: 'other' }]);
    expect(svc.isStreaming()).toBe(true); // 기존 스트림 살아있음
    release();
    await first;
    expect(a.events.at(-1)).toEqual({ type: 'done' });
  });

  it('cancel: abort 신호 전달 + done으로 마무리 (부분 응답 유지)', async () => {
    const svc = new ChatService({
      getSettings: () => settings,
      getApiKey: () => null,
      adapterFactory: () =>
        makeAdapter(async (_m, _c, onChunk, signal) => {
          onChunk('부분');
          await new Promise<void>((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')));
          });
        }),
    });
    const { events, on } = collect();
    const p = svc.send([{ role: 'user', content: 'q' }], null, on);
    await new Promise((r) => setTimeout(r, 20));
    svc.cancel();
    await p;
    expect(events).toEqual([{ type: 'chunk', text: '부분' }, { type: 'done' }]); // abort는 error 아님
  });

  it('스트림 오류 → classifyError kind (401 → auth)', async () => {
    const svc = new ChatService({
      getSettings: () => settings,
      getApiKey: () => null,
      adapterFactory: () =>
        makeAdapter(async () => {
          const e = new Error('unauthorized') as Error & { status: number };
          e.status = 401;
          throw e;
        }),
    });
    const { events, on } = collect();
    await svc.send([{ role: 'user', content: 'q' }], null, on);
    expect(events).toEqual([{ type: 'error', kind: 'auth' }]);
  });
});
