# Plan 2: UI 셸 — 설계 문서

**작성일**: 2026-07-16
**상태**: 사용자 승인 (브레인스토밍 완료)
**상위 스펙**: `2026-07-15-sourceinsight-clone-design.md` (§3 아키텍처, §6 UI, §8 데이터 흐름, §9 오류 처리)
**선행**: Plan 1 (기반 + 인덱서 코어, main 병합 `4b27519`)

## 1. 범위

Electron 창 + React 렌더러 + Monaco로 SI 스타일 에디터 셸을 세우고,
Plan 1 인덱서를 utilityProcess로 호스팅해 버전 있는 RPC로 배선한다.

포함:
- Electron 창 + React + Vite 렌더러
- 인덱서 utilityProcess 호스팅 + 버전 있는 IPC(RPC) 프로토콜
- SI 스타일 패널 레이아웃 (접기/크기조절/프로젝트별 저장)
- Monaco 에디터 + 파일 탭 + **편집/저장/저장 시 재인덱싱** (dirty 표시 포함)
- Project Window (파일 트리), Symbol Window (파일별 아웃라인)
- 워처 배선 (scanner와 gitignore 제외 규칙 공유 — 인계 노트 M-A 해소)

제외 (이후 Plan):
- Context/Relation Window 내용물, 검색 UI, 정의 점프 (Plan 3) — 패널 자리와 RPC 메서드만 준비
- 500ms 유휴 재파싱 (Plan 3 — 수혜자인 Context/Relation과 함께)
- 시맨틱 토큰 색상 (Plan 4), 패키징 (Plan 4)
- 라이트 테마 / 테마 전환, 패널 도킹(드래그 재배치)

## 2. 결정 기록

| 결정 | 선택 | 근거 |
|---|---|---|
| 편집 범위 | 편집 + 저장 + 저장 시 재인덱싱 | 에디터 기본 완결성. 유휴 재파싱은 수혜자 없어 YAGNI |
| 패널 레이아웃 | `react-resizable-panels` 고정 배치 | 스펙 §6 요구(접기/크기조절/저장)의 최소 구현. 도킹은 v2 검토 |
| 테마 | 다크 단일 (Monaco `vs-dark`) | CSS 변수 한 벌. 라이트는 변수 교체로 추후 확장 가능 |
| 빌드 | tsc(main+인덱서) + Vite(렌더러 전용) | Plan 1의 검증된 네이티브 로드 경로 보존. electron-vite 번들링 리스크 회피 |
| 렌더러 상태 | zustand 단일 스토어 | 패널 5개 상태 공유를 2KB 의존성으로, Context 리렌더 회피 |
| RPC 경로 | main 릴레이 (렌더러↔인덱서 직결 안 함) | 쿼리 목표 <50ms에 릴레이 비용 무시 가능, 인덱서 재시작 배선 단순 |
| 심볼 DB 위치 | `userData/index/<프로젝트 해시>.db` | 사용자 프로젝트 디렉터리 비오염 |

## 3. 프로세스 구조와 IPC

```
Renderer (React+Monaco, sandbox, contextIsolation)
   │  preload contextBridge — 타입 있는 API
Electron Main (창, 네이티브 메뉴, 파일 I/O, RPC 릴레이)
   │  utilityProcess postMessage
Indexer Process (pipeline + db + watcher + query api)
```

- main이 렌더러↔인덱서 RPC를 릴레이한다. 파일 열기/저장은 main이 직접 fs 처리하고,
  저장 성공 후 인덱서에 `indexFile`을 요청한다.
- 직접 MessagePort 연결은 릴레이 병목이 실측될 때만 도입한다.

### 3.1 프로토콜 (`src/shared/protocol.ts`, 세 프로세스 공유 타입)

```ts
PROTOCOL_VERSION = 1
요청:  { id, method, params }
응답:  { id, ok: true, result } | { id, ok: false, error: { message } }
이벤트: { event, payload }   // 인덱서 → UI 단방향
```

- **핸드셰이크**: 인덱서 기동 직후 `{ event: 'ready', protocolVersion }`.
  버전 불일치 시 명시적 오류 다이얼로그 (조용한 저하 금지).
- **메서드**: `openProject`, `searchSymbols`, `searchText`, `getDefinitions`,
  `getCallers`, `getCallees`, `getFileOutline`, `indexFile`
  — 검색/정의 조회는 Plan 2에서 프로토콜에 포함만 하고 UI는 Plan 3에서 연결.
- **이벤트**: `ready`, `indexProgress`, `fileIndexed`, `fileRemoved`
- RPC 타임아웃 10초 — 해당 요청만 실패 처리.

### 3.2 제외 규칙 공유 모듈 (`src/shared/ignore.ts`)

scanner의 .gitignore 필터를 추출해 **scanner / watcher / Project Window 트리**가
동일 규칙을 사용한다. 워처가 gitignore를 무시하던 인계 항목(M-A)을 해소한다.

## 4. 렌더러 컴포넌트와 상태

```
<AppShell>                        // 다크 테마 CSS 변수 루트
 ├─ <PanelGroup horizontal>
 │   ├─ <SidePanel>               // 좌측, 접기 가능
 │   │   ├─ <ProjectWindow/>      // 파일 트리, 디렉터리 지연 로드
 │   │   └─ <SymbolWindow/>       // 활성 파일 아웃라인
 │   ├─ <EditorArea>
 │   │   ├─ <FileTabs/>           // dirty(●) 표시 + 닫기
 │   │   └─ <MonacoEditor/>       // vs-dark, 로컬 번들 (CDN 미사용)
 │   └─ <RelationPanel/>          // 우측 — 빈 플레이스홀더
 ├─ <ContextPanel/>               // 하단 — 빈 플레이스홀더
 └─ <StatusBar/>                  // 인덱싱 진행률, 파일 언어/위치
```

- Relation/Context는 빈 패널로 배치해 레이아웃을 Plan 2에서 완결한다.
- **ProjectWindow**: main `fs.readdir` 기반 지연 로드, 공유 ignore 필터 적용.
  인덱싱 대상이 아닌 파일(README 등)도 표시·열람 가능.
- **SymbolWindow**: `getFileOutline` 결과. 클릭 → 에디터 위치 점프.
  `fileIndexed` 수신 시 갱신.
- **Monaco**: `monaco-editor` 직접 번들 + Vite worker 설정.
  문법 하이라이트는 Monaco 내장 사용 (시맨틱 토큰은 Plan 4).
- **상태**: zustand 스토어 하나 — 프로젝트 경로, 인덱싱 상태, 탭 목록/활성 탭,
  파일별 dirty. 파일 내용(Monaco 모델)은 Monaco가 소유.

### 4.1 지속성 (main 관리, `userData/` 하위)

- `recent.json` — 최근 프로젝트 (메뉴 File > Open Recent)
- `projects/<경로 해시>.json` — 패널 크기/접힘, 열린 탭, 활성 탭
- `index/<경로 해시>.db` — 심볼 DB
- 시작 시 자동 복원 없음 — Open Folder / Open Recent로 진입.

## 5. 데이터 흐름

**프로젝트 열기**: Open Folder → 인덱서 기동(최초 1회) → `openProject` →
스캔·증분 인덱싱, `indexProgress` → StatusBar. 인덱싱 완료 전에도 파일
열람/편집 가능 (파일 I/O는 main 직행). 저장된 레이아웃/탭 복원.

**편집→저장**: Monaco 변경 → dirty(●) → Ctrl+S → main fs 기록 → dirty 해제 →
`indexFile` → `fileIndexed` → SymbolWindow 갱신.

**외부 변경**: chokidar 감지 (공유 ignore 필터) → 재인덱싱 → `fileIndexed`/`fileRemoved`.
열린 파일이 변경된 경우: dirty 아니면 조용히 리로드, dirty면 버퍼 유지 +
탭에 "디스크 변경됨" 표시 (충돌 해결 UI 없음).

## 6. 오류 처리

- 인덱서 crash → 오류 다이얼로그 + 재시작 버튼 (자동 무한 재시작 금지).
  편집/저장은 인덱서 없이도 동작.
- 프로토콜 버전 불일치 → 명시적 다이얼로그.
- 저장 실패 → 다이얼로그, dirty 유지.
- RPC 타임아웃 → 해당 요청만 실패, UI는 빈 결과 표시.

## 7. 테스트

- **단위 (vitest)**: RPC 라우터(요청/응답 매칭, 타임아웃, 버전 검사),
  공유 ignore 필터(scanner·watcher 동일 결과), 탭/dirty 스토어 로직.
- **통합**: 인덱서를 child process로 띄워 RPC 왕복 —
  openProject → getFileOutline → indexFile → fileIndexed.
- **E2E 스모크 (Playwright for Electron) 1개**: 기동 → 픽스처 프로젝트 열기 →
  트리 표시 → 파일 열기 → 아웃라인 표시 → 편집·저장 → 아웃라인 갱신.
