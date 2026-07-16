// 오류 분류 — electron 임포트 금지. SDK 예외의 status/타입만으로 판정(문자열 매칭 금지).
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export function classifyError(e: unknown): 'auth' | 'transient' | 'other' {
  // connection 계열은 status가 없으므로 먼저 판정
  if (e instanceof Anthropic.APIConnectionError || e instanceof OpenAI.APIConnectionError) {
    return 'transient';
  }
  const status = (e as { status?: number } | null)?.status;
  if (status === 401 || status === 403) return 'auth';
  if (status === 429 || (typeof status === 'number' && status >= 500)) return 'transient';
  return 'other';
}
