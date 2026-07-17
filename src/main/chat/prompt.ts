// 채팅 시스템 프롬프트 — 순수 모듈 (electron/SDK 임포트 금지)
import type { ChatContext } from '../../shared/protocol';

export const CHAT_MAX_TOKENS = 2048;

export function buildChatSystemPrompt(context: ChatContext | null): string {
  const lines = [
    '너는 코드 어시스턴트다. 간결하고 정확하게 한국어로 답한다.',
    '코드를 보여줄 때는 마크다운 코드 펜스를 사용한다.',
  ];
  if (context) {
    lines.push('');
    lines.push(
      `사용자가 보고 있는 코드 (${context.path}, ${context.languageId}, ` +
        `${context.isSelection ? '선택 영역' : '커서 주변'}, ${context.startLine}행부터):`,
    );
    lines.push('```' + context.languageId + '\n' + context.code + '\n```');
    if (context.signatures.length > 0) {
      lines.push('이 파일의 심볼 시그니처:');
      for (const sig of context.signatures) lines.push(`- ${sig}`);
    }
  }
  return lines.join('\n');
}
