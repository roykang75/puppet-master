import { describe, it, expect } from 'vitest';
import {
  extractSearchTerms,
  buildRetrieved,
  MAX_RETRIEVED_TOTAL,
} from '../src/renderer/src/chat-retrieval';
import type { SymbolHit, TextHit } from '../src/indexer/api';

const sym = (over: Partial<SymbolHit>): SymbolHit => ({
  id: 1, name: 'fn', kind: 'function', scope: '', signature: 'function fn()',
  path: 'src/a.ts', line: 9, nameLine: 9, nameCol: 0, ...over,
});
const txt = (path: string, snippet = 'hit'): TextHit => ({ path, snippet });

describe('extractSearchTerms', () => {
  it('식별자 토큰 추출 + 불용어/짧은 토큰 제거', () => {
    const terms = extractSearchTerms('how does renderSnippet handle the cache?');
    expect(terms).toContain('renderSnippet');
    expect(terms).toContain('cache');
    expect(terms).not.toContain('how'); // 불용어
    expect(terms).not.toContain('the'); // 불용어
  });

  it('길이순 정렬 + 중복 제거 + 상위 6개', () => {
    const terms = extractSearchTerms('alpha alpha bb longIdentifier mid xyz abcd efgh ijkl');
    expect(terms).not.toContain('bb'); // 2자 → 제외
    expect(terms.filter((t) => t === 'alpha')).toHaveLength(1); // 중복 제거
    expect(terms[0]).toBe('longIdentifier'); // 가장 긴 것 우선
    expect(terms.length).toBeLessThanOrEqual(6);
  });

  it('검색어 없으면 빈 배열', () => {
    expect(extractSearchTerms('어떻게 해줘?')).toEqual([]);
  });
});

describe('buildRetrieved', () => {
  it('심볼은 정의 위치(1-기반)와 시그니처 포함', () => {
    const r = buildRetrieved([sym({ path: 'src/b.ts', nameLine: 4, signature: 'class B' })], []);
    expect(r[0]).toMatchObject({ path: 'src/b.ts', line: 5, signature: 'class B' });
  });

  it('활성 파일은 제외 (이미 컨텍스트에 있음)', () => {
    const r = buildRetrieved([sym({ path: 'src/active.ts' })], [txt('src/active.ts')], 'src/active.ts');
    expect(r).toHaveLength(0);
  });

  it('심볼로 다룬 파일의 텍스트 히트는 중복 스킵', () => {
    const r = buildRetrieved([sym({ path: 'src/x.ts' })], [txt('src/x.ts'), txt('src/y.ts')]);
    expect(r.map((s) => s.path)).toEqual(['src/x.ts', 'src/y.ts']);
  });

  it('총 개수 상한 적용', () => {
    const syms = Array.from({ length: 10 }, (_, i) => sym({ path: `src/s${i}.ts` }));
    const texts = Array.from({ length: 10 }, (_, i) => txt(`src/t${i}.ts`));
    expect(buildRetrieved(syms, texts).length).toBeLessThanOrEqual(MAX_RETRIEVED_TOTAL);
  });
});
