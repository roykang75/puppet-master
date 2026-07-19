// src/shared/review-map.ts — 변경 헝크를 심볼 단위로 매핑 (Plan 22). electron/인덱서 무의존 순수 로직.
//   GitChangeRange(1-based) + old/new 심볼(0-based tree-sitter 좌표)을 받아 변경 심볼 목록을 만든다.
import type { GitChangeRange } from './protocol';
import type { SymbolRow } from '../indexer/extractor';

export interface SymbolChange {
  name: string;
  kind: string;
  line: number; // 1-based. added/modified=새 파일 기준, deleted=옛 파일 기준. 파일수준=1
  change: 'added' | 'modified' | 'deleted';
}

export const FILE_LEVEL_NAME = '(파일 상단/기타)';

/** 심볼(0-based startLine..endLine)이 헝크(1-based)와 줄 범위로 겹치는가. */
function overlaps(sym: SymbolRow, h: GitChangeRange): boolean {
  const s = sym.startLine + 1;
  const e = sym.endLine + 1;
  return !(e < h.startLine || s > h.endLine);
}

/**
 * add/modify 헝크와 겹치는 새쪽 심볼 → 옛 심볼에 이름 없으면 'added', 있으면 'modified'.
 * delete 헝크: (a) 앵커가 살아남은 새쪽 심볼에 걸치면 그 심볼 'modified',
 *              (b) 옛 심볼 중 새쪽에 이름이 없으면 'deleted'(통째 삭제).
 * 어떤 심볼에도 안 걸린 헝크는 파일수준 항목 1개로 묶는다.
 */
export function mapChangesToSymbols(
  hunks: GitChangeRange[],
  oldSymbols: SymbolRow[],
  newSymbols: SymbolRow[],
): SymbolChange[] {
  const oldNames = new Set(oldSymbols.map((s) => s.name));
  const newNames = new Set(newSymbols.map((s) => s.name));
  const result = new Map<string, SymbolChange>(); // 이름당 1개 (선착 우선)
  const consumed = new Array<boolean>(hunks.length).fill(false);

  const put = (name: string, kind: string, line: number, change: SymbolChange['change']) => {
    if (!result.has(name)) result.set(name, { name, kind, line, change });
  };

  // 1) add/modify 헝크 → 겹치는 새쪽 심볼
  hunks.forEach((h, i) => {
    if (h.type === 'delete') return;
    const hits = newSymbols.filter((s) => overlaps(s, h));
    if (hits.length) consumed[i] = true;
    for (const s of hits) put(s.name, s.kind, s.startLine + 1, oldNames.has(s.name) ? 'modified' : 'added');
  });

  // 2a) 통째 삭제 — 옛 심볼 중 새쪽에 이름이 없는 것 (먼저 판정)
  let anyDeleted = false;
  for (const s of oldSymbols) {
    if (!newNames.has(s.name)) {
      put(s.name, s.kind, s.startLine + 1, 'deleted');
      anyDeleted = true;
    }
  }
  // 2b) 통째 삭제가 없을 때만, delete 헝크를 살아남은 새쪽 심볼의 내부 삭제(=수정)로 귀속.
  //     (통째 삭제가 있으면 delete 헝크 앵커가 직전 심볼 끝줄에 걸려 오탐하므로 건너뛴다 — 단순화)
  if (anyDeleted) {
    hunks.forEach((h, i) => { if (h.type === 'delete') consumed[i] = true; });
  } else {
    hunks.forEach((h, i) => {
      if (h.type !== 'delete') return;
      const hits = newSymbols.filter((s) => overlaps(s, h));
      if (hits.length) {
        consumed[i] = true;
        for (const s of hits) put(s.name, s.kind, s.startLine + 1, oldNames.has(s.name) ? 'modified' : 'added');
      }
    });
  }

  const out = [...result.values()];

  // 3) 어떤 심볼에도 안 걸린 헝크가 있으면 파일수준 항목 1개
  if (consumed.some((c) => !c)) {
    out.push({ name: FILE_LEVEL_NAME, kind: 'file', line: 1, change: 'modified' });
  }
  return out;
}
