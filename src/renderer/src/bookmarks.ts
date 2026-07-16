import type { SymbolHit } from '../../indexer/api';

export interface Bookmark {
  path: string;
  line: number;        // 1-기반 (폴백용 절대 줄)
  anchorName: string | null;
  anchorLine: number;  // 1-기반 (표시용)
  offset: number;      // 앵커 시작으로부터의 줄 오프셋
  text: string;        // 미리보기 한 줄
}

/** line1(1-기반) 이전에서 시작하는 가장 가까운 심볼을 앵커로 */
export function computeAnchor(
  symbols: SymbolHit[],
  line1: number,
): { anchorName: string | null; anchorLine: number; offset: number } {
  let best: SymbolHit | null = null;
  for (const s of symbols) {
    const sLine1 = s.line + 1;
    if (sLine1 <= line1 && (!best || sLine1 > best.line + 1)) best = s;
  }
  if (!best) return { anchorName: null, anchorLine: 0, offset: line1 };
  return { anchorName: best.name, anchorLine: best.line + 1, offset: line1 - (best.line + 1) };
}

/** 저장된 앵커를 현재 아웃라인에 재해석 — 유실 시 절대 줄 폴백 */
export function resolveBookmarkLine(symbols: SymbolHit[], bm: Bookmark): number {
  if (!bm.anchorName) return bm.line;
  const found = symbols.find((s) => s.name === bm.anchorName);
  return found ? found.line + 1 + bm.offset : bm.line;
}
