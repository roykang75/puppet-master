// 스택 요약 문자열 — 순수 모듈(shared, renderer/main 공용).
import type { ProjectStack } from './protocol';

export function buildStackSummary(stack: ProjectStack): string {
  const parts: string[] = [];
  if (stack.languages.length) parts.push(`언어: ${stack.languages.join(', ')}`);
  if (stack.libraries.length) {
    const libs = stack.libraries.map((l) => (l.version ? `${l.name}@${l.version}` : l.name)).join(', ');
    parts.push(`라이브러리: ${libs}`);
  }
  return parts.join(' · ');
}
