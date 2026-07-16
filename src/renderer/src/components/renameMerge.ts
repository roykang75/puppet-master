import type { RenameFileGroup, RenameOccurrence } from '../../../shared/protocol';

export const keyOf = (path: string, occ: RenameOccurrence): string =>
  `${path}:${occ.line}:${occ.col}`;

// groups/unconfirmed가 같은 파일(path)을 가질 수 있음 — getRenameTargets는 line:col로만
// 중복을 제거하므로 한 파일의 발생이 두 섹션에 나뉘어 들어올 수 있다. 이를 path별로 병합하지
// 않으면 apply payload에 같은 path의 RenameFileGroup이 둘 생기고, main의 rename:apply가 한
// 파일을 두 번 read→replace→save 하여 changedFiles가 과다 계상되며, 두 번째 그룹의 같은 줄
// 발생은 col이 편집 전 오프셋이라 정확 일치 가드에서 무음 skip된다.
// 따라서 두 섹션의 체크된 발생을 path별 Map으로 병합해 path당 그룹 하나만 방출한다.
// (정렬은 결정성만 확보하면 됨 — main 엔진이 내부적으로 desc 재정렬함.)
export function mergeCheckedGroups(
  groups: RenameFileGroup[],
  unconfirmed: RenameFileGroup[],
  checked: Set<string>,
): RenameFileGroup[] {
  const byPath = new Map<string, RenameOccurrence[]>();
  for (const g of [...groups, ...unconfirmed]) {
    for (const occ of g.occurrences) {
      if (!checked.has(keyOf(g.path, occ))) continue;
      const list = byPath.get(g.path);
      if (list) list.push(occ);
      else byPath.set(g.path, [occ]);
    }
  }
  const out: RenameFileGroup[] = [];
  for (const [path, occurrences] of byPath) {
    occurrences.sort((a, b) => a.line - b.line || a.col - b.col);
    out.push({ path, occurrences });
  }
  return out;
}
