import { describe, it, expect, beforeEach } from 'vitest';
import { AgentService, MAX_TOOL_CALLS } from '../src/main/agent/service';
import type { AgentAdapter, AgentMsg, AgentTurnResult } from '../src/main/agent/adapters';
import type { AgentEvent } from '../src/shared/protocol';

// 각 호출마다 미리 정의된 턴을 돌려주는 fake 어댑터
function fakeAdapter(turns: AgentTurnResult[]): { adapter: AgentAdapter; seen: AgentMsg[][] } {
  const seen: AgentMsg[][] = [];
  let i = 0;
  return {
    seen,
    adapter: {
      async runTurn(messages, _s, _t, onChunk, signal) {
        if (signal.aborted) throw new Error('aborted');
        seen.push(JSON.parse(JSON.stringify(messages)));
        const turn = turns[Math.min(i++, turns.length - 1)];
        if (turn.text) onChunk(turn.text);
        return turn;
      },
    },
  };
}

const baseDeps = (adapter: AgentAdapter, toolResult = 'OK') => ({
  getSettings: () => ({ provider: 'openai' as const, model: 'm' }),
  getApiKey: () => 'k',
  getToolDeps: () => ({
    projectRoot: '/tmp/x',
    allowedDirs: [],
    searchText: async () => [],
  }),
  adapterFactory: () => adapter,
  // 테스트에서는 실제 파일 도구 대신 실행기를 대체한다
  executeToolOverride: async () => toolResult,
});

function collect(): { events: AgentEvent[]; on: (e: AgentEvent) => void } {
  const events: AgentEvent[] = [];
  return { events, on: (e) => events.push(e) };
}

describe('AgentService 루프', () => {
  it('tool call → 실행 → tool result 추가 → 재호출 → 텍스트로 종료', async () => {
    const { adapter, seen } = fakeAdapter([
      { text: '만들게요', toolCalls: [{ id: 'c1', name: 'write_file', args: { path: 'a.py', content: 'x' } }] },
      { text: '완료', toolCalls: [] },
    ]);
    const svc = new AgentService(baseDeps(adapter, '작성 완료: a.py'));
    const { events, on } = collect();
    await svc.send([{ role: 'user', content: '만들어' }], null, true, on);
    // 2턴째 입력에 assistant(toolCalls)와 tool result가 들어있다
    const second = seen[1];
    expect(second.some((m) => m.role === 'assistant' && m.toolCalls?.length === 1)).toBe(true);
    expect(second.some((m) => m.role === 'tool' && m.content === '작성 완료: a.py')).toBe(true);
    // 이벤트 순서: chunk → tool(running) → tool(done, path 포함) → chunk → done
    const kinds = events.map((e) => (e.type === 'tool' ? `tool:${e.state}` : e.type));
    expect(kinds).toEqual(['chunk', 'tool:running', 'tool:done', 'chunk', 'done']);
    const doneTool = events.find((e) => e.type === 'tool' && e.state === 'done') as any;
    expect(doneTool.path).toBe('a.py');
    expect(doneTool.summary).toBe('a.py');
    // write_file done 카드에는 diff detail이 실린다 (fake root라 '새 파일' 미리보기)
    expect(doneTool.detail).toContain('새 파일');
  });

  it('자동승인 꺼짐: write_file awaiting 이벤트에 diff detail 포함 (승인 전 미리보기)', async () => {
    const { adapter } = fakeAdapter([
      { text: '', toolCalls: [{ id: 'c1', name: 'write_file', args: { path: 'a.py', content: 'print(1)' } }] },
      { text: '끝', toolCalls: [] },
    ]);
    const svc = new AgentService(baseDeps(adapter));
    const { events, on } = collect();
    const p = svc.send([{ role: 'user', content: 'x' }], null, false, on);
    await new Promise((r) => setTimeout(r, 20));
    const awaiting = events.find((e) => e.type === 'tool' && e.state === 'awaiting') as any;
    expect(awaiting.detail).toContain('+ print(1)');
    // 에디터 diff 뷰용 원문 — 새 파일이라 before '', after는 제안 내용
    expect(awaiting.before).toBe('');
    expect(awaiting.after).toBe('print(1)');
    svc.approve('c1', true);
    await p;
  });

  it('도구 한도 초과 시 한도 안내 후 종료', async () => {
    const { adapter } = fakeAdapter([
      { text: '', toolCalls: [{ id: 'c', name: 'list_dir', args: {} }] }, // 매 턴 1회 → 25턴
    ]);
    const svc = new AgentService(baseDeps(adapter));
    const { events, on } = collect();
    await svc.send([{ role: 'user', content: 'x' }], null, true, on);
    const toolEvents = events.filter((e) => e.type === 'tool' && e.state === 'done');
    expect(toolEvents.length).toBe(MAX_TOOL_CALLS);
    expect(events.some((e) => e.type === 'chunk' && e.text.includes('한도'))).toBe(true);
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });

  it('자동승인 꺼짐: write_file은 awaiting 후 approve(true)로 진행', async () => {
    const { adapter } = fakeAdapter([
      { text: '', toolCalls: [{ id: 'c1', name: 'write_file', args: { path: 'a.py', content: 'x' } }] },
      { text: '끝', toolCalls: [] },
    ]);
    const svc = new AgentService(baseDeps(adapter));
    const { events, on } = collect();
    const p = svc.send([{ role: 'user', content: 'x' }], null, false, on);
    await new Promise((r) => setTimeout(r, 20)); // awaiting 도달 대기
    expect(events.some((e) => e.type === 'tool' && e.state === 'awaiting')).toBe(true);
    svc.approve('c1', true);
    await p;
    expect(events.some((e) => e.type === 'tool' && e.state === 'done')).toBe(true);
  });

  it('거부하면 "사용자가 거부함"이 tool result로 전달된다', async () => {
    const { adapter, seen } = fakeAdapter([
      { text: '', toolCalls: [{ id: 'c1', name: 'run_command', args: { command: 'rm -rf /' } }] },
      { text: '알겠습니다', toolCalls: [] },
    ]);
    const svc = new AgentService(baseDeps(adapter));
    const { events, on } = collect();
    const p = svc.send([{ role: 'user', content: 'x' }], null, false, on);
    await new Promise((r) => setTimeout(r, 20));
    svc.approve('c1', false);
    await p;
    expect(seen[1].some((m) => m.role === 'tool' && m.content.includes('거부'))).toBe(true);
    expect(events.some((e) => e.type === 'tool' && e.state === 'error')).toBe(true);
  });

  it('읽기 도구(list_dir 등)는 자동승인 꺼져도 대기 없이 실행', async () => {
    const { adapter } = fakeAdapter([
      { text: '', toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'a' } }] },
      { text: '끝', toolCalls: [] },
    ]);
    const svc = new AgentService(baseDeps(adapter));
    const { events, on } = collect();
    await svc.send([{ role: 'user', content: 'x' }], null, false, on);
    expect(events.some((e) => e.type === 'tool' && e.state === 'awaiting')).toBe(false);
  });

  it('동시 1개 가드 + provider none 오류', async () => {
    const { adapter } = fakeAdapter([{ text: 'x', toolCalls: [] }]);
    const svc = new AgentService({ ...baseDeps(adapter), getSettings: () => ({ provider: 'none' as const, model: '' }) });
    const { events, on } = collect();
    await svc.send([], null, true, on);
    expect(events[0]).toEqual({ type: 'error', kind: 'other' });
  });

  it('취소: awaiting 대기 중 cancel → 조용히 done', async () => {
    const { adapter } = fakeAdapter([
      { text: '', toolCalls: [{ id: 'c1', name: 'write_file', args: { path: 'a', content: 'b' } }] },
    ]);
    const svc = new AgentService(baseDeps(adapter));
    const { events, on } = collect();
    const p = svc.send([{ role: 'user', content: 'x' }], null, false, on);
    await new Promise((r) => setTimeout(r, 20));
    svc.cancel();
    await p;
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });
});
