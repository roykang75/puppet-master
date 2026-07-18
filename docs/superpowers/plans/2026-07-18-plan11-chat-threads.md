# Plan 11: AI 채팅 스레드 영속화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 채팅 대화를 프로젝트별 SQLite DB에 스레드 단위로 저장·복원하고, 헤더 3아이콘(＋/히스토리/⋯)으로 스레드를 관리한다.

**Architecture:** main에 better-sqlite3 동기 연결 `ChatStore`를 신설(유틸리티 프로세스 아님) — 프로젝트 열 때 `userData/chat/<해시>.db`를 open, 전환 시 close. 렌더러 store가 활성 스레드 메시지를 소유하고, 대화 변경 시 디바운스로 `chat:thread:save`를 호출해 영속화. 스트리밍(ChatService/AgentService)은 무변경.

**Tech Stack:** Electron main(Node), better-sqlite3(기존 의존성), React+zustand(렌더러), react-icons/vsc, vitest/Playwright.

## Global Constraints

- 저장 경로: `userData/chat/<프로젝트해시>.db` — 해시는 기존 `Persistence.projectHash`와 동일 (인덱서 `userData/index/<해시>.db`와 대칭)
- ChatStore는 main 전용(better-sqlite3 import). 순수 헬퍼(deriveTitle)는 `src/shared`에 둬 렌더러도 재사용
- 도구 기록: assistant 메시지의 `tools` 컬럼에 AgentToolUi[] JSON 저장 — 재로드 후 diff 칩 동작 유지 (before/after는 에이전트가 이미 100KB 캡)
- 오류(DB 쓰기 실패 등)는 조용히 무시 + main 콘솔 로깅 — 채팅 흐름 무영향
- 자동 제목: 첫 사용자 메시지 앞 30자 절단
- 이벤트 구독/스트림은 무회귀 (기존 채팅·에이전트 경로 그대로)
- 커밋 메시지 한국어 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`, `git add`는 명시 파일만
- 단위/통합 테스트는 node ABI 전제(`npx vitest run <파일>`); E2E는 electron ABI(`npm run rebuild:electron` 후)

---

## 파일 구조

```
src/shared/chat-title.ts          deriveTitle(순수) — Task 1
src/main/chat-store.ts            ChatStore (better-sqlite3) — Task 1
src/main/persistence.ts           chatDbPathFor(root) 추가 — Task 2
src/main/main.ts                  ipc 6종 + openProject open/close + before-quit close — Task 2
src/preload/preload.ts            chatThreads* API — Task 2
src/shared/protocol.ts            ThreadMeta/StoredMessage 타입 — Task 2
src/renderer/src/store.ts         activeThreadId/threads + 세터 — Task 3
src/renderer/src/chat-persist.ts  저장 디바운스 트리거(순수 배선) — Task 3
src/renderer/src/components/ChatPanel.tsx  헤더 3아이콘 + 드롭다운 + 이름변경 + 저장 트리거 — Task 4
src/renderer/src/App.tsx          프로젝트 열기 후 스레드 복원 — Task 4
src/renderer/src/theme.css        헤더/드롭다운 스타일 — Task 4
tests/chat-store.test.ts / chat-title.test.ts / chat-store-integration.test.ts / e2e/chat-threads.spec.ts
```

---

### Task 1: ChatStore(SQLite) + deriveTitle

**Files:**
- Create: `src/shared/chat-title.ts`
- Create: `src/main/chat-store.ts`
- Test: `tests/chat-title.test.ts`, `tests/chat-store.test.ts`

**Interfaces:**
- Produces:
  - `deriveTitle(firstUserMessage: string): string` — 공백 정리 후 ≤30자, 잘리면 '…'
  - `interface ThreadMeta { id: string; title: string; updatedAt: number }`
  - `interface StoredMessage { role: 'user' | 'assistant'; content: string; ts?: number; error?: string; tools?: unknown[] }`
  - `class ChatStore { constructor(dbPath: string); close(): void; listThreads(): ThreadMeta[]; loadThread(id: string): StoredMessage[]; createThread(title: string): string; saveThread(id: string, title: string, messages: StoredMessage[]): void; renameThread(id: string, title: string): void; deleteThread(id: string): void }`

- [ ] **Step 1: deriveTitle 실패 테스트**

```ts
// tests/chat-title.test.ts
import { describe, it, expect } from 'vitest';
import { deriveTitle } from '../src/shared/chat-title';

describe('deriveTitle', () => {
  it('짧은 메시지는 그대로, 공백 정리', () => {
    expect(deriveTitle('  구구단 만들어줘 ')).toBe('구구단 만들어줘');
    expect(deriveTitle('a\n\nb   c')).toBe('a b c');
  });
  it('30자 초과는 절단 + …', () => {
    const long = '가'.repeat(40);
    const t = deriveTitle(long);
    expect(t.length).toBe(31); // 30 + …
    expect(t.endsWith('…')).toBe(true);
  });
  it('빈 입력은 기본 제목', () => {
    expect(deriveTitle('   ')).toBe('새 대화');
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/chat-title.test.ts` → FAIL (모듈 없음)

- [ ] **Step 3: deriveTitle 구현**

```ts
// src/shared/chat-title.ts — 순수 (electron/SDK 임포트 금지)
export function deriveTitle(firstUserMessage: string): string {
  const clean = firstUserMessage.replace(/\s+/g, ' ').trim();
  if (!clean) return '새 대화';
  return clean.length > 30 ? clean.slice(0, 30) + '…' : clean;
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/chat-title.test.ts` → PASS

- [ ] **Step 5: ChatStore 실패 테스트**

```ts
// tests/chat-store.test.ts
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
```

- [ ] **Step 6: 실패 확인** — Run: `npx vitest run tests/chat-store.test.ts` → FAIL (모듈 없음)

- [ ] **Step 7: ChatStore 구현**

```ts
// src/main/chat-store.ts — 채팅 스레드 영속화 (better-sqlite3 동기, main 전용)
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface ThreadMeta {
  id: string;
  title: string;
  updatedAt: number;
}
export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  ts?: number;
  error?: string;
  tools?: unknown[];
}

export class ChatStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER, updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, seq INTEGER NOT NULL,
        role TEXT NOT NULL, content TEXT NOT NULL, ts INTEGER, tools TEXT,
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, seq);
    `);
  }

  close(): void {
    this.db.close();
  }

  listThreads(): ThreadMeta[] {
    return this.db
      .prepare('SELECT id, title, updated_at AS updatedAt FROM threads ORDER BY updated_at DESC')
      .all() as ThreadMeta[];
  }

  loadThread(id: string): StoredMessage[] {
    const rows = this.db
      .prepare('SELECT role, content, ts, tools FROM messages WHERE thread_id = ? ORDER BY seq')
      .all(id) as { role: string; content: string; ts: number | null; tools: string | null }[];
    return rows.map((r) => ({
      role: r.role as 'user' | 'assistant',
      content: r.content,
      ts: r.ts ?? undefined,
      tools: r.tools ? (JSON.parse(r.tools) as unknown[]) : undefined,
    }));
  }

  createThread(title: string): string {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare('INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, title, now, now);
    return id;
  }

  saveThread(id: string, title: string, messages: StoredMessage[]): void {
    const now = Date.now();
    const tx = this.db.transaction(() => {
      // 없으면 생성, 있으면 title/updated_at 갱신
      this.db
        .prepare(
          `INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
        )
        .run(id, title, now, now);
      this.db.prepare('DELETE FROM messages WHERE thread_id = ?').run(id);
      const ins = this.db.prepare('INSERT INTO messages (thread_id, seq, role, content, ts, tools) VALUES (?, ?, ?, ?, ?, ?)');
      messages.forEach((m, i) =>
        ins.run(id, i, m.role, m.content, m.ts ?? null, m.tools ? JSON.stringify(m.tools) : null),
      );
    });
    tx();
  }

  renameThread(id: string, title: string): void {
    this.db.prepare('UPDATE threads SET title = ? WHERE id = ?').run(title, id);
  }

  deleteThread(id: string): void {
    this.db.prepare('DELETE FROM threads WHERE id = ?').run(id); // messages는 CASCADE
  }
}
```

주의: 위 test의 `loaded[0]`은 `tools: undefined`를 포함해 비교한다 — loadThread가 tools 없는 행에 `tools: undefined`를 넣으므로 일치한다. `error` 필드는 스키마에 없다(현재 저장 대상 아님 — 도구/텍스트만). 저장 시 StoredMessage.error는 무시된다.

- [ ] **Step 8: 통과 확인** — Run: `npx vitest run tests/chat-store.test.ts tests/chat-title.test.ts` → PASS (전부)

- [ ] **Step 9: 커밋**

```bash
git add src/shared/chat-title.ts src/main/chat-store.ts tests/chat-title.test.ts tests/chat-store.test.ts
git commit -m "채팅 스레드 저장소: ChatStore(better-sqlite3) + deriveTitle — CRUD/tools JSON 왕복

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 프로토콜 타입 + persistence 경로 + main IPC + preload

**Files:**
- Modify: `src/shared/protocol.ts` (Chat 타입 근처)
- Modify: `src/main/persistence.ts` (dbPathFor 아래)
- Modify: `src/main/main.ts` (ChatService 생성부 근처 + openProjectInMain + before-quit)
- Modify: `src/preload/preload.ts`
- Test: 없음 (배선 — Task 5 통합/E2E가 검증)

**Interfaces:**
- Consumes: Task 1 `ChatStore/ThreadMeta/StoredMessage`, 기존 `persistence.projectHash`(private — 재사용 불가, dbPathFor와 같은 방식으로 새 메서드), `currentRoot`
- Produces:
  - protocol: `ThreadMeta`(재노출), `ChatStoredMessage = StoredMessage`
  - persistence: `chatDbPathFor(root: string): string`
  - preload: `chatThreadsList(): Promise<ThreadMeta[]>` / `chatThreadLoad(id): Promise<ChatStoredMessage[]>` / `chatThreadCreate(title): Promise<{id:string}>` / `chatThreadSave(id, title, messages): Promise<void>` / `chatThreadRename(id, title): Promise<void>` / `chatThreadDelete(id): Promise<void>`
  - ipc: `chat:threads:list` / `chat:thread:load` / `chat:thread:create` / `chat:thread:save` / `chat:thread:rename` / `chat:thread:delete`

- [ ] **Step 1: protocol 타입 추가** — `AgentEvent` 정의 아래에:

```ts
// ── 채팅 스레드 영속화 (Plan 11) ──
export interface ThreadMeta { id: string; title: string; updatedAt: number }
export interface ChatStoredMessage {
  role: 'user' | 'assistant';
  content: string;
  ts?: number;
  error?: string;
  tools?: unknown[]; // AgentToolUi[] (직렬화)
}
```

- [ ] **Step 2: persistence.chatDbPathFor** — `dbPathFor` 메서드 바로 아래에 추가:

```ts
  chatDbPathFor(root: string): string {
    return path.join(this.baseDir, 'chat', `${this.projectHash(root)}.db`);
  }
```

`chat` 디렉터리는 ChatStore가 여는 시점에 없을 수 있으므로 main에서 open 전에 생성한다(다음 스텝).

- [ ] **Step 3: main.ts — import + 상태 변수 + open/close** — import 추가:

```ts
import { ChatStore } from './chat-store';
import type { ChatStoredMessage } from '../shared/protocol';
```

`let chatService: ChatService;` 옆에 `let chatStore: ChatStore | null = null;`.

`openProjectInMain`에서 `agentService?.cancel();` 줄 아래에 ChatStore 교체:

```ts
    chatStore?.close();
    const chatDbPath = persistence.chatDbPathFor(root);
    fs.mkdirSync(path.dirname(chatDbPath), { recursive: true });
    chatStore = new ChatStore(chatDbPath);
```

(파일 상단에 `import * as fs from 'fs'`, `import * as path from 'path'`가 이미 있으면 재사용 — 없으면 추가.)

- [ ] **Step 4: main.ts — ipc 6종** — `chat:cancel` 핸들러 아래에:

```ts
  ipcMain.handle('chat:threads:list', () => chatStore?.listThreads() ?? []);
  ipcMain.handle('chat:thread:load', (_e, id: string) => chatStore?.loadThread(id) ?? []);
  ipcMain.handle('chat:thread:create', (_e, title: string) => ({ id: chatStore?.createThread(title) ?? '' }));
  ipcMain.handle('chat:thread:save', (_e, id: string, title: string, messages: ChatStoredMessage[]) => {
    try {
      chatStore?.saveThread(id, title, messages);
    } catch (e) {
      console.error('[chat-store] save 실패:', e instanceof Error ? e.message : e); // 채팅 흐름 무영향
    }
  });
  ipcMain.handle('chat:thread:rename', (_e, id: string, title: string) => chatStore?.renameThread(id, title));
  ipcMain.handle('chat:thread:delete', (_e, id: string) => chatStore?.deleteThread(id));
```

- [ ] **Step 5: main.ts — before-quit close** — 기존 `agentService?.cancel()`/`terminals?.killAll()`를 부르는 before-quit(또는 will-quit) 핸들러에 `chatStore?.close();` 추가. 없으면 `app.on('before-quit', () => { chatStore?.close(); });`를 app.whenReady 블록 근처에 추가.

- [ ] **Step 6: preload** — `chatCancel` 아래에 (protocol 타입 임포트에 `ThreadMeta, ChatStoredMessage` 추가):

```ts
  chatThreadsList: (): Promise<ThreadMeta[]> => ipcRenderer.invoke('chat:threads:list'),
  chatThreadLoad: (id: string): Promise<ChatStoredMessage[]> => ipcRenderer.invoke('chat:thread:load', id),
  chatThreadCreate: (title: string): Promise<{ id: string }> => ipcRenderer.invoke('chat:thread:create', title),
  chatThreadSave: (id: string, title: string, messages: ChatStoredMessage[]): Promise<void> =>
    ipcRenderer.invoke('chat:thread:save', id, title, messages),
  chatThreadRename: (id: string, title: string): Promise<void> => ipcRenderer.invoke('chat:thread:rename', id, title),
  chatThreadDelete: (id: string): Promise<void> => ipcRenderer.invoke('chat:thread:delete', id),
```

- [ ] **Step 7: 빌드 확인** — Run: `npm run build 2>&1 | grep -iE "\berror\b" | grep -v ".svg"; echo OK` → OK만

- [ ] **Step 8: 커밋**

```bash
git add src/shared/protocol.ts src/main/persistence.ts src/main/main.ts src/preload/preload.ts
git commit -m "채팅 스레드 IPC 배선: chat:thread:* 6종 + 프로젝트별 ChatStore open/close + 프로토콜 타입

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 렌더러 store + 저장 디바운스

**Files:**
- Modify: `src/renderer/src/store.ts`
- Create: `src/renderer/src/chat-persist.ts`
- Test: `tests/renderer-store.test.ts` (케이스 추가)

**Interfaces:**
- Consumes: Task 2 preload `chatThreadSave`, Task 1 `deriveTitle`, protocol `ThreadMeta`
- Produces (store):
  - `activeThreadId: string | null` / `setActiveThreadId(id: string | null): void`
  - `threads: ThreadMeta[]` / `setThreads(list: ThreadMeta[]): void`
  - `loadThreadMessages(msgs: AppState['chatMessages']): void` — 스레드 로드 시 chatMessages 교체
  - `setProject` 리셋에 `activeThreadId: null, threads: []` 포함
- Produces (chat-persist): `scheduleChatSave(): void` — 활성 스레드 저장 디바운스(300ms). activeThreadId 없으면 no-op.

- [ ] **Step 1: 실패 스토어 테스트 추가** — `tests/renderer-store.test.ts`에:

```ts
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
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/renderer-store.test.ts` → FAIL

- [ ] **Step 3: store 구현** — 타입 임포트에 `ThreadMeta` 추가(`import type { AgentToolUi, ... , ThreadMeta } from '../../shared/protocol'`). 상태에 추가:

```ts
  activeThreadId: string | null;
  threads: ThreadMeta[];
  setActiveThreadId(id: string | null): void;
  setThreads(list: ThreadMeta[]): void;
  loadThreadMessages(msgs: AppState['chatMessages']): void;
```

초기값 `activeThreadId: null, threads: [],`. 구현:

```ts
  setActiveThreadId: (activeThreadId) => set({ activeThreadId }),
  setThreads: (threads) => set({ threads }),
  loadThreadMessages: (chatMessages) => set({ chatMessages, chatStreaming: false }),
```

`setProject`의 set 객체에 `activeThreadId: null, threads: [],` 추가. `clearChat`은 `chatMessages: [], chatStreaming: false`에 `activeThreadId: null` 추가(새 대화 = 활성 스레드 해제).

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/renderer-store.test.ts` → PASS

- [ ] **Step 5: chat-persist.ts 구현**

```ts
// src/renderer/src/chat-persist.ts — 활성 스레드 저장 디바운스 (순수 배선)
import { useAppStore } from './store';
import { deriveTitle } from '../../shared/chat-title';

let timer: ReturnType<typeof setTimeout> | null = null;

/** 대화 변경 시 호출 — 300ms 디바운스로 활성 스레드를 저장. activeThreadId 없으면 no-op.
 *  제목은 첫 사용자 메시지에서 파생(스레드 목록 갱신은 호출측이 필요 시 별도로). */
export function scheduleChatSave(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const st = useAppStore.getState();
    const id = st.activeThreadId;
    if (!id || st.chatMessages.length === 0) return;
    const firstUser = st.chatMessages.find((m) => m.role === 'user');
    const title = deriveTitle(firstUser?.content ?? '');
    void window.si.chatThreadSave(id, title, st.chatMessages);
  }, 300);
}
```

- [ ] **Step 6: 빌드 확인** — Run: `npm run build 2>&1 | grep -iE "\berror\b" | grep -v ".svg"; echo OK` → OK만

- [ ] **Step 7: 커밋**

```bash
git add src/renderer/src/store.ts src/renderer/src/chat-persist.ts tests/renderer-store.test.ts
git commit -m "렌더러 스레드 상태 + 저장 디바운스 — activeThreadId/threads/loadThreadMessages, scheduleChatSave

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: ChatPanel 헤더 UI + App 복원

**Files:**
- Modify: `src/renderer/src/components/ChatPanel.tsx`
- Modify: `src/renderer/src/App.tsx` (openProject 후 복원)
- Modify: `src/renderer/src/theme.css`
- Test: 없음 (Task 5 E2E가 검증)

**Interfaces:**
- Consumes: Task 3 store(`activeThreadId/threads/setThreads/setActiveThreadId/loadThreadMessages/clearChat`), `scheduleChatSave`, preload chatThread*, `deriveTitle`, react-icons `VscAdd/VscHistory/VscEllipsis/VscClose`
- Produces: 헤더 UI, 첫 전송 시 스레드 생성, 저장 트리거

- [ ] **Step 1: ChatPanel 헤더 교체** — 기존 `chat-toolbar`의 `＋`(새 대화) 버튼을 3아이콘 헤더로. 임포트 추가:

```ts
import { VscAdd, VscHistory, VscEllipsis, VscClose, VscArrowUp, VscCheck, VscCopy, VscDebugStop } from 'react-icons/vsc';
import { scheduleChatSave } from '../chat-persist';
import { deriveTitle } from '../../shared/chat-title';
```

컴포넌트 상단에 상태·구독:

```ts
  const activeThreadId = useAppStore((s) => s.activeThreadId);
  const threads = useAppStore((s) => s.threads);
  const [listOpen, setListOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const activeTitle = threads.find((t) => t.id === activeThreadId)?.title ?? '새 대화';

  const refreshThreads = () => void window.si.chatThreadsList().then((l) => useAppStore.getState().setThreads(l));
  const switchThread = async (id: string) => {
    void window.si.chatCancel();
    const msgs = await window.si.chatThreadLoad(id);
    const st = useAppStore.getState();
    st.setActiveThreadId(id);
    st.loadThreadMessages(msgs as typeof st.chatMessages);
    setListOpen(false);
  };
  const newThread = () => {
    void window.si.chatCancel();
    const st = useAppStore.getState();
    st.clearChat(); // chatMessages 비움 + activeThreadId null
    setListOpen(false);
  };
  const deleteThread = async (id: string) => {
    await window.si.chatThreadDelete(id);
    await window.si.chatThreadsList().then((l) => useAppStore.getState().setThreads(l));
    if (useAppStore.getState().activeThreadId === id) {
      const next = useAppStore.getState().threads[0];
      if (next) void switchThread(next.id);
      else newThread();
    }
  };
  const renameActive = (title: string) => {
    if (!activeThreadId || !title.trim()) return;
    void window.si.chatThreadRename(activeThreadId, title.trim()).then(refreshThreads);
  };
```

`chat-toolbar`를 다음으로 교체(컨텍스트/에이전트/자동승인 토글 줄은 그대로 두고 그 위에 헤더 추가):

```tsx
      <div className="chat-thread-header">
        {renaming ? (
          <input
            className="chat-thread-title-input"
            defaultValue={activeTitle}
            autoFocus
            onBlur={(e) => { renameActive(e.target.value); setRenaming(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { renameActive((e.target as HTMLInputElement).value); setRenaming(false); } if (e.key === 'Escape') setRenaming(false); }}
          />
        ) : (
          <span className="chat-thread-title" onDoubleClick={() => activeThreadId && setRenaming(true)} title={activeTitle}>{activeTitle}</span>
        )}
        <span className="chat-thread-actions">
          <button className="chat-new" title="새 대화" onClick={newThread}><VscAdd /></button>
          <button className="chat-new" title="대화 기록" onClick={() => { refreshThreads(); setListOpen((o) => !o); }}><VscHistory /></button>
          <button className="chat-new" title="현재 대화" onClick={() => setMenuOpen((o) => !o)} disabled={!activeThreadId}><VscEllipsis /></button>
        </span>
        {listOpen && (
          <>
            <div className="open-editors-backdrop" onMouseDown={() => setListOpen(false)} />
            <div className="open-editors-menu chat-thread-menu">
              <div className="open-editors-title">대화 기록 {threads.length}개</div>
              {threads.length === 0 && <div className="hint">저장된 대화가 없습니다.</div>}
              {threads.map((t) => (
                <div key={t.id} className={`open-editors-item${t.id === activeThreadId ? ' active' : ''}`} onClick={() => void switchThread(t.id)}>
                  <VscHistory />
                  <span className="open-editors-name">{t.title}</span>
                  <span className="tab-close" onClick={(e) => { e.stopPropagation(); void deleteThread(t.id); }}><VscClose /></span>
                </div>
              ))}
            </div>
          </>
        )}
        {menuOpen && (
          <>
            <div className="open-editors-backdrop" onMouseDown={() => setMenuOpen(false)} />
            <div className="open-editors-menu chat-thread-menu chat-thread-ctxmenu">
              <div className="open-editors-item" onClick={() => { setMenuOpen(false); setRenaming(true); }}>이름 변경</div>
              <div className="open-editors-item" onClick={() => { setMenuOpen(false); if (activeThreadId) void deleteThread(activeThreadId); }}>삭제</div>
            </div>
          </>
        )}
      </div>
```

- [ ] **Step 2: 첫 전송 시 스레드 생성 + 저장 트리거** — `send()`에서 `st.appendChatUser(text);` 직전에 스레드 확보:

```ts
    let tid = useAppStore.getState().activeThreadId;
    if (!tid) {
      const { id } = await window.si.chatThreadCreate(deriveTitle(text));
      tid = id;
      useAppStore.getState().setActiveThreadId(id);
    }
```

`send()` 끝(chatSend/agentSend 호출 뒤)과 `cancel()`에 `scheduleChatSave();` 추가. 또한 App의 스트림 `done` 처리에서도 저장돼야 하므로 Step 3에서 App에 넣는다.

- [ ] **Step 3: App.tsx — done 시 저장 + 프로젝트 열기 복원** — 임포트 `import { scheduleChatSave } from './chat-persist';`. onChatEvent/onAgentEvent의 `done` 분기에 `scheduleChatSave();` 추가(setChatStreaming(false) 옆). `openProject` 함수의 `st.setProject(res.root);` 아래에 복원:

```ts
    void window.si.chatThreadsList().then(async (list) => {
      st.setThreads(list);
      if (list.length > 0) {
        const msgs = await window.si.chatThreadLoad(list[0].id);
        st.setActiveThreadId(list[0].id);
        st.loadThreadMessages(msgs as typeof st.chatMessages);
      }
    });
```

- [ ] **Step 4: theme.css** — 채팅 섹션에:

```css
.chat-thread-header { flex: none; display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-bottom: 1px solid var(--border); position: relative; }
.chat-thread-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.chat-thread-title-input { flex: 1; min-width: 0; font: inherit; font-size: 13px; background: var(--bg); color: var(--fg); border: 1px solid var(--accent); border-radius: 3px; padding: 1px 5px; outline: none; }
.chat-thread-actions { flex: none; display: flex; gap: 2px; }
.chat-thread-menu { left: auto; right: 8px; top: 100%; }
.chat-thread-ctxmenu { min-width: 120px; }
```

- [ ] **Step 5: 빌드 확인** — Run: `npm run build 2>&1 | grep -iE "\berror\b" | grep -v ".svg"; echo OK` → OK만

- [ ] **Step 6: 커밋**

```bash
git add src/renderer/src/components/ChatPanel.tsx src/renderer/src/App.tsx src/renderer/src/theme.css
git commit -m "채팅 헤더 UI: 제목 + 새대화/대화기록/메뉴 3아이콘, 스레드 전환·이름변경·삭제, 열기 시 복원

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 통합 테스트 + E2E

**Files:**
- Create: `tests/chat-store-integration.test.ts`
- Create: `tests/e2e/chat-threads.spec.ts`

**Interfaces:**
- Consumes: Task 1 `ChatStore`, 전체 배선
- Produces: 검증만

- [ ] **Step 1: 통합 테스트** — 파일 DB로 저장→새 인스턴스 로드 왕복(도구 before/after 포함):

```ts
// tests/chat-store-integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ChatStore } from '../src/main/chat-store';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-chat-int-'));
  dbPath = path.join(dir, 'chat.db');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('ChatStore 영속화 왕복', () => {
  it('저장 후 새 인스턴스가 도구 카드(diff before/after)까지 복원', () => {
    const a = new ChatStore(dbPath);
    const id = a.createThread('구구단');
    a.saveThread(id, '구구단', [
      { role: 'user', content: '구구단 만들어', ts: 1 },
      { role: 'assistant', content: '완료', ts: 2, tools: [{ id: 'c1', name: 'write_file', summary: 'g.py', state: 'done', path: 'g.py', before: 'old', after: 'new' }] },
    ]);
    a.close();

    const b = new ChatStore(dbPath);
    try {
      expect(b.listThreads().map((t) => t.title)).toEqual(['구구단']);
      const msgs = b.loadThread(id);
      expect(msgs).toHaveLength(2);
      const tool = (msgs[1].tools as any[])[0];
      expect(tool.before).toBe('old');
      expect(tool.after).toBe('new');
      expect(tool.path).toBe('g.py');
    } finally {
      b.close();
    }
  });
});
```

- [ ] **Step 2: 통합 통과** — Run: `npx vitest run tests/chat-store-integration.test.ts` → PASS

- [ ] **Step 3: E2E 작성** — 기존 `tests/e2e/chat.spec.ts`의 fake SSE 서버/설정 심기 패턴 사용. 앱을 두 번 launch(같은 work/ud/proj)해 재시작 복원 확인:

```ts
// tests/e2e/chat-threads.spec.ts
import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

function startFakeServer(): Promise<{ server: http.Server; baseURL: string }> {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const t of ['응답', ' 완료'])
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, baseURL: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` })),
  );
}

test('채팅 스레드: 저장 → 새 스레드 → 재시작 복원', async () => {
  const { server, baseURL } = await startFakeServer();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-thread-'));
  const proj = path.join(work, 'proj');
  const ud = path.join(work, 'ud');
  fs.mkdirSync(proj);
  fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(proj, 'a.ts'), 'const x = 1;\n');
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ profiles: [{ id: 'p1', name: 'f', provider: 'openai', model: 'f', baseURL, apiKey: 'k' }], activeProfileId: 'p1' }));
  const env = { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: ud };

  // 1회차: 메시지 전송 → 스레드 자동 생성·제목
  let app = await electron.launch({ args: ['.'], env });
  let page = await app.firstWindow();
  await expect(page.locator('.tree-item', { hasText: 'a.ts' })).toBeVisible({ timeout: 15_000 });
  await page.locator('.right-tabs button', { hasText: 'AI 채팅' }).click();
  const input = page.locator('.chat-input-row textarea');
  await input.fill('첫 질문입니다');
  await input.press('Enter');
  await expect(page.locator('.chat-assistant')).toContainText('응답 완료', { timeout: 15_000 });
  await expect(page.locator('.chat-thread-title')).toContainText('첫 질문입니다');
  await page.waitForTimeout(600); // 저장 디바운스
  await app.close();

  // 2회차: 재시작 → 이전 대화 복원
  app = await electron.launch({ args: ['.'], env });
  page = await app.firstWindow();
  await expect(page.locator('.tree-item', { hasText: 'a.ts' })).toBeVisible({ timeout: 15_000 });
  await page.locator('.right-tabs button', { hasText: 'AI 채팅' }).click();
  try {
    await expect(page.locator('.chat-user')).toContainText('첫 질문입니다', { timeout: 10_000 });
    await expect(page.locator('.chat-assistant')).toContainText('응답 완료');
    await expect(page.locator('.chat-thread-title')).toContainText('첫 질문입니다');
    // 대화 기록 드롭다운에 1개
    await page.locator('.chat-thread-actions button[title="대화 기록"]').click();
    await expect(page.locator('.chat-thread-menu .open-editors-item')).toHaveCount(1);
  } finally {
    await app.close();
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: E2E 실행** — Run: `npm run build && npm run rebuild:electron && npx playwright test tests/e2e/chat-threads.spec.ts` → 1 passed. 실패 시 원인 수정 후 재실행.

- [ ] **Step 5: 전체 회귀** — Run: `npm run rebuild:node && npm test 2>&1 | grep -E "Test Files|Tests "` → 전체 PASS(기존 + 신규)

- [ ] **Step 6: 커밋**

```bash
git add tests/chat-store-integration.test.ts tests/e2e/chat-threads.spec.ts
git commit -m "채팅 스레드 통합/E2E: 영속화 왕복 + 재시작 복원 실증

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
