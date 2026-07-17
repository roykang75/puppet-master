# Plan 6 (v2): LSP 보강 — 설계 문서

**작성일**: 2026-07-17
**상태**: 설계 섹션별 사용자 승인 완료 (대화형 브레인스토밍)
**상위 스펙**: `2026-07-15-sourceinsight-clone-design.md` §5 "이 모듈만 교체하면 v2에서 LSP 보강(하이브리드)으로 확장된다"
**선행**: v1.5 완성 (Plan 1~5, main `55e1118` 시점)

## 1. 범위

포함:
- **경량 LSP 클라이언트 직접 구현** (main): `child_process` stdio + `vscode-jsonrpc`. monaco-languageclient 미사용 (아래 결정 기록)
- **언어 2종**: TypeScript/JS (`typescript-language-server`) 1차, Python (`pyright`) 2차 — 두 서버 모두 앱 dependencies로 **번들**
- **기능 4종**: 완성(드롭다운), 호버(신규), 정의 이동(LSP 우선 + 기존 resolveAndJump 폴백), 진단(신규 — 에디터 마커)
- LSP 언어에서 `quickSuggestions` 재활성 (AI 고스트와 역할 분담)
- 상태바 LSP 상태 표시 (기동/중지)

제외 (명시):
- 참조 찾기·rename·코드 액션·포매팅·시그니처 도움말 (후속 증분 — 기능당 "프로토콜 메서드 1 + provider 1" 구조로 추가 가능)
- Java/jdtls (3차 — 서버 획득 방식이 달라 별도 계획)
- 서버 경로 사용자 설정 (YAGNI — 번들만)
- incremental sync (Full 동기화로 시작)
- Relation/Symbol 창, 통합 검색, Smart Rename은 **기존 tree-sitter 인덱서 유지** — LSP가 죽어도 기존 기능 무영향이 핵심 불변식

## 2. 결정 기록 (사용자 답변)

| 결정 | 선택 | 근거 |
|---|---|---|
| 언어 우선순위 | TS/JS → Python (→ Java 3차) | 핵심 사용층이 Node/TS/JS > Python(FastAPI) > Java(Spring Boot) 순 (사용자 교정 — C/C++ 아님) |
| 서버 획득 | 앱 dependencies 번들 | 두 서버 모두 npm 패키지. 사용자 설치 부담 0. 용량 증가(수십 MB)와 버전 고정은 수용 |
| 기능 범위 | 핵심 4종만 | 참조/rename은 인덱서가 이미 담당 — 안정 후 후속 |
| 완성 공존 정책 | LSP 언어는 드롭다운 자동 + AI 고스트는 위젯 닫힘 상황 담당 | Monaco가 위젯 열림 중 고스트를 억제하므로 자연 분담. **실사용 후 조정 가능성 명시** (사용자: "실제 구현하고 사용해봐야 안다") |
| 클라이언트 구현 | 직접 경량 구현 (1안) | monaco-languageclient 최신은 @codingame 포크로 monaco-editor 교체 필요 — 기존 Monaco 직접 통합(시맨틱 토큰/인라인 완성/커스텀 range) 전면 재작업 비용. 4기능만 필요하므로 직접 배선 비용이 작음 |
| 확장성 완충 장치 | ① 클라이언트 코어(프로토콜/수명) ↔ 기능 배선(Monaco provider) 분리 ② 공식 `vscode-languageserver-protocol` 타입 사용 ③ 서버 정의 선언적 테이블 | 사용자 우려(1안 확장성) 대응 — 기능 추가가 렌더러 배선 증분으로 국한, 플랫폼 전환 시에도 main 수명 관리·서버 정의 생존 |
| 서버 실행 | `ELECTRON_RUN_AS_NODE=1` + 자체 실행 파일로 스폰 | 사용자 머신에 node 불요. 패키징 시 서버 패키지 asarUnpack |

## 3. 프로세스 구조

```
┌─ Electron main ──────────────────────────────────┐
│  LspManager                                       │
│   ├─ 서버 정의 테이블 (선언적)                      │
│   │   ts: typescript-language-server --stdio      │
│   │       파일: .ts .tsx .js .jsx .mjs .cjs        │
│   │   py: pyright-langserver --stdio              │
│   │       파일: .py                                │
│   ├─ LspClient (언어별 1개, 프로젝트당)             │
│   │   child_process(stdio) + vscode-jsonrpc       │
│   └─ 수명: 지연 기동 / 크래시 재시작 / 전환 시 종료  │
└──────────────┬───────────────────────────────────┘
        ipc: lsp:call(화이트리스트) / lsp:event
┌─ Renderer ───┴───────────────────────────────────┐
│  lsp-features.ts — Monaco provider 배선            │
└──────────────────────────────────────────────────┘
```

- **지연 기동**: 해당 언어 파일을 처음 열 때 그 언어 서버 시작. 프로젝트 전환 시 전체 종료 후 새 루트 기준 재기동.
- **크래시 정책**: 자동 재시작, 연속 3회 크래시 시 해당 언어 LSP 비활성 + 상태바 "LSP(ts): 중지됨". 앱 재시작/프로젝트 재열기로 리셋.
- 렌더러는 서버 프로세스의 존재를 모른다 — ipc 표면만 안다.

## 4. 문서 동기화와 좌표 규약

- **전체 텍스트 동기화** (TextDocumentSyncKind.Full). `didChange`는 **200ms 디바운스 + 요청 직전 강제 플러시** — 완성/정의 요청 시점에 서버가 항상 최신 텍스트를 보게 한다. 저장 시 `didSave`, 탭 닫기 시 `didClose`.
- **좌표**: LSP 0-기반 줄 — 기존 규칙(DB/RPC 0-기반, Monaco 1-기반, 경계 +1) 그대로. 컬럼은 양쪽 다 UTF-16이라 +1 변환만.

## 5. 기능 흐름

| 기능 | 흐름 | 비고 |
|---|---|---|
| 완성 | Monaco `CompletionItemProvider` → `lsp:call(completion)` → itemKind/insertText 변환 | LSP 언어만 `quickSuggestions`/`suggestOnTriggerCharacters` 재활성 — 파일 전환 시 `updateOptions` 분기 |
| 호버 | `HoverProvider` → `lsp:call(hover)` → markdown | 신규 |
| 정의 이동 | F12/Ctrl+클릭 → LSP 우선, **1.5초 내 무응답/실패/서버 없음 → resolveAndJump 폴백** | 기존 UX 불변 |
| 진단 | 서버 push → main 릴레이(`lsp:event`) → `setModelMarkers` | 열린 파일만, 파일당 최대 500개 |

- ipc: `lsp:call`은 completion/hover/definition 3종 화이트리스트 (`indexer:call` 패턴 동일). `lsp:event`는 진단 push + 서버 상태.

## 6. 오류 처리·성능 경계

- 요청 실패/타임아웃(기능별 3~5초, 정의는 1.5초 폴백): 해당 기능만 조용히 빈 결과. 다이얼로그·중단 없음.
- 대형 프로젝트 초기 분석 중 느린 응답은 타임아웃+폴백이 흡수 — "기존과 동일하게 시작해서 점점 정밀해지는" UX.
- 서버는 언어당 최대 1개, 열린 적 있는 언어만 기동.

## 7. 테스트

- **단위**: LspClient 코어를 fake 서버(node 스크립트, stdio JSON-RPC 에코) 상대로 — initialize 핸드셰이크, didChange 디바운스/플러시 순서, 요청/응답 상관, 크래시 재시작 카운터. 좌표·완성 항목 변환은 순수 함수 분리 테스트.
- **통합**: 실제 typescript-language-server + pyright를 fixture 프로젝트로 스폰해 4기능 왕복 각 1회 실증 (번들 서버 실동작 = 핵심 리스크).
- **E2E**: 앱 구동 → .ts 파일 → `.` 타이핑 → 타입 인지 드롭다운 → F12 정의 이동.
- **패키징**: 패키지 앱에서 LSP 기동 확인 (asarUnpack 경로 리스크).
