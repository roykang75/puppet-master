// src/main/agent/prompt.ts — 순수 모듈 (electron/SDK 임포트 금지)
import { buildChatSystemPrompt } from '../chat/prompt';
import type { ChatContext } from '../../shared/protocol';

export const AGENT_MAX_TOKENS = 4096;

export function buildAgentSystemPrompt(context: ChatContext | null): string {
  return [
    buildChatSystemPrompt(context),
    '',
    '너는 도구를 사용해 프로젝트 파일을 직접 만들고 수정하는 에이전트다.',
    '코드를 만들어 달라는 요청이면 코드를 채팅에 보여주는 대신 write_file로 실제 파일을 생성하라.',
    '기존 파일을 고칠 때는 먼저 read_file로 내용을 확인한 뒤 전체 내용을 write_file로 다시 쓴다.',
    '필요하면 run_command로 실행·검증한다. 작업이 끝나면 무엇을 했는지 짧게 요약한다.',
  ].join('\n');
}
