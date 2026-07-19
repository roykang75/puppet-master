export interface PreviewSlice {
  startLine: number; // 1-기반: lines[0]의 실제 줄번호
  lines: string[];
}

/**
 * 전체 내용에서 targetLine(1-기반) 주변 ±radius 줄을 슬라이스한다.
 * 창 크기(2*radius+1)는 경계에서도 유지한다 — 파일 시작/끝 근처면 반대쪽으로 확장해
 * 항상 같은 줄 수를 채운다(총줄수가 창보다 작으면 전체 반환).
 * targetLine이 범위를 벗어나면 [1, 총줄수]로 보정.
 */
export function buildPreviewSlice(content: string, targetLine: number, radius = 30): PreviewSlice {
  const all = content.split('\n');
  const total = all.length;
  const win = 2 * radius + 1;
  if (total <= win) return { startLine: 1, lines: all };
  const target = Math.min(Math.max(targetLine, 1), total);
  // target-radius를 기본 시작으로 하되, 끝 근처면 시작쪽으로 당겨 창을 유지
  const start = Math.max(1, Math.min(target - radius, total - win + 1));
  return { startLine: start, lines: all.slice(start - 1, start - 1 + win) };
}
