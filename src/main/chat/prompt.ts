// 채팅 시스템 프롬프트 — 순수 모듈 (electron/SDK 임포트 금지)
import type { ChatContext } from '../../shared/protocol';

export const CHAT_MAX_TOKENS = 2048;

export function buildChatSystemPrompt(context: ChatContext | null): string {
  const lines = [
    '너는 코드 어시스턴트다. 간결하고 정확하게 한국어로 답한다.',
    '코드를 보여줄 때는 마크다운 코드 펜스를 사용한다.',
  ];
  if (context?.code) {
    lines.push('');
    lines.push(
      `사용자가 보고 있는 코드 (${context.path}, ${context.languageId}, ` +
        `${context.isSelection ? '선택 영역' : '커서 주변'}, ${context.startLine}행부터):`,
    );
    lines.push('```' + context.languageId + '\n' + context.code + '\n```');
    if (context.signatures && context.signatures.length > 0) {
      lines.push('이 파일의 심볼 시그니처:');
      for (const sig of context.signatures) lines.push(`- ${sig}`);
    }
  }
  if (context?.structure && context.structure.length > 0) {
    lines.push('');
    lines.push('커서 심볼의 호출 구조 (심볼 인덱스 기반):');
    for (const s of context.structure) lines.push(`- ${s}`);
  }
  if (context?.stack) {
    lines.push('');
    lines.push(`이 프로젝트의 스택(참고): ${context.stack}`);
  }
  if (context?.retrieved && context.retrieved.length > 0) {
    lines.push('');
    lines.push('질문과 관련해 자동 검색으로 찾은 코드 (정확하지 않을 수 있으니 참고만 한다):');
    for (const r of context.retrieved) {
      const loc = r.line ? `${r.path}:${r.line}` : r.path;
      lines.push(r.signature ? `- ${loc} — ${r.signature}` : `- ${loc}: ${r.snippet}`);
    }
  }
  return lines.join('\n');
}
