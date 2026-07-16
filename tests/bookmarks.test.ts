import { describe, it, expect } from 'vitest';
import { computeAnchor, resolveBookmarkLine } from '../src/renderer/src/bookmarks';
import type { SymbolHit } from '../src/indexer/api';

const sym = (name: string, line0: number): SymbolHit =>
  ({ id: 1, name, kind: 'function', scope: '', signature: '', path: 'a.ts', line: line0, nameLine: line0, nameCol: 0 } as SymbolHit);

describe('computeAnchor', () => {
  it('줄 이전의 가장 가까운 심볼 + 오프셋', () => {
    const syms = [sym('foo', 4), sym('bar', 19)]; // 0-기반 → 1-기반 5, 20
    expect(computeAnchor(syms, 25)).toEqual({ anchorName: 'bar', anchorLine: 20, offset: 5 });
    expect(computeAnchor(syms, 7)).toEqual({ anchorName: 'foo', anchorLine: 5, offset: 2 });
  });
  it('앞선 심볼이 없으면 anchorName null', () => {
    expect(computeAnchor([sym('foo', 9)], 3)).toEqual({ anchorName: null, anchorLine: 0, offset: 3 });
  });
});

describe('resolveBookmarkLine', () => {
  const bm = { path: 'a.ts', line: 25, anchorName: 'bar', anchorLine: 20, offset: 5, text: '' };
  it('앵커 심볼이 이동하면 따라간다', () => {
    expect(resolveBookmarkLine([sym('bar', 29)], bm)).toBe(35); // bar가 30행으로 → 30+5
  });
  it('앵커 유실 시 저장된 줄로 폴백', () => {
    expect(resolveBookmarkLine([sym('other', 0)], bm)).toBe(25);
  });
});
