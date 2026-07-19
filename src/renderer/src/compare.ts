// 파일 비교 — 두 파일 내용을 diff 탭 파라미터로. Monaco 비의존(순수) → 단위 테스트 가능.

export interface CompareDiff {
  path: string; // diff 탭 고유 키 겸 DiffView 모델 URI 경로 (마지막 세그먼트 확장자로 하이라이트 추정)
  label: string; // 탭 제목
  before: string; // base 파일
  after: string; // 비교 대상 파일
}

const base = (rel: string): string => rel.split('/').pop() || rel;

/** base 파일 ↔ other 파일 비교용 diff 탭 파라미터 구성. */
export function buildCompareDiff(baseRel: string, baseContent: string, otherRel: string, otherContent: string): CompareDiff {
  return {
    path: `${baseRel} ↔ ${otherRel}`,
    label: `비교: ${base(baseRel)} ↔ ${base(otherRel)}`,
    before: baseContent,
    after: otherContent,
  };
}
