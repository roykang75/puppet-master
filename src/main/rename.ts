// 순수 치환 엔진 — 좌표(0-기반)와 원본 이름을 검증하며 텍스트를 치환한다.
// UI/main/DB에 의존하지 않아 단위 테스트가 쉽다.

export interface RenameResult {
  content: string;
  replaced: number;
  skipped: Array<{ line: number; col: number }>;
}

/**
 * 주어진 발생 위치들에서 oldName → newName 치환.
 * 줄 desc → col desc 순으로 처리해 앞선 편집이 뒤 위치의 오프셋을 흐트러뜨리지 않게 한다.
 * 각 위치에서 실제 텍스트가 oldName과 일치하지 않거나 줄 범위를 벗어나면 skip 기록.
 */
export function applyRenameToContent(
  content: string,
  occurrences: Array<{ line: number; col: number }>,
  oldName: string,
  newName: string,
): RenameResult {
  const lines = content.split('\n');
  const skipped: Array<{ line: number; col: number }> = [];
  let replaced = 0;

  const sorted = [...occurrences].sort((a, b) => (b.line - a.line) || (b.col - a.col));
  for (const occ of sorted) {
    if (occ.line < 0 || occ.line >= lines.length) {
      skipped.push({ line: occ.line, col: occ.col });
      continue;
    }
    const lineText = lines[occ.line];
    if (lineText.slice(occ.col, occ.col + oldName.length) !== oldName) {
      skipped.push({ line: occ.line, col: occ.col });
      continue;
    }
    lines[occ.line] = lineText.slice(0, occ.col) + newName + lineText.slice(occ.col + oldName.length);
    replaced++;
  }

  return { content: lines.join('\n'), replaced, skipped };
}
