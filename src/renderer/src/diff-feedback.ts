// 에이전트 변경 제안 diff에 단 줄 주석들을 채팅 입력용 피드백 텍스트로 합성 (Orca "Annotate AI Diffs" 차용)

export interface DiffAnnotation {
  line: number; // 1-기반(after 기준)
  lineText: string; // 해당 줄 원문 (표시·프롬프트 참고용)
  comment: string; // 사용자 코멘트
}

/** 주석 목록을 "파일 변경 제안 피드백" 텍스트로 합성. line 오름차순, lineText는 트림 후 80자 절단.
 *  빈 배열이면 빈 문자열(호출부에서 전송 버튼을 가드하므로 실사용 경로에는 도달하지 않음). */
export function composeDiffFeedback(path: string, annotations: DiffAnnotation[]): string {
  if (annotations.length === 0) return '';
  const lines = [...annotations]
    .sort((a, b) => a.line - b.line)
    .map((a) => `- ${a.line}행 \`${a.lineText.trim().slice(0, 80)}\`: ${a.comment.trim()}`);
  return `\`${path}\` 변경 제안 피드백:\n${lines.join('\n')}\n위 코멘트를 반영해서 수정해줘.`;
}
