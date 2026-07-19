import { describe, it, expect } from 'vitest';
import { locationsToRenameTargets } from '../src/renderer/src/lsp-rename';
import type { LspLocationN } from '../src/shared/protocol';

describe('locationsToRenameTargets', () => {
  it('파일별 그룹핑 + 전부 groups(체크), unconfirmed 없음', () => {
    const locs: LspLocationN[] = [
      { path: 'a.ts', line: 10, col: 4 },
      { path: 'a.ts', line: 2, col: 0 },
      { path: 'b.ts', line: 5, col: 8 },
    ];
    const t = locationsToRenameTargets(locs)!;
    expect(t.unconfirmed).toEqual([]);
    expect(t.groups).toHaveLength(2);
    const a = t.groups.find((g) => g.path === 'a.ts')!;
    // line 오름차순 정렬
    expect(a.occurrences.map((o) => o.line)).toEqual([2, 10]);
    expect(a.occurrences.every((o) => o.isDefinition === false)).toBe(true);
    expect(t.groups.find((g) => g.path === 'b.ts')!.occurrences).toEqual([{ line: 5, col: 8, isDefinition: false }]);
  });

  it('동일 위치 중복 제거', () => {
    const locs: LspLocationN[] = [
      { path: 'a.ts', line: 1, col: 1 },
      { path: 'a.ts', line: 1, col: 1 },
    ];
    expect(locationsToRenameTargets(locs)!.groups[0].occurrences).toHaveLength(1);
  });

  it('빈 배열 → null (폴백 유도)', () => {
    expect(locationsToRenameTargets([])).toBeNull();
  });
});
