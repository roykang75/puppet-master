// src/main/agent/trust.ts — 신뢰 프리셋 판정 (순수 모듈, electron 임포트 금지).
// 승인 정책의 단일 진실: 어떤 도구셋을 노출하고, 어떤 도구가 승인을 요구하는지.
import { AGENT_TOOLS, READONLY_AGENT_TOOLS, type ToolSpec } from './tools';
import type { AgentTrustPreset } from '../../shared/protocol';

/** 승인이 필요한 부작용 도구 — careful/edits의 판정 기준. */
const WRITE_TOOLS = new Set(['write_file', 'run_command']);

/** 프리셋별 노출 도구셋. explore만 읽기 전용(쓰기·셸 미제공), 나머지는 전체 도구. */
export function toolsForPreset(preset: AgentTrustPreset): ToolSpec[] {
  return preset === 'explore' ? READONLY_AGENT_TOOLS : AGENT_TOOLS;
}

/** 이 도구가 실행 전 사용자 승인을 요구하는가.
 *  careful → 쓰기·셸 모두 · edits → 셸만 · full/explore → 없음.
 *  (읽기 도구는 항상 false — 기존 불변식 유지) */
export function needsApproval(preset: AgentTrustPreset, toolName: string): boolean {
  if (preset === 'careful') return WRITE_TOOLS.has(toolName);
  if (preset === 'edits') return toolName === 'run_command';
  return false; // full, explore
}
