import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ChatStore, type StoredMessage } from '../src/main/chat-store';

let dir: string;
let store: ChatStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-chat-'));
  store = new ChatStore(path.join(dir, 'chat.db'));
});
afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const msgs = (): StoredMessage[] => [
  { role: 'user', content: '구구단 만들어', ts: 1 },
  { role: 'assistant', content: '만들게요', ts: 2, tools: [{ id: 'c1', name: 'write_file', summary: 'a.py', state: 'done', path: 'a.py', before: 'x', after: 'y' }] },
];

describe('ChatStore', () => {
  it('create→save→load 라운드트립 (tools JSON 포함, seq 순서)', () => {
    const id = store.createThread('구구단 만들어');
    store.saveThread(id, '구구단 만들어', msgs());
    const loaded = store.loadThread(id);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toEqual({ role: 'user', content: '구구단 만들어', ts: 1, tools: undefined });
    expect((loaded[1].tools as any[])[0].after).toBe('y'); // diff before/after 복원
  });

  it('listThreads: updated_at DESC 정렬', () => {
    const a = store.createThread('A');
    const b = store.createThread('B');
    store.saveThread(a, 'A', [{ role: 'user', content: 'x' }]); // a가 나중에 갱신 → 최상단
    const list = store.listThreads();
    expect(list.map((t) => t.id)).toEqual([a, b]);
    expect(list[0].title).toBe('A');
  });

  it('saveThread은 메시지를 전체 replace (증분 아님)', () => {
    const id = store.createThread('t');
    store.saveThread(id, 't', msgs());
    store.saveThread(id, 't', [{ role: 'user', content: '하나만' }]);
    expect(store.loadThread(id)).toHaveLength(1);
  });

  it('rename/delete (delete는 메시지 CASCADE)', () => {
    const id = store.createThread('old');
    store.saveThread(id, 'old', msgs());
    store.renameThread(id, 'new');
    expect(store.listThreads()[0].title).toBe('new');
    store.deleteThread(id);
    expect(store.listThreads()).toEqual([]);
    expect(store.loadThread(id)).toEqual([]); // 없는 스레드 → []
  });

  it('두 DB 파일은 격리된다', () => {
    const id = store.createThread('t1');
    const store2 = new ChatStore(path.join(dir, 'other.db'));
    try {
      expect(store2.listThreads()).toEqual([]);
      expect(store.listThreads().map((t) => t.id)).toEqual([id]);
    } finally {
      store2.close();
    }
  });
});
