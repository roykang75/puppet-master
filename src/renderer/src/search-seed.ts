/** 에디터 선택 → 검색 시드. 여러 줄이면 첫 줄만, 트림, 200자 캡. 무의미(빈/공백)하면 null. */
export function normalizeSearchSeed(sel: string | null): string | null {
  if (sel == null) return null;
  const firstLine = sel.split('\n', 1)[0].trim();
  if (!firstLine) return null;
  return firstLine.slice(0, 200);
}
