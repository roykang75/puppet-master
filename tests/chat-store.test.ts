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

describe('ChatStore.searchMessages (FTS)', () => {
  it('메시지 본문 매칭 → 스레드 반환 + 스니펫 하이라이트', () => {
    const a = store.createThread('리액트');
    store.saveThread(a, '리액트', [{ role: 'user', content: 'useState 훅 설명해줘' }, { role: 'assistant', content: 'useState는 상태 훅입니다' }]);
    const b = store.createThread('파이썬');
    store.saveThread(b, '파이썬', [{ role: 'user', content: 'list comprehension 알려줘' }]);
    const hits = store.searchMessages('useState');
    expect(hits.map((h) => h.threadId)).toEqual([a]);
    expect(hits[0].title).toBe('리액트');
    expect(hits[0].snippet).toContain('⟦useState⟧');
  });

  it('스레드당 1건으로 dedupe (여러 메시지 매칭)', () => {
    const a = store.createThread('t');
    store.saveThread(a, 't', [{ role: 'user', content: 'foo bar' }, { role: 'assistant', content: 'foo baz' }]);
    const hits = store.searchMessages('foo');
    expect(hits).toHaveLength(1);
    expect(hits[0].threadId).toBe(a);
  });

  it('빈/공백 질의는 빈 배열', () => {
    const a = store.createThread('t');
    store.saveThread(a, 't', [{ role: 'user', content: 'anything' }]);
    expect(store.searchMessages('')).toEqual([]);
    expect(store.searchMessages('   ')).toEqual([]);
  });

  it('특수문자 질의도 구문오류 없이 안전 처리', () => {
    const a = store.createThread('t');
    store.saveThread(a, 't', [{ role: 'user', content: 'a AND b OR "quoted"' }]);
    // FTS5 예약어/따옴표가 그대로 들어와도 throw 없이 결과 반환
    expect(() => store.searchMessages('AND "quoted"')).not.toThrow();
    expect(store.searchMessages('quoted').map((h) => h.threadId)).toEqual([a]);
  });

  it('삭제된 스레드의 메시지는 검색에서 제외 (트리거 동기화)', () => {
    const a = store.createThread('t');
    store.saveThread(a, 't', [{ role: 'user', content: 'deletable content' }]);
    expect(store.searchMessages('deletable')).toHaveLength(1);
    store.deleteThread(a);
    expect(store.searchMessages('deletable')).toEqual([]);
  });

  it('saveThread replace 후 옛 본문은 검색 안 됨', () => {
    const a = store.createThread('t');
    store.saveThread(a, 't', [{ role: 'user', content: 'oldword' }]);
    store.saveThread(a, 't', [{ role: 'user', content: 'newword' }]);
    expect(store.searchMessages('oldword')).toEqual([]);
    expect(store.searchMessages('newword')).toHaveLength(1);
  });
});
