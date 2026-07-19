// LSP references → Smart Rename 대상 변환 (TS/JS/Py 정밀 경로). Monaco 비의존 → 단위 테스트 가능.
import type { LspLocationN, RenameFileGroup, RenameOccurrence, RenameTargets } from '../../shared/protocol';

/** LSP references(includeDeclaration) 위치 목록을 파일별 RenameTargets.groups로 그룹핑. 전부 기본 체크. */
export function locationsToRenameTargets(locs: LspLocationN[]): RenameTargets | null {
  if (locs.length === 0) return null;
  const byPath = new Map<string, RenameOccurrence[]>();
  for (const l of locs) {
    const arr = byPath.get(l.path) ?? [];
    // 동일 위치 중복 제거 (서버가 중복 반환하는 경우)
    if (!arr.some((o) => o.line === l.line && o.col === l.col)) {
      arr.push({ line: l.line, col: l.col, isDefinition: false });
    }
    byPath.set(l.path, arr);
  }
  const groups: RenameFileGroup[] = [...byPath.entries()].map(([path, occ]) => ({
    path,
    occurrences: occ.sort((a, b) => a.line - b.line || a.col - b.col),
  }));
  return { groups, unconfirmed: [] };
}
