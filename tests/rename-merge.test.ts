import { describe, it, expect } from 'vitest';
import { keyOf, mergeCheckedGroups } from '../src/renderer/src/components/renameMerge';
import type { RenameFileGroup, RenameOccurrence } from '../src/shared/protocol';

const occ = (line: number, col: number, isDefinition = false): RenameOccurrence => ({
  line,
  col,
  isDefinition,
});

describe('mergeCheckedGroups', () => {
  it('같은 path가 groups/unconfirmed에 나뉘어 있어도 하나의 그룹으로 병합', () => {
    const groups: RenameFileGroup[] = [{ path: 'a.ts', occurrences: [occ(1, 4)] }];
    const unconfirmed: RenameFileGroup[] = [{ path: 'a.ts', occurrences: [occ(5, 2)] }];
    const checked = new Set([keyOf('a.ts', occ(1, 4)), keyOf('a.ts', occ(5, 2))]);

    const out = mergeCheckedGroups(groups, unconfirmed, checked);

    expect(out).toHaveLength(1);
    expect(out[0].path).toBe('a.ts');
    expect(out[0].occurrences.map((o) => [o.line, o.col])).toEqual([
      [1, 4],
      [5, 2],
    ]);
  });

  it('발생을 line asc, col asc 로 결정적 정렬', () => {
    const groups: RenameFileGroup[] = [
      { path: 'a.ts', occurrences: [occ(5, 2)] },
      { path: 'a.ts', occurrences: [occ(1, 9), occ(1, 3)] },
    ];
    const checked = new Set([
      keyOf('a.ts', occ(5, 2)),
      keyOf('a.ts', occ(1, 9)),
      keyOf('a.ts', occ(1, 3)),
    ]);

    const out = mergeCheckedGroups(groups, [], checked);

    expect(out).toHaveLength(1);
    expect(out[0].occurrences.map((o) => [o.line, o.col])).toEqual([
      [1, 3],
      [1, 9],
      [5, 2],
    ]);
  });

  it('체크되지 않은 발생은 제외, 남는 것 없으면 그룹 자체를 방출하지 않음', () => {
    const groups: RenameFileGroup[] = [
      { path: 'a.ts', occurrences: [occ(1, 4), occ(2, 4)] },
      { path: 'b.ts', occurrences: [occ(3, 1)] },
    ];
    const checked = new Set([keyOf('a.ts', occ(1, 4))]); // b.ts와 a.ts:2 미체크

    const out = mergeCheckedGroups(groups, [], checked);

    expect(out).toHaveLength(1);
    expect(out[0].path).toBe('a.ts');
    expect(out[0].occurrences.map((o) => [o.line, o.col])).toEqual([[1, 4]]);
  });
});
