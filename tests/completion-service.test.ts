import { describe, it, expect } from 'vitest';
import { CompletionService, type AdapterFactory } from '../src/main/completion/service';
import type { ProviderAdapter } from '../src/main/completion/anthropic-adapter';
import type { BuiltContext } from '../src/main/completion/prompt';
import type { StoredCompletionSettings } from '../src/main/settings';
import type { CompletionContext } from '../src/shared/protocol';

function ctx(over: Partial<CompletionContext> = {}): CompletionContext {
  return {
    path: 'src/app.ts',
    languageId: 'typescript',
    prefix: 'const x = ',
    suffix: ';',
    ...over,
  };
}

// 각 테스트가 조작 가능한 가변 상태를 담은 하네스
function harness(init: {
  settings?: StoredCompletionSettings;
  apiKey?: string | null;
  outline?: (path: string) => Promise<Array<{ signature: string }>>;
}) {
  const state = {
    settings: init.settings ?? ({ provider: 'anthropic', model: 'm' } as StoredCompletionSettings),
    apiKey: init.apiKey === undefined ? ('sk-x' as string | null) : init.apiKey,
    outlineCalls: 0,
    factoryCalls: 0,
    completeCalls: [] as BuiltContext[],
    completeResult: 'RESULT' as string | null,
    completeThrows: null as unknown,
  };

  const adapter: ProviderAdapter = {
    async complete(c: BuiltContext) {
      state.completeCalls.push(c);
      if (state.completeThrows) throw state.completeThrows;
      return state.completeResult;
    },
  };

  const adapterFactory: AdapterFactory = () => {
    state.factoryCalls++;
    return adapter;
  };

  const getOutline = init.outline ?? (async () => [{ signature: 'foo(a: number): void' }]);

  const service = new CompletionService({
    getSettings: () => state.settings,
    getApiKey: () => state.apiKey,
    getOutline: async (p: string) => {
      state.outlineCalls++;
      return getOutline(p);
    },
    adapterFactory,
  });

  return { service, state };
}

describe('CompletionService', () => {
  it('(a) provider none → text null, 어댑터/아웃라인 미호출', async () => {
    const { service, state } = harness({ settings: { provider: 'none', model: '' } });
    const res = await service.request(ctx());
    expect(res).toEqual({ text: null });
    expect(state.factoryCalls).toBe(0);
    expect(state.outlineCalls).toBe(0);
    expect(state.completeCalls.length).toBe(0);
  });

  it('(a2) anthropic인데 키 없음 → text null, 어댑터 미호출', async () => {
    const { service, state } = harness({ settings: { provider: 'anthropic', model: 'm' }, apiKey: null });
    const res = await service.request(ctx());
    expect(res).toEqual({ text: null });
    expect(state.factoryCalls).toBe(0);
    expect(state.completeCalls.length).toBe(0);
  });

  it('(a3) openai는 키 없어도 유효 (로컬 LLM)', async () => {
    const { service, state } = harness({ settings: { provider: 'openai', model: 'qwen' }, apiKey: null });
    const res = await service.request(ctx());
    expect(res).toEqual({ text: 'RESULT' });
    expect(state.factoryCalls).toBe(1);
    expect(state.completeCalls.length).toBe(1);
  });

  it('(b) 아웃라인 캐시 히트 — 같은 path 두 번째 요청은 getOutline 재호출 안 함', async () => {
    const { service, state } = harness({});
    await service.request(ctx({ path: 'a.ts' }));
    await service.request(ctx({ path: 'a.ts' }));
    expect(state.outlineCalls).toBe(1);
    // 시그니처가 두 요청 모두에 전달됨
    expect(state.completeCalls[0].symbolSignatures).toEqual(['foo(a: number): void']);
    expect(state.completeCalls[1].symbolSignatures).toEqual(['foo(a: number): void']);
  });

  it('(c) invalidateOutline 후 해당 path 재조회', async () => {
    const { service, state } = harness({});
    await service.request(ctx({ path: 'a.ts' }));
    service.invalidateOutline('a.ts');
    await service.request(ctx({ path: 'a.ts' }));
    expect(state.outlineCalls).toBe(2);
  });

  it('(d) getOutline throw → 시그니처 [] 로 어댑터 호출 지속', async () => {
    const { service, state } = harness({
      outline: async () => {
        throw new Error('인덱서 없음');
      },
    });
    const res = await service.request(ctx());
    expect(res).toEqual({ text: 'RESULT' });
    expect(state.completeCalls.length).toBe(1);
    expect(state.completeCalls[0].symbolSignatures).toEqual([]);
  });

  it('(e) 어댑터 throw (status 401) → error.kind auth', async () => {
    const { service, state } = harness({});
    state.completeThrows = { status: 401, message: '인증 실패' };
    const res = await service.request(ctx());
    expect(res.text).toBeNull();
    expect(res.error?.kind).toBe('auth');
    expect(typeof res.error?.message).toBe('string');
  });

  it('(f) 설정 변경 + invalidateAdapter 후 adapterFactory 재호출', async () => {
    const { service, state } = harness({});
    await service.request(ctx());
    expect(state.factoryCalls).toBe(1);
    // 같은 설정 재요청은 캐시 재사용
    await service.request(ctx());
    expect(state.factoryCalls).toBe(1);
    // 설정 변경 + 무효화 → 재생성
    state.settings = { provider: 'anthropic', model: 'other' };
    service.invalidateAdapter();
    await service.request(ctx());
    expect(state.factoryCalls).toBe(2);
  });

  it('(g) 시그니처 상한 20개', async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ signature: `sig${i}()` }));
    const { service, state } = harness({ outline: async () => many });
    await service.request(ctx());
    expect(state.completeCalls[0].symbolSignatures.length).toBe(20);
  });
});
