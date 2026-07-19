import { describe, it, expect } from 'vitest';
import { needsApproval, toolsForPreset } from '../src/main/agent/trust';
import { AGENT_TOOLS, READONLY_AGENT_TOOLS } from '../src/main/agent/tools';
import type { AgentTrustPreset } from '../src/shared/protocol';

describe('toolsForPreset', () => {
  it('explore만 읽기 전용 도구셋(쓰기·셸 미제공), 나머지는 전체 도구', () => {
    expect(toolsForPreset('explore')).toBe(READONLY_AGENT_TOOLS);
    for (const p of ['careful', 'edits', 'full'] as AgentTrustPreset[]) {
      expect(toolsForPreset(p)).toBe(AGENT_TOOLS);
    }
    // explore 도구셋엔 부작용 도구가 없다
    const names = READONLY_AGENT_TOOLS.map((t) => t.name);
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('run_command');
  });
});

describe('needsApproval 판정 매트릭스', () => {
  // 프리셋 × 도구 → 승인 필요 여부
  const cases: Array<[AgentTrustPreset, string, boolean]> = [
    ['careful', 'write_file', true],
    ['careful', 'run_command', true],
    ['careful', 'read_file', false],
    ['careful', 'list_dir', false],
    ['edits', 'write_file', false],
    ['edits', 'run_command', true],
    ['edits', 'read_file', false],
    ['full', 'write_file', false],
    ['full', 'run_command', false],
    ['explore', 'write_file', false], // 도구 자체가 미제공이지만 판정은 false
    ['explore', 'run_command', false],
  ];
  for (const [preset, tool, expected] of cases) {
    it(`${preset} × ${tool} → ${expected}`, () => {
      expect(needsApproval(preset, tool)).toBe(expected);
    });
  }

  it('읽기 도구는 어떤 프리셋에서도 승인 불필요', () => {
    for (const p of ['explore', 'careful', 'edits', 'full'] as AgentTrustPreset[]) {
      for (const t of ['read_file', 'list_dir', 'search_text', 'find_symbol']) {
        expect(needsApproval(p, t)).toBe(false);
      }
    }
  });
});
