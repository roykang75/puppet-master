// 오류 분류 — electron 임포트 금지. SDK 예외의 status/타입만으로 판정(문자열 매칭 금지).
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// 추론(reasoning) 모델이 토큰 예산을 생각 과정에 소모해 content를 비워 보낸 경우 —
// 재시도해도 같은 결과이므로 설정 변경까지 비활성 대상.
export class UnsuitableModelError extends Error {
  constructor() {
    super('unsuitable model');
  }
}

export function classifyError(e: unknown): 'auth' | 'transient' | 'other' | 'unsuitable' {
  if (e instanceof UnsuitableModelError) return 'unsuitable';
  // connection 계열은 status가 없으므로 먼저 판정
  if (e instanceof Anthropic.APIConnectionError || e instanceof OpenAI.APIConnectionError) {
    return 'transient';
  }
  const status = (e as { status?: number } | null)?.status;
  if (status === 401 || status === 403) return 'auth';
  if (status === 429 || (typeof status === 'number' && status >= 500)) return 'transient';
  return 'other';
}
