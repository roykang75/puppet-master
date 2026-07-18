import { describe, it, expect, vi } from 'vitest';
import { Context7Service } from '../src/main/context7/service';

const okFetch = (idBody: unknown, docBody: unknown) => {
  let n = 0;
  return (async () => {
    n++;
    const body = n === 1 ? idBody : docBody;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
};

describe('Context7Service', () => {
  it('resolve→fetch 후 스니펫 반환', async () => {
    const svc = new Context7Service({ getApiKey: () => null, fetchImpl: okFetch({ results: [{ id: '/a/b' }] }, { snippets: [{ code: 'CODE' }] }) });
    expect(await svc.libraryDocs('react', 'hooks')).toContain('CODE');
  });

  it('캐시: 같은 (library, query) 두 번째 호출은 fetch 미발생', async () => {
    const impl = vi.fn(okFetch({ results: [{ id: '/a/b' }] }, { snippets: [{ code: 'CODE' }] }));
    const svc = new Context7Service({ getApiKey: () => null, fetchImpl: impl as unknown as typeof fetch });
    await svc.libraryDocs('react', 'hooks');
    const calls = impl.mock.calls.length;
    await svc.libraryDocs('react', 'hooks');
    expect(impl.mock.calls.length).toBe(calls); // 캐시 히트
  });

  it('미해석(id 없음) → 안내 문자열', async () => {
    const svc = new Context7Service({ getApiKey: () => null, fetchImpl: (async () => new Response(JSON.stringify({ results: [] }), { status: 200 })) as unknown as typeof fetch });
    expect(await svc.libraryDocs('nope', 'x')).toContain('찾지 못');
  });

  it('429 → 안내 문자열(예외 아님)', async () => {
    const svc = new Context7Service({ getApiKey: () => null, fetchImpl: (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch });
    const r = await svc.libraryDocs('react', 'x');
    expect(r).toContain('제한');
  });
});
