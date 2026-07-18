# Plan 11 (v2): AI 채팅 스레드 영속화 — 설계 문서

**작성일**: 2026-07-18
**상태**: 설계 사용자 승인 완료 (대화형 브레인스토밍)
**목적**: AI 채팅 대화를 프로젝트별 SQLite DB에 스레드 단위로 저장·복원. 에이전트 도구 호출 기록(카드·diff)까지 복원.
**선행**: Plan 8 (AI 채팅), Plan 10 (에이전트 모드) — 기존 채팅/도구 카드 UI 재사용

## 1. 범위

포함:
- **프로젝트별 SQLite 저장**: `userData/chat/<프로젝트해시>.db` (인덱서 `userData/index/<해시>.db` 패턴과 대칭 — 프로젝트 폴더 오염 없음). main에서 better-sqlite3 **동기 직접 연결**(유틸리티 프로세스 아님). 프로젝트 열 때 open, 전환 시 close.
- **스레드 관리 UI** (SCR-20260718-jgww.png): 채팅 헤더 — 왼쪽 활성 스레드 제목, 오른쪽 `＋`(VscAdd, 새 스레드)·히스토리(VscHistory, 스레드 목록 드롭다운)·`⋯`(VscEllipsis, 현재 스레드 이름변경/삭제). 목록 항목은 제목+상대시각, 클릭 전환, hover 시 ×삭제, 제목 더블클릭 인라인 이름변경. 기존 컨텍스트/에이전트/자동승인 토글은 그 아래 슬림한 줄로 유지.
- **자동 제목**: 첫 사용자 메시지 앞부분(≤30자)으로 스레드 제목 자동 생성. 이름변경 가능.
- **도구 카드·diff 복원**: 어시스턴트 메시지의 도구 배열(AgentToolUi: name/summary/state/detail/path + diff before/after)을 JSON으로 저장 → 재로드 후 "변경된 파일" 칩이 diff를 그대로 연다. before/after는 에이전트가 이미 100KB 캡.
- **복원**: 프로젝트 열기 시 최근 갱신 스레드(updated_at DESC 최상단) 자동 로드. 없으면 빈 상태.

제외 (명시): 스레드 간 본문 FTS 검색(후속), 대화 내보내기/가져오기, 스레드 폴더/태그, 다중 창 동기화.

## 2. 결정 기록 (사용자 답변)

| 결정 | 선택 | 근거 |
|---|---|---|
| 저장 매체 | SQLite (better-sqlite3) | 이미 의존성·ABI 관리 대상, FTS 후속 확장 용이, 스트리밍 append/스레드 목록 쿼리 자연스러움 |
| 저장 범위 | 프로젝트별 | 채팅은 프로젝트 작업 컨텍스트 — 인덱서/LSP 리셋 규칙과 일관 |
| DB 배치 | 프로젝트마다 별도 DB | userData/chat/<해시>.db, 프로젝트 폴더 미오염 |
| 스레드 제목 | 첫 메시지에서 자동 (+ 이름변경) | 입력 없이 바로 사용 |
| 열기 동작 | 마지막 스레드 복원 | 이어서 작업 |
| 도구 기록 | 대화 복원 수준(카드·diff before/after 포함) | 재로드 후 diff 칩 동작 유지 |
| FTS 검색 | 이번엔 저장+복원만 | YAGNI — 후속 플랜 |
| UI | 헤더 3아이콘(＋/히스토리/⋯) — 스크린샷 | 미니멀, 스레드 관리 집중 |

## 3. 구조

```
src/main/chat-store.ts   ChatStore — better-sqlite3 동기. open(dbPath)/close,
                         listThreads/loadThread/createThread/saveThread(upsert+replace)/
                         renameThread/deleteThread. tools는 JSON 직렬화 컬럼
src/main/main.ts         ipc 6종 + openProject에서 ChatStore 교체(close→open 새 DB), before-quit close
src/main/persistence.ts  chatDbPathFor(root) 추가 (dbPathFor와 동일 해시)
src/preload/preload.ts   chatThreadsList/Load/Create/Save/Rename/Delete
src/renderer/src/store.ts    activeThreadId, threads 목록, setThreads/loadThread 리셋 포함
src/renderer/src/chat-persist.ts  저장 디바운스(활성 스레드 save) — 순수 트리거
src/renderer/src/components/ChatPanel.tsx  헤더(제목/＋/히스토리/⋯) + 스레드 드롭다운/이름변경
src/renderer/src/App.tsx   프로젝트 열기 후 스레드 목록 로드·최근 스레드 복원
```

**스키마:**
```sql
CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER, updated_at INTEGER);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, seq INTEGER NOT NULL,
  role TEXT NOT NULL, content TEXT NOT NULL, ts INTEGER, tools TEXT,  -- tools = AgentToolUi[] JSON (null 가능)
  FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
);
CREATE INDEX idx_messages_thread ON messages(thread_id, seq);
```

- **ipc 계약**: `chat:threads:list()` → `{id,title,updatedAt}[]`(updated_at DESC) / `chat:thread:load(id)` → `StoredMessage[]`(없으면 []) / `chat:thread:create()` → `{id}` / `chat:thread:save(id, title, messages)` → void(thread upsert + 메시지 전체 replace, updated_at=now) / `chat:thread:rename(id, title)` / `chat:thread:delete(id)`.
- **StoredMessage**: `{ role, content, ts?, error?, tools? }` — 렌더러 chatMessages 항목과 동형(tools는 AgentToolUi[]).

## 4. 데이터 흐름·수명·오류

1. 프로젝트 열기 → main ChatStore.open(chatDbPathFor(root)). 렌더러: threads:list → 최상단 스레드 load → store.chatMessages/activeThreadId 세팅(도구 카드·diff 포함). 없으면 빈 상태(activeThreadId null)
2. 사용자 첫 전송 → activeThreadId 없으면 chat:thread:create → id 확보, 첫 메시지 앞부분으로 제목 지정. 이후 대화 변경(사용자 전송/스트림 done) → 300ms 디바운스로 chat:thread:save(활성 전체)
3. 히스토리 아이콘 → threads:list 드롭다운. 항목 클릭 → 진행 중이면 취소 후 load → store 교체. ×→delete(활성이면 다음 최근 스레드 로드, 없으면 빈 상태). 제목 더블클릭/⋯메뉴 → rename
4. ＋ → 진행 중 취소 + 빈 스레드 상태(activeThreadId null, 메시지 비움) — 다음 전송 시 생성
5. 프로젝트 전환 → 진행 중 취소, ChatStore close→새 DB open, store 리셋 후 복원. 앱 종료 → close
6. 오류(DB 쓰기 실패 등) → 조용히 무시 + main 콘솔 로깅 (채팅 흐름 무영향, 기존 원칙)

## 5. 테스트

- **단위(TDD)**: ChatStore(임시 파일 DB) — create/list 정렬(updated_at DESC)/load/save(replace·tools JSON 왕복·seq 순서)/rename/delete(CASCADE)/없는 스레드 load=[]/두 DB 격리. 제목 생성 순수 함수(≤30자 절단)
- **통합**: 실제 better-sqlite3로 save→새 ChatStore 인스턴스 load 왕복(도구 before/after 포함 복원)
- **E2E**: 설정 심은 SI_USER_DATA로 앱 구동 → 메시지 전송(스레드 생성·자동 제목) → ＋ 새 스레드 → 히스토리로 이전 스레드 전환 → 앱 재시작(같은 SI_USER_DATA·프로젝트) → 대화·도구 카드 복원 확인
