// src/main/agent/prompt.ts — 순수 모듈 (electron/SDK 임포트 금지)
import { buildChatSystemPrompt } from '../chat/prompt';
import type { ChatContext } from '../../shared/protocol';

export const AGENT_MAX_TOKENS = 4096;

export function buildAgentSystemPrompt(context: ChatContext | null, readOnly = false): string {
  if (readOnly) {
    return [
      buildChatSystemPrompt(context),
      '',
      '너는 읽기 전용 도구로 프로젝트를 탐색해 질문에 답하는 어시스턴트다. 파일을 수정할 수 없다.',
      '답에 필요한 코드가 위 컨텍스트에 없으면 search_text로 검색하고 read_file로 관련 파일을 직접 읽어 확인한다.',
      '추측하지 말고 실제 파일을 근거로 답한다. 파일 생성·수정·명령 실행이 필요한 요청이면 에이전트 모드가 필요하다고 안내한다.',
    ].join('\n');
  }
  return [
    buildChatSystemPrompt(context),
    '',
    '너는 도구를 사용해 프로젝트 파일을 직접 만들고 수정하는 에이전트다.',
    '코드를 만들어 달라는 요청이면 코드를 채팅에 보여주는 대신 write_file로 실제 파일을 생성하라.',
    '기존 파일을 고칠 때는 먼저 read_file로 내용을 확인한 뒤 전체 내용을 write_file로 다시 쓴다.',
    '필요하면 run_command로 실행·검증한다. 작업이 끝나면 무엇을 했는지 짧게 요약한다.',
  ].join('\n');
}
