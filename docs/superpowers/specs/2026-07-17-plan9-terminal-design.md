# Plan 9 (v2): 내장 터미널 — 설계 문서

**작성일**: 2026-07-17
**상태**: 설계 사용자 승인 완료 (대화형 브레인스토밍)
**목적**: Claude Code CLI / codex 등 TUI를 앱 안에서 직접 실행
**선행**: Plan 8 (main 병합 `8e85e76`)

## 1. 범위

포함:
- **하단 "Context | Terminal" 탭 전환** + `` Ctrl+` `` 토글(터미널 탭으로 전환/하단 포커스). 탭 전환은 **CSS 숨김** — 언마운트 금지 (터미널 버퍼/실행 상태 유지)
- **다중 터미널 탭**: + 새 터미널, × 닫기(PTY kill), 탭 전환. xterm 인스턴스는 전환 시에도 **CSS로만 숨김**
- **main PTY 소유**: node-pty로 로그인 셸(`process.env.SHELL || '/bin/zsh'`, `['-l']`, cwd=프로젝트 루트, `TERM=xterm-256color`) 스폰 — 패키지 앱(GUI PATH 미상속)에서도 CLI가 PATH에 잡힘. id별 라우팅 ipc: `terminal:spawn/input/resize/kill`(invoke) + `terminal:data/exit`(push)
- **수명**: 지연 기동(터미널 탭 첫 진입 시 1개), 셸 자연 종료 시 "(종료됨)" 표시(자동 재스폰 없음), **프로젝트 전환 시 전부 kill 후 새 cwd로 빈 터미널 1개 재스폰**, 앱 종료 시 전부 kill
- **테마 연동**: xterm 배경/전경을 테마 CSS 변수에서 유도, 테마 변경 시 즉시 반영 (Plan 7 통합)
- **네이티브 모듈 절차**: node-pty를 rebuild:electron/rebuild:node 목록 + electron-builder asarUnpack에 추가, 패키지 앱 실증 포함

제외 (명시):
- 분할(스플릿) 터미널, 터미널 검색/링크 클릭, 프로파일(셸 선택 UI), 세션 복원, 에디터↔터미널 연동(파일 경로 클릭 등), Windows/Linux (macOS만 — 기존 패키징 정책)

## 2. 결정 기록 (사용자 답변)

| 결정 | 선택 | 근거 |
|---|---|---|
| 배치 | 하단 Context\|Terminal 탭 + Ctrl+` (a) | 새 공간 안 뺏음, 리사이즈 핸들로 TUI용 높이 확보 가능 |
| 개수 | 다중 터미널 탭 (b) | + / × / 전환. CLI 에이전트와 일반 셸 병행 사용 |
| 프로젝트 전환 | 전부 종료 → 새 cwd 1개 재스폰 (a) | "프로젝트 = 작업 컨텍스트" — 인덱서/LSP/채팅 리셋 규칙과 일관 |
| 아키텍처 | main이 node-pty 소유 + ipc 중계 (1안) | 프로세스는 main, 렌더러는 표면만 — 기존 원칙. utilityProcess(간접층)·렌더러 직접(보안) 기각 |
| 탭 전환 방식 | CSS 숨김 (언마운트 금지) | xterm 버퍼/TUI 상태 유지 + Plan 8 P1(언마운트 이벤트 유실) 교훈의 구조적 적용 |
| 로그인 셸 | `-l` 플래그 | 패키지 앱 PATH 확보 (macOS GUI 앱은 터미널 PATH 미상속) |
| 오류 폴백 | node-pty 로드/스폰 실패 시 탭에 안내만 | 편집/인덱서/LSP/채팅 무영향 (기존 폴백 원칙) |

## 3. 구조

```
src/main/terminal/manager.ts   TerminalManager — pty 스폰(id 발급)/input/resize/kill/killAll,
                               onData/onExit → 콜백(main이 ipc push로 릴레이). node-pty는 지연 require
                               (로드 실패 시 spawn이 오류 반환 — 앱 기동 무영향)
src/main/main.ts               ipc 4종 invoke + terminal:data/exit push, 프로젝트 전환·종료 훅
src/preload/preload.ts         terminalSpawn/Input/Resize/Kill + onTerminalEvent
src/renderer/src/components/BottomPanel.tsx   Context|Terminal 탭 (CSS 숨김 전환)
src/renderer/src/components/TerminalPanel.tsx 탭 바(+/×/전환) + 터미널 뷰들 (CSS 숨김)
src/renderer/src/terminal-view.ts             xterm 인스턴스 관리 (생성/데이터/리사이즈/테마/dispose)
src/renderer/src/store.ts      terminals: {id, title, exited}[] / activeTerminalId / bottomTab
```

- ipc 계약: `terminal:spawn()` → `{id}` 또는 `{error}` / `terminal:input(id, data)` / `terminal:resize(id, cols, rows)` / `terminal:kill(id)` / push `terminal:event` = `{type:'data', id, data}` | `{type:'exit', id}`.
- 렌더러 리사이즈: fit addon + ResizeObserver → `terminal:resize`. 하단 패널 크기 변경/탭 표시 시 fit 재실행.
- 테마: apply.ts가 테마 적용 후 `window.dispatchEvent(new CustomEvent('si:theme-changed'))` — terminal-view가 수신해 xterm theme(배경 `--bg`, 전경 `--fg`, 커서 `--accent`) 갱신.
- `Ctrl+\``: App 전역 keydown — 하단 탭을 terminal로 전환(+이미 terminal이면 활성 터미널 포커스). Context로 되돌리기는 탭 클릭.

## 4. 데이터 흐름·수명·오류

1. 터미널 탭 첫 진입 → terminals가 비어 있으면 `terminal:spawn` → xterm 생성·연결
2. 키 입력 → `terminal:input` → pty. pty 출력 → `terminal:event{data}` → 해당 id의 xterm.write
3. + 버튼 → spawn 추가 (제목 "터미널 N"). × → `terminal:kill` + xterm dispose + store 제거. 마지막 탭을 닫으면 빈 상태(안내 + "새 터미널" 버튼)
4. 셸 자연 종료(exit) → 탭 제목에 "(종료됨)", 입력 무시, ×로 정리
5. 프로젝트 전환 → main killAll + 렌더러 xterm 전부 dispose/스토어 리셋 → 터미널 탭이 활성 상태면 새 cwd로 1개 재스폰 (아니면 다음 진입 시 지연 기동)
6. 앱 종료 → killAll
7. node-pty 로드/스폰 실패 → `{error}` → 터미널 탭에 오류 안내 표시, 다른 기능 무영향

## 5. 테스트

- **단위(TDD)**: TerminalManager를 fake pty 주입으로 — id 발급/라우팅/kill/killAll/exit 콜백/스폰 실패 오류 반환. 스폰 스펙 순수 함수(셸/인자/env/cwd 구성) 검증
- **통합**: 실제 node-pty로 셸 스폰 → `echo hello` 입력 → 출력 수신 → resize → kill 왕복 (node ABI에서 동작 — node-pty는 양 ABI 리빌드 대상)
- **E2E**: 터미널 탭 진입 → `echo hello\r` 타이핑 → xterm 렌더에 hello 표시 → + 로 두 번째 터미널 → 탭 전환 → 프로젝트 무관 동작 확인
- **패키징**: asarUnpack 추가 후 패키지 앱에서 터미널 스폰 + `echo $PATH` 실행으로 로그인 셸 PATH 실증
