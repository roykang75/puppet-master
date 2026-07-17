// 순수 모듈 — electron/SDK 임포트 금지. 프롬프트 구성과 후처리만 담당한다.
import type { CompletionContext } from '../../shared/protocol';

export interface BuiltContext extends CompletionContext {
  symbolSignatures: string[];
}

// '```'를 stop에 넣지 않는다 — 채팅 모델이 응답을 펜스로 시작하면 0토큰에서 잘려 빈 완성이 된다.
// 펜스 제거/절단은 postProcess가 담당한다.
export const STOP_SEQUENCES = ['\n\n\n'];
export const MAX_COMPLETION_TOKENS = 160;

const PREFIX_MAX_LINES = 50;
const SUFFIX_MAX_LINES = 10;

export function buildSystemPrompt(ctx: BuiltContext): string {
  const lines = [
    '너는 코드 자동완성 엔진이다. 커서 위치(<CURSOR>)에 이어질 코드만 출력한다.',
    '설명, 주석 형태의 안내, 마크다운(markdown) 코드 펜스는 절대 출력하지 않는다.',
    '보통 1~5줄 분량으로, 앞 코드와 자연스럽게 이어지는 최소한의 코드만 낸다.',
    `언어: ${ctx.languageId}`,
    `파일: ${ctx.path}`,
  ];
  if (ctx.symbolSignatures.length > 0) {
    lines.push('참고 가능한 심볼 시그니처:');
    for (const sig of ctx.symbolSignatures) lines.push(`- ${sig}`);
  }
  return lines.join('\n');
}

export function buildUserPrompt(ctx: BuiltContext): string {
  const prefixTail = ctx.prefix.split('\n').slice(-PREFIX_MAX_LINES).join('\n');
  const suffixHead = ctx.suffix.split('\n').slice(0, SUFFIX_MAX_LINES).join('\n');
  return `${prefixTail}<CURSOR>${suffixHead}`;
}

export function postProcess(raw: string, prefixTail: string): string | null {
  // 1) 마크다운 펜스 제거 — 여는 ```lang 줄 제거 후, 닫는 펜스가 나오면 그 지점에서 절단
  //    (닫는 펜스 뒤에 모델이 붙이는 설명 텍스트까지 함께 버린다)
  let s = raw.replace(/^\s*```[^\n]*\n/, '');
  const fence = s.indexOf('```');
  if (fence >= 0) s = s.slice(0, fence).replace(/\n$/, '');

  // 2) raw 선두가 prefixTail의 접미와 정확히 겹치면 가장 긴 겹침만 제거 (일치할 때만)
  const maxK = Math.min(prefixTail.length, s.length);
  for (let k = maxK; k > 0; k--) {
    if (prefixTail.endsWith(s.slice(0, k))) {
      s = s.slice(k);
      break;
    }
  }

  // 3) 공백뿐이면 null
  if (s.trim().length === 0) return null;
  return s;
}
