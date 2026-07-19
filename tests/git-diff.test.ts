import { describe, it, expect } from 'vitest';
import { parseGitDiff } from '../src/main/git-diff';

describe('parseGitDiff', () => {
  it('추가/수정/삭제 헌크 분류 (1-based 범위)', () => {
    const diff = [
      'diff --git a/x.ts b/x.ts',
      'index abc..def 100644',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -0,0 +5,3 @@',      // 순수 추가 5~7
      '@@ -10,2 +10,2 @@',    // 수정 10~11
      '@@ -8,2 +7,0 @@',      // 순수 삭제 → anchor 7
    ].join('\n');
    expect(parseGitDiff(diff)).toEqual([
      { startLine: 5, endLine: 7, type: 'add' },
      { startLine: 10, endLine: 11, type: 'modify' },
      { startLine: 7, endLine: 7, type: 'delete' },
    ]);
  });

  it('카운트 생략(기본 1) 처리 — @@ -3 +3 @@ = 수정 3행', () => {
    expect(parseGitDiff('@@ -3 +3 @@')).toEqual([{ startLine: 3, endLine: 3, type: 'modify' }]);
    expect(parseGitDiff('@@ -0,0 +5 @@')).toEqual([{ startLine: 5, endLine: 5, type: 'add' }]);
  });

  it('상단 삭제(newStart 0) → 1행 앵커', () => {
    expect(parseGitDiff('@@ -1,2 +0,0 @@')).toEqual([{ startLine: 1, endLine: 1, type: 'delete' }]);
  });

  it('헌크 없음/빈 문자열 → []', () => {
    expect(parseGitDiff('')).toEqual([]);
    expect(parseGitDiff('diff --git a/x b/x\nno hunks here')).toEqual([]);
  });
});
