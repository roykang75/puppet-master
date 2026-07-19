import { describe, it, expect } from 'vitest';
import { mapChangesToSymbols, FILE_LEVEL_NAME } from '../src/shared/review-map';
import type { SymbolRow } from '../src/indexer/extractor';
import type { GitChangeRange } from '../src/shared/protocol';

// SymbolRow(0-based 줄) 헬퍼 — 겹침 판정은 startLine/endLine만 쓴다.
function sym(name: string, startLine: number, endLine: number, kind = 'function'): SymbolRow {
  return { name, kind, startLine, endLine, startCol: 0, endCol: 0, nameLine: startLine, nameCol: 0, scope: '', signature: '' };
}

describe('mapChangesToSymbols', () => {
  it('추가: add 헝크와 겹치고 옛 심볼에 없으면 added (새 줄 1-based)', () => {
    const hunks: GitChangeRange[] = [{ startLine: 1, endLine: 5, type: 'add' }];
    const r = mapChangesToSymbols(hunks, [], [sym('foo', 0, 4)]);
    expect(r).toEqual([{ name: 'foo', kind: 'function', line: 1, change: 'added' }]);
  });

  it('수정: modify 헝크와 겹치고 옛 심볼에 있으면 modified', () => {
    const hunks: GitChangeRange[] = [{ startLine: 2, endLine: 2, type: 'modify' }];
    const r = mapChangesToSymbols(hunks, [sym('foo', 0, 4)], [sym('foo', 0, 4)]);
    expect(r).toEqual([{ name: 'foo', kind: 'function', line: 1, change: 'modified' }]);
  });

  it('삭제: 옛 심볼 중 새쪽에 이름이 없으면 deleted (옛 줄 1-based)', () => {
    const hunks: GitChangeRange[] = [{ startLine: 5, endLine: 5, type: 'delete' }];
    const r = mapChangesToSymbols(hunks, [sym('foo', 0, 4), sym('bar', 5, 9)], [sym('foo', 0, 4)]);
    expect(r).toContainEqual({ name: 'bar', kind: 'function', line: 6, change: 'deleted' });
    expect(r).not.toContainEqual(expect.objectContaining({ name: 'foo' }));
    // 삭제가 있으면 delete 헝크는 설명됐다고 보고 파일수준 항목을 만들지 않는다
    expect(r.find((s) => s.name === FILE_LEVEL_NAME)).toBeUndefined();
  });

  it('파일수준: 어떤 심볼에도 안 걸리는 헝크는 (파일 상단/기타) 1개로 묶는다', () => {
    const hunks: GitChangeRange[] = [{ startLine: 1, endLine: 1, type: 'modify' }]; // 심볼 밖(상단 import 등)
    const r = mapChangesToSymbols(hunks, [], [sym('foo', 10, 14)]);
    expect(r).toEqual([{ name: FILE_LEVEL_NAME, kind: 'file', line: 1, change: 'modified' }]);
  });

  it('혼합: added + modified + 파일수준을 함께 분류', () => {
    const hunks: GitChangeRange[] = [
      { startLine: 1, endLine: 1, type: 'modify' },  // 파일 상단(심볼 밖)
      { startLine: 3, endLine: 3, type: 'modify' },  // foo 내부
      { startLine: 11, endLine: 15, type: 'add' },   // bar 신규
    ];
    const oldS = [sym('foo', 1, 5)];
    const newS = [sym('foo', 1, 5), sym('bar', 10, 14)];
    const r = mapChangesToSymbols(hunks, oldS, newS);
    expect(r).toContainEqual({ name: 'foo', kind: 'function', line: 2, change: 'modified' });
    expect(r).toContainEqual({ name: 'bar', kind: 'function', line: 11, change: 'added' });
    expect(r).toContainEqual({ name: FILE_LEVEL_NAME, kind: 'file', line: 1, change: 'modified' });
  });
});
