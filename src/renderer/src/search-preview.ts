export interface PreviewSlice {
  startLine: number; // 1-기반: lines[0]의 실제 줄번호
  lines: string[];
}

/**
 * 전체 내용에서 targetLine(1-기반) 주변 ±radius 줄을 슬라이스한다.
 * 파일 시작/끝 경계는 클램프한다. targetLine이 범위를 벗어나면 [1, 총줄수]로 보정.
 */
export function buildPreviewSlice(content: string, targetLine: number, radius = 7): PreviewSlice {
  const all = content.split('\n');
  const total = all.length;
  const target = Math.min(Math.max(targetLine, 1), total);
  const start = Math.max(1, target - radius);
  const end = Math.min(total, target + radius);
  return { startLine: start, lines: all.slice(start - 1, end) };
}
