import { describe, it, expect } from 'vitest';
import { searchLibrary, getDocs, RateLimitError, DOCS_CAP } from '../src/main/context7/client';

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('searchLibrary', () => {
  it('최적 매치 id 반환 + Bearer 헤더', async () => {
    let seen: Request | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = new Request(url, init);
      return jsonRes({ results: [{ id: '/facebook/react' }, { id: '/x/y' }] });
    }) as unknown as typeof fetch;
    const id = await searchLibrary('react', 'hooks', 'ctx7sk_abc', fetchImpl);
    expect(id).toBe('/facebook/react');
    expect(seen?.headers.get('authorization')).toBe('Bearer ctx7sk_abc');
    expect(seen?.url).toContain('libraryName=react');
  });
  it('매치 없으면 null', async () => {
    const fetchImpl = (async () => jsonRes({ results: [] })) as unknown as typeof fetch;
    expect(await searchLibrary('nope', 'x', null, fetchImpl)).toBeNull();
  });
  it('429 → RateLimitError', async () => {
    const fetchImpl = (async () => jsonRes({}, 429)) as unknown as typeof fetch;
    await expect(searchLibrary('react', 'x', null, fetchImpl)).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe('getDocs', () => {
  it('스니펫 텍스트 반환 + 키 없으면 헤더 없음', async () => {
    let seen: Request | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = new Request(url, init);
      return jsonRes({ snippets: [{ code: 'const x=1', description: 'desc' }] });
    }) as unknown as typeof fetch;
    const txt = await getDocs('/facebook/react', 'hooks', null, fetchImpl);
    expect(txt).toContain('const x=1');
    expect(seen?.headers.get('authorization')).toBeNull();
  });
  it('상한 절단', async () => {
    const big = 'x'.repeat(DOCS_CAP + 5000);
    const fetchImpl = (async () => jsonRes({ snippets: [{ code: big }] })) as unknown as typeof fetch;
    const txt = await getDocs('/a/b', 'q', null, fetchImpl);
    expect(txt.length).toBeLessThanOrEqual(DOCS_CAP + 100);
  });
});
