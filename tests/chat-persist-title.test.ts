import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../src/renderer/src/store';
import { scheduleChatSave } from '../src/renderer/src/chat-persist';

function setSi(chatThreadSave: (...args: unknown[]) => unknown) {
  (globalThis as any).window = { si: { chatThreadSave } };
}

beforeEach(() => {
  useAppStore.setState({
    root: null, indexing: null, stats: null, error: null,
    tabs: [], activePath: null, outlineVersion: 0,
    threads: [], activeThreadId: null, chatMessages: [],
  });
});

describe('scheduleChatSave: 제목 선택 로직 (I-1 회귀 방지)', () => {
  it('threads에 이름변경된 제목이 있으면 그 제목으로 저장한다 (자동 제목으로 덮어쓰지 않음)', async () => {
    const save = vi.fn();
    setSi(save);
    useAppStore.setState({
      threads: [{ id: 't1', title: '수동 제목', updatedAt: 1 }],
      activeThreadId: 't1',
      chatMessages: [{ role: 'user', content: '원래 질문' }] as any,
    });

    scheduleChatSave();
    await new Promise((r) => setTimeout(r, 350));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('t1', '수동 제목', expect.anything());
  });

  it('threads가 비어 있으면(최초 저장) 첫 사용자 메시지에서 파생한 제목으로 저장한다', async () => {
    const save = vi.fn();
    setSi(save);
    useAppStore.setState({
      threads: [],
      activeThreadId: 't2',
      chatMessages: [{ role: 'user', content: '원래 질문' }] as any,
    });

    scheduleChatSave();
    await new Promise((r) => setTimeout(r, 350));

    expect(save).toHaveBeenCalledTimes(1);
    const [id, title] = save.mock.calls[0];
    expect(id).toBe('t2');
    expect(title).toBe('원래 질문');
  });
});
