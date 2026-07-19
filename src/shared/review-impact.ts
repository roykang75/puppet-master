// src/shared/review-impact.ts — 리뷰 센터 영향도 정렬 순수 로직 (Plan 22-D). electron/인덱서 런타임 무의존.
import type { ImpactSummary } from '../indexer/api';

/** 심볼 영향도 점수 = 콜러 + 엔드포인트 + API호출. summary 없으면 0. */
export function impactScore(s: ImpactSummary | undefined): number {
  return s ? s.callers + s.endpoints + s.apiCalls : 0;
}

/** 심볼 배열을 영향도 내림차순으로 안정 정렬(동률=기존 순서). impacts: name→summary. */
export function sortSymbolsByImpact<T extends { name: string }>(
  symbols: T[],
  impacts: Map<string, ImpactSummary>,
): T[] {
  return symbols
    .map((s, i) => ({ s, i, score: impactScore(impacts.get(s.name)) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.s);
}

/** 파일의 최대 심볼 영향도. 심볼 없으면 0. */
export function fileMaxImpact<T extends { name: string }>(
  symbols: T[],
  impacts: Map<string, ImpactSummary>,
): number {
  let max = 0;
  for (const s of symbols) max = Math.max(max, impactScore(impacts.get(s.name)));
  return max;
}

/** 파일 배열을 (최대 영향도 내림차순, 동률=경로순) 정렬. */
export function sortFilesByImpact<T extends { path: string; symbols: { name: string }[] }>(
  files: T[],
  impacts: Map<string, ImpactSummary>,
): T[] {
  return files
    .map((f) => ({ f, max: fileMaxImpact(f.symbols, impacts) }))
    .sort((a, b) => b.max - a.max || a.f.path.localeCompare(b.f.path))
    .map((x) => x.f);
}
