import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../src/renderer/src/store';

beforeEach(() => {
  useAppStore.setState({
    root: null, indexing: null, stats: null, error: null,
    tabs: [], activePath: null, outlineVersion: 0,
  });
});

describe('useAppStore', () => {
  it('openTab: 새 탭 추가 + 활성화, 중복이면 활성화만', () => {
    const s = useAppStore.getState();
    s.openTab('a.ts');
    s.openTab('b.ts');
    s.openTab('a.ts');
    const st = useAppStore.getState();
    expect(st.tabs.map((t) => t.path)).toEqual(['a.ts', 'b.ts']);
    expect(st.activePath).toBe('a.ts');
  });
  it('closeTab: 활성 탭을 닫으면 마지막 탭으로 이동, 마지막이면 null', () => {
    const s = useAppStore.getState();
    s.openTab('a.ts');
    s.openTab('b.ts');
    s.closeTab('b.ts');
    expect(useAppStore.getState().activePath).toBe('a.ts');
    s.closeTab('a.ts');
    expect(useAppStore.getState().activePath).toBeNull();
    expect(useAppStore.getState().tabs).toEqual([]);
  });
  it('setDirty(false)는 diskChanged도 해제한다 (저장하면 디스크와 일치)', () => {
    const s = useAppStore.getState();
    s.openTab('a.ts');
    s.setDirty('a.ts', true);
    s.markDiskChanged('a.ts');
    s.setDirty('a.ts', false);
    const tab = useAppStore.getState().tabs[0];
    expect(tab.dirty).toBe(false);
    expect(tab.diskChanged).toBe(false);
  });
  it('setProject는 탭/상태를 초기화한다', () => {
    const s = useAppStore.getState();
    s.openTab('a.ts');
    s.setProject('/p');
    const st = useAppStore.getState();
    expect(st.root).toBe('/p');
    expect(st.tabs).toEqual([]);
    expect(st.activePath).toBeNull();
  });
  it('setActiveThreadId / setThreads / loadThreadMessages', () => {
    const s = useAppStore.getState();
    s.setThreads([{ id: 't1', title: 'A', updatedAt: 1 }]);
    s.setActiveThreadId('t1');
    s.loadThreadMessages([{ role: 'user', content: '복원됨', ts: 5 }]);
    const st = useAppStore.getState();
    expect(st.activeThreadId).toBe('t1');
    expect(st.threads).toHaveLength(1);
    expect(st.chatMessages).toEqual([{ role: 'user', content: '복원됨', ts: 5 }]);
  });
  it('upsertChatTool: 마지막 어시스턴트 메시지에 id로 upsert', () => {
    const s = useAppStore.getState();
    s.appendChatUser('만들어');
    s.appendChatAssistant();
    s.upsertChatTool({ id: 'c1', name: 'write_file', summary: 'a.py', state: 'running' });
    s.upsertChatTool({ id: 'c1', name: 'write_file', summary: 'a.py', state: 'done', path: 'a.py' });
    const last = useAppStore.getState().chatMessages.at(-1)!;
    expect(last.tools).toHaveLength(1);
    expect(last.tools![0].state).toBe('done');
  });
});
