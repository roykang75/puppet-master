// src/main/agent/prompt.ts — 순수 모듈 (electron/SDK 임포트 금지)
import { buildChatSystemPrompt } from '../chat/prompt';
import type { ChatContext } from '../../shared/protocol';

export const AGENT_MAX_TOKENS = 4096;

export function buildAgentSystemPrompt(context: ChatContext | null, readOnly = false): string {
  // v3: 구조 도구 우선 지침 — 심볼/호출 관계/영향/프론트↔백엔드 질문은 그래프로 답한다.
  const STRUCTURE_GUIDE =
    '코드 구조 질문(정의 위치·호출 관계·변경 영향·프론트↔백엔드 연결)은 구조 도구를 먼저 쓴다: ' +
    'find_symbol(정의 찾기), get_call_graph(호출 관계), get_impact(변경 영향), trace_http(HTTP 체인). ' +
    'search_text(텍스트 grep)는 이름을 모를 때의 최후 수단이다.';
  if (readOnly) {
    return [
      buildChatSystemPrompt(context),
      '',
      '너는 읽기 전용 도구로 프로젝트를 탐색해 질문에 답하는 어시스턴트다. 파일을 수정할 수 없다.',
      STRUCTURE_GUIDE,
      '답에 필요한 코드가 위 컨텍스트에 없으면 도구로 확인하고 read_file로 관련 파일을 직접 읽어 확인한다.',
      '추측하지 말고 실제 파일을 근거로 답한다. 파일 생성·수정·명령 실행이 필요한 요청이면 에이전트 모드가 필요하다고 안내한다.',
    ].join('\n');
  }
  return [
    buildChatSystemPrompt(context),
    '',
    '너는 도구를 사용해 프로젝트 파일을 직접 만들고 수정하는 에이전트다.',
    STRUCTURE_GUIDE,
    '기존 코드를 수정하기 전에는 get_impact로 영향 범위를 확인하고, 영향이 크면 답변에 명시한다.',
    '코드를 만들어 달라는 요청이면 코드를 채팅에 보여주는 대신 write_file로 실제 파일을 생성하라.',
    '기존 파일을 고칠 때는 먼저 read_file로 내용을 확인한 뒤 전체 내용을 write_file로 다시 쓴다.',
    '필요하면 run_command로 실행·검증한다. 작업이 끝나면 무엇을 했는지 짧게 요약한다.',
  ].join('\n');
}
