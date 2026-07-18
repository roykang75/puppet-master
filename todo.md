# SourceInSight TODO

> Source Insight 클론 (Electron + React + Monaco / Node 인덱서)
> 스펙: `docs/superpowers/specs/2026-07-15-sourceinsight-clone-design.md`
> 진행 원장: `.superpowers/sdd/progress.md`

---

## ✅ 완료 — Plan 1: 기반 + 인덱서 코어 (2026-07-16 main 병합, `4b27519`)

계획: `docs/superpowers/plans/2026-07-15-plan1-indexer-core.md` · 테스트 39/39 · 최종 리뷰 Ready to merge

- [x] Task 1. 빌드/테스트 툴체인 스캐폴딩 (tsc + vitest, pool: forks)
- [x] Task 2. 네이티브 의존성 — tree-sitter@0.22.4 + 문법 6종(0.23.x) + better-sqlite3@12 (peer 충돌은 package.json `overrides`로 국소 해결)
- [x] Task 3. Electron 스켈레톤 + ABI 재빌드 검증 (스펙 §3.1 마일스톤 — utilityProcess 네이티브 로드 `ok:true` 실증. 블로커: binding.gyp c++17 하드코딩 → `CXXFLAGS=-std=c++20`로 해소)
- [x] Task 4. 이름 조각 분해 유틸 `splitName` (camelCase/snake_case → fragment)
- [x] Task 5. 심볼 DB 스키마 (WAL+mmap, FK cascade, FTS5, 버전 불일치 시 전체 재생성)
- [x] Task 6. 심볼 추출기 — Query API 전용, C/TypeScript, 스코프/enclosing 계산
- [x] Task 7. C++/Python/Java 쿼리 (6개 언어 완성)
- [x] Task 8. 스캐너(.gitignore 존중) + 인덱싱 파이프라인 (SHA1 증분, FTS rowid=fileId 규약)
- [x] Task 9. chokidar 파일 워처 (v4 — 정적 import, 지원 확장자 필터)
- [x] Task 10. 쿼리 API — fragment 검색 / FTS 전문 검색 / 정의·호출자·피호출 조회
- [x] Task 11. 벤치마크 — **redis 37.5만 줄 2.6초, 100만 줄 추정 6.9초 (기준 120초)** → 직렬 유지 확정

---

## 📌 Plan 2 인계 노트 (최종 리뷰 이월 항목)

- [x] **워처 ↔ 스캐너 제외 규칙 정합** (M-A): Plan 2 Task 2에서 공유 ignore 필터로 scanner/watcher 정합 완료
- [~] **해석 모듈에서 스코프 한정**: `resolve` 모듈 도입으로 부분 해소 — 파일 로컬 → import → 전역 우선순위로 후보 정렬(Plan 3 Task 3). 단, 로컬(블록/함수 내부) 스코프 한정은 여전히 이름 기반 근사치이며 정밀 스코프는 미구현 (LSP 교체 여지로 격리).
- [ ] `skipped` 카운트 시맨틱 세분화 (해시동일/IO실패 구분) — UI에서 스킵 사유 표시 시
- [ ] 2MB 초과 파일: 심볼 스킵되나 FTS엔 전체 삽입 — 동작 문서화 또는 정책 통일
- [ ] 중첩 .gitignore 미지원 (루트만) — 대형 저장소에서 필요 시 확장
- [ ] Windows 지원 시: `rebuild:electron`의 인라인 `CXXFLAGS`를 cross-env로 (Plan 4 패키징에서)
- [x] 워처 테스트 타이밍 의존성 — 근본 해소됨 (chokidar ready 경합을 결정적 대기로 제거, `9326251`)

---

## 🔜 앞으로 할 작업 (각 단계 완료 후 상세 계획 작성)

### ✅ Plan 2: UI 셸 (완료 — Task 1~10, E2E 스모크 통과)
- [x] 계획 문서 작성 (`docs/superpowers/plans/`)
- [x] Electron 창 + React + Vite 렌더러 셋업
- [x] 인덱서 utilityProcess 호스팅 + 버전 있는 IPC(RPC) 프로토콜
- [x] SI 스타일 패널 레이아웃 (접기/크기조절/배치 저장 — react-resizable-panels v4)
- [x] Monaco 에디터 + 파일 탭 (dirty/디스크변경 표시, Ctrl/Cmd+S 저장)
- [x] Project Window (파일 트리), Symbol Window (파일별 아웃라인)
- [x] 워처 배선 (공유 ignore 필터로 gitignore 정합 포함)
- [x] Playwright E2E 스모크 (열기→트리→편집→저장→아웃라인 갱신)

### 📌 Plan 3 인계 노트 (Plan 2에서 이월)

- [ ] **ABI 이중성 운영 규칙**: 네이티브 모듈(tree-sitter, better-sqlite3)은 두 ABI를 오간다.
  `npm test`(vitest)는 **node ABI**, Electron 실행/`npm run test:e2e`는 **electron ABI**가 필요하다.
  전환은 `npm run rebuild:node` ↔ `npm run rebuild:electron`. `test:e2e`는 자체적으로
  `build && rebuild:electron && playwright test`를 수행하므로, E2E 실행 후에는 반드시
  `npm run rebuild:node`로 되돌려 커밋/휴지 상태를 node ABI로 유지할 것.
- [ ] **초기 인덱싱 중 인덱서 RPC 큐잉**: 아웃라인(`getFileOutline`)은 `indexDone` 이후에만 요청됨
  (SymbolWindow가 `indexing` 상태를 게이트). 초기 인덱싱 중 심볼 관련 RPC는 결과가 비어있을 수 있음.
- [ ] **비코드 파일 외부 변경 미통지**: 워처는 지원 확장자만 필터하므로, 비코드 파일의 외부 변경은
  탭에 ⚠(disk-changed)로 통지되지 않음. 필요 시 워처 범위 확장.
- [ ] **dirty 탭 닫기 확인 없음**: 편집 중(dirty) 탭을 닫아도 확인 다이얼로그 없이 즉시 폐기됨.
- [ ] **Persistence JSON 비원자적 쓰기**: UI 상태/recent를 JSON에 직접 write — 쓰기 중 크래시 시 손상 가능.
  Plan 3+에서 temp+rename 원자적 쓰기로 강화 고려.
- [ ] **검색/정의점프/Relation·Context**: 인덱서 RPC(fragment 검색, FTS, 정의/호출자/피호출)는 준비 완료.
  Plan 3은 UI 배선만 하면 됨 (RelationPanel/ContextPanel은 이미 플레이스홀더 존재).

### ✅ Plan 3: 분석 기능 (완료 — Task 1~9, E2E 분석 흐름 통과)
- [x] 계획 문서 작성 (`docs/superpowers/plans/`)
- [x] Context Window (커서 심볼 정의 미리보기, ~150ms 디바운스)
- [x] Relation Window (Call/Callers/References/Class 탭, 깊이 3 + 지연 로드)
- [x] 통합 검색 UI (fragment + FTS, 미리보기)
- [x] Browser Mode 내비게이션 (Ctrl+클릭 점프, Backspace 뒤로, 히스토리)
- [x] 자동 참조 하이라이트
- [x] 영구 북마크 (함수/클래스 기준 오프셋, 프로젝트별)
- [x] 심볼 해석 모듈 (스펙 §5 — 스코프/import 우선순위, LSP 교체 가능하게 격리)
- [x] Playwright E2E 분석 흐름 (검색 점프 → 뒤로 → Context → Relation Callers → 북마크)

### 📌 Plan 4 인계 노트 (Plan 3에서 이월)

- [ ] **Smart Rename 후보 구성**: `getReferences`(이름 기반 전체 참조) + `resolve`(정의 후보 정렬) 조합으로
  파일별 변경 후보 목록을 구성 가능 — 남은 작업은 파일별 체크박스 **미리보기 UI**와 확정 시 일괄 치환뿐.
  (참조는 whole-word 이름 매칭이라 동명 심볼 오포함 가능 → 미리보기에서 사용자가 걸러내는 것이 전제.)
- [ ] **시맨틱 토큰**: `getSymbolsForFile` + refs로 파일 단위 토큰(전역/멤버/로컬) 색상 구성 가능 —
  Monaco DocumentSemanticTokensProvider에 배선하면 됨. 로컬 스코프 구분은 resolve의 근사치 한계를 그대로 승계.
- [ ] **Relation 트리 이름 기반 재귀의 동명 혼입**: `getCallers`/`getCallees`가 심볼 이름으로 매칭하므로
  서로 다른 파일의 동명 함수가 한 트리에 섞일 수 있음 (순환 가드는 key=name:path:line로 무한재귀만 방지).
  정밀화하려면 call 엣지를 symbolId 기준으로 좁혀야 함.
- [ ] **FTS 결과에 줄 정보 없음**: 전문 검색(`searchText`)은 파일·스니펫만 반환 → 점프는 모델 로드 후
  Monaco `findMatches` 폴백으로 첫 일치 위치를 찾음(EditorPane.findFirstAndReveal). 정확한 줄 앵커가 필요하면
  인덱서 FTS에 줄 오프셋 저장을 추가해야 함.
- [ ] **ABI 이중성 규칙 재확인**: `npm test`(vitest)=node ABI, Electron/`npm run test:e2e`=electron ABI.
  `test:e2e`는 내부에서 `build && rebuild:electron`을 수행하므로, E2E 후 반드시 `npm run rebuild:node`로
  되돌려 커밋/휴지 상태를 node ABI(전체 스위트 green)로 유지할 것. (Plan 4 패키징에서 `CXXFLAGS` cross-env 이슈와 함께 다룸.)

### ✅ Plan 4: Smart Rename + 마감 (완료 — Task 1~7, E2E rename 흐름 통과)
- [x] Smart Rename (해석 결과 → 파일별 체크박스 미리보기 → 확정 일괄 변경)
  - `getRenameTargets`: 정의+참조는 groups(기본 체크), FTS 단어경계 스캔 잔여는 unconfirmed(기본 해제)
  - RenameOverlay: F2 → 오버레이(select/applying/done phase), dirty 탭 차단, 식별자 검증, 건너뜀 요약
  - 적용: main 프로세스가 파일별 치환+저장+재인덱싱 → 열린 탭은 fileIndexed로 라이브 리로드
- [x] 심볼 DB 기반 시맨틱 토큰 색상 (전역/멤버/로컬 구분 — `semantic-tokens.ts`, outlineVersion 재적용)
- [x] 패키징 (electron-builder) — **macOS 전용, 무서명**
  - `electron-builder.yml`: `mac.target: [dir, dmg, zip]`, `identity: null`(무서명), `npmRebuild: false`
  - 네이티브 모듈은 `asarUnpack`(better-sqlite3, tree-sitter*)으로 asar 밖에 언팩
  - `npm run package` = build → rebuild:electron(electron ABI) → `electron-builder --mac`
  - 미포함(범위 밖): Windows/Linux 타깃, 코드서명/공증, auto-update, CI 릴리스 파이프라인
- [x] Playwright E2E rename 흐름 (F2 → 오버레이 → 적용 → 디스크/버퍼/아웃라인 갱신) — 3 specs 전부 통과

### 📌 Plan 5 인계 노트 (Plan 4에서 이월)

- [ ] **AI 자동완성은 additive 모듈** (마스터 스펙 §7): 인덱서/DB 스키마는 **무변경**이 원칙.
  자동완성은 렌더러(InlineCompletionsProvider) + main(키/네트워크) 신규 모듈로만 얹고,
  기존 인덱싱/쿼리 경로는 건드리지 않는다.
- [ ] **API 키는 main의 safeStorage 전용**: 키는 절대 렌더러/디스크 평문에 두지 않고 main 프로세스의
  `safeStorage`로만 암·복호화. provider **미설정 시 기능 완전 비활성**(고스트 텍스트/네트워크 호출 자체가
  발생하지 않아야 함 — 기본 상태에서 오프라인·무비용 보장).
- [ ] **ContextBuilder용 심볼 시그니처 조회는 기존 api로 충분**: `getRenameTargets`/`getCallers`/`getCallees`/
  정의 미리보기(Context)가 쓰는 심볼·refs 쿼리(`src/indexer/api.ts`)로 프롬프트 컨텍스트 구성 가능 —
  인덱서에 신규 RPC를 추가할 필요 없음(필요 시 read-only 조회만 얇게 추가).
- [ ] **ABI 이중성 / 패키징 운영 규칙 재확인**: `npm test`(vitest)=**node ABI**, Electron·`npm run test:e2e`·
  `npm run package`=**electron ABI**. `test:e2e`/`package`는 내부에서 `rebuild:electron`을 수행하므로,
  실행 후 반드시 `npm run rebuild:node`로 되돌려 커밋/휴지 상태를 node ABI(110/110)로 유지할 것.
  패키징은 macOS 무서명 `dir/dmg/zip`이며, 크로스 플랫폼·서명은 별도 작업.
- [ ] **렌더러 typecheck 게이트 존재**: `npm run build`는 `typecheck:renderer`(src/renderer/tsconfig.json,
  `--noEmit`)를 포함 — 신규 자동완성 컴포넌트도 이 게이트를 통과해야 빌드·E2E가 성립한다.

### ✅ Plan 5: AI 코드 자동완성 (v1.5 마감 — Task 1~5, 검증 green)
- [x] 계획/설계 문서 작성 (`docs/superpowers/plans/2026-07-17-plan5-ai-completion.md`, `docs/superpowers/specs/2026-07-17-plan5-ai-completion-design.md` — 결정 기록 포함)
- [x] 설정: main `safeStorage` API 키 저장 + 설정 오버레이(Cmd/Ctrl+,) — 키는 렌더러/디스크 평문에 두지 않음
- [x] 어댑터: Anthropic(`messages.create`) / OpenAI(`chat.completions.create`, `baseURL`로 로컬 LLM) + 프롬프트·후처리·오류 분류(auth/transient/other)
- [x] 서비스: 컨텍스트 빌드(아웃라인 시그니처 캐시, 인덱서 무변경 read-only 조회) + `completion:request` IPC
- [x] 렌더러: InlineCompletionsProvider 고스트 텍스트(내장 debounce 300ms) + 비활성 정책(세대 토큰/60초 백오프) + 상태바 표기
- [x] 검증: `npm run build` + `npm test` **146/146** green, `npm run test:e2e` 기존 **3 specs 회귀 없음**(provider `none` 기본이라 기존 흐름 무영향), node ABI 복구 후 재검증 green

**알려진 한계 (v1.5, 의도된 편차):**
- **스트리밍 고스트 텍스트 없음**: Monaco `InlineCompletionsProvider`는 항목 배열을 한 번에 반환하는 API라 점진 렌더 경로가 없음 → 짧은 완성 + 300ms 디바운스에선 스트리밍 이득이 사실상 0. 어댑터 인터페이스는 후속 스트리밍 도입 여지를 유지.
- **실 API 자동화 검증 없음**: 실제 provider 호출은 API 키가 필요해 CI/E2E에서 제외. fake 서버 통합 테스트(`completion-openai-integration.test.ts`)와 서비스/어댑터/설정 단위 테스트로 대체. 실 API 왕복은 수동 검증 대상.
- **로컬 LLM 지원**: 별도 어댑터 없이 OpenAI 어댑터의 `baseURL`로 Ollama/LM Studio/llama.cpp 지원(상위 스펙 §7).
- **provider `none`(기본) 완전 비활성**: 미설정 시 고스트 텍스트/네트워크 호출이 발생하지 않아 오프라인·무비용 — 기존 인덱싱/분석 경로에 영향 없음.

## ✅ Plan 6: LSP 보강 (v2 1탄) — 완료 (main 병합 4a093f9)

- [x] 경량 LSP 클라이언트 직접 구현 (vscode-jsonrpc stdio, monaco-languageclient 미사용)
- [x] TypeScript/JS: **TS7 내장 네이티브 LSP** (`@typescript/…/lib/tsc --lsp --stdio`, typescript-go) / Python: pyright — 둘 다 앱 번들 (사용자 설치 불요)
- [x] 기능 4종: 완성 드롭다운(LSP 언어만 자동), 호버, 정의 이동(LSP 우선 1.5초 → 인덱서 폴백), 진단 마커(push+pull 자동선택)
- [x] 수명 관리: 지연 기동, 크래시 3연속 한도(60초 안정 시 리셋), 문서 재전송, 프로젝트 전환 종료
- [x] 패키징: asarUnpack + asar→unpacked spawn 치환 + tsgo lib.d.ts extraResources 복원 — 패키지 앱 LSP 실증 완료
- [x] 테스트: 단위(client/manager/convert/sync) + 실서버 통합 9개 + E2E(완성 드롭다운·정의 이동) — 총 195개

**인계 노트 (백로그, 최종 리뷰 트리아지 완료 — 전부 비차단):**
- 프로젝트 전환 시 didClose가 새 LspManager에 서버를 불필요 스폰 (교차 언어 전환 시 유휴 프로세스 1개; 경량 수정: didClose는 기존 엔트리 조회만)
- initialize 실패(프로세스 생존+핸드셰이크 실패) 시 자동 재시도 없음 — 프로젝트 재열기로 리셋
- F12 물리 키 실동작 미실증 (Playwright 합성 키 한계 — Ctrl/Cmd+클릭 동일 경로는 E2E 실증됨) → **사용자 수동 확인 권장**
- 통합 테스트 파일이 선언 순서 의존 (vitest shuffle 켜면 취약)
- AI 고스트 텍스트 ↔ LSP 드롭다운 공존 정책은 실사용 피드백 후 조정 가능 (스펙 §2)

## ✅ Plan 7: TextMate 문법 + 테마 + 스니펫 (v2 2탄) — 완료 (main 병합 b8534de)

- [x] TextMate 토크나이저: vscode-textmate + oniguruma(WASM은 main ipc 공급 — asar 투명 읽기), 6언어 문법 벤더링(VS Code 1.101.0, MIT), Monaco 공개 API만 사용, 실패 시 monarch 자연 폴백
- [x] 테마: 번들 4종(Dark+/Light+/Monokai/One Dark Pro) + VS Code 테마 JSON 임포트 + 앱 UI CSS 변수 연동 + 시맨틱 토큰 다크/라이트 프리셋 2벌. 설정에서 즉시 전환
- [x] 스니펫: VS Code 포맷(번들 6언어 기본 세트 + userData/snippets 사용자 정의, 사용자 우선), 완성 드롭다운 통합(placeholder Tab 이동), 스니펫 폴더 열기 버튼
- [x] 검증: 단위/실문법 통합(벤치 590ms/3000줄)/E2E 5스펙/패키지 앱 실증 — 총 213개

**인계 노트 (백로그, 최종 리뷰 트리아지 완료 — 전부 비차단):**
- 콜드 스타트 시 테마 적용 전 짧은 기본 테마 플래시 가능 (체감 낮음 — index.html 인라인 배경 등으로 후속 보완)
- `.ref-highlight` 배경 하드코딩 (라이트 테마에서 이질감 — 테마 유도 후속)
- OneDark-Pro 벤더링이 master 참조 (자산은 커밋돼 런타임 무영향 — SHA 고정 후속)
- tsx/jsx는 base 문법 적용 (React 전용 문법은 languageId 분리 필요 — 후속)

### 🔜 다음 단계

## ✅ Plan 8: AI 채팅 (v2 3탄) — 완료 (main 병합 8e85e76)

- [x] 우측 "Relation | AI 채팅" 탭 전환 패널 — 스트리밍 메시지, Enter 전송(IME 가드), 중단/새 대화
- [x] 자동 코드 컨텍스트 주입 + 토글: 선택 영역 우선, 없으면 커서 ±30줄 + 심볼 시그니처 ≤20 (표시줄로 투명하게)
- [x] main 무상태 스트리밍 ChatService — completion 설정(provider/model/키) 재사용, 로컬 LM Studio 즉시 동작. 키/오류 상세는 IPC를 넘지 않음(kind만)
- [x] 취소=부분 응답 유지+(중단됨), 프로젝트 전환 시 스트림 중단+대화 초기화(세션 메모리만)
- [x] 검증: 단위/fake SSE 통합/E2E 6스펙 — 총 232개

**인계 노트 (백로그, 최종 리뷰 트리아지 완료 — 전부 비차단):** RightPanel 탭바 아래 Relation 타이틀 중첩(미관), ChatPanel provider 감지 1회 조회(탭 재진입 시 회복), 통합 테스트 afterAll close 미await, 응답 코드 블록 구문 강조는 후속.

### 🔜 다음 단계

## ✅ Plan 9: 내장 터미널 (v2 4탄) — 완료 (main 병합 82883bd)

- [x] 하단 "Context | Terminal" 탭(`Ctrl+\``로 전환+활성 터미널 포커스) — 전 지점 CSS 숨김(언마운트 금지, xterm 버퍼/TUI 상태 유지)
- [x] 다중 터미널 탭(+/×/전환), 지연 기동, 셸 종료 "(종료됨)" 표시, 프로젝트 전환 시 전부 kill 후 새 cwd 재스폰
- [x] main PTY 소유(node-pty, id 전역 카운터) + 로그인 셸(-l) — 패키지 앱에서도 CLI가 PATH에 잡힘 (`which claude` 실증 완료)
- [x] 테마 연동(xterm 색이 테마 변경에 즉시 반영), node-pty ABI 이중 관리 목록/asarUnpack 추가
- [x] 검증: 단위(fake pty)/실 PTY 통합/E2E 7스펙/패키지 앱 PATH 실증 — 총 242개

**인계 노트 (백로그, 전부 비차단):** Context 탭 타이틀 이중 렌더(중첩 .panel — Plan 8의 Relation 탭과 동일 계열 미관 부채), 종료된 터미널에 입력이 여전히 IPC로 전송됨(main no-op — 무해), 터미널 분할/검색/프로파일은 후속.

## ✅ Plan 10: 에이전트 모드 (v2 5탄) — 완료 (main 병합 18ab398)

- [x] 자체 tool-use 루프(AgentService) — Anthropic tool use + OpenAI 호환 tool calling, 기존 프로파일 그대로 사용 (Agent SDK 기각 — 로컬 모델 지원)
- [x] 도구 5종: list_dir/read_file/write_file/search_text(인덱서 FTS)/run_command — 파일 도구는 루트+allowedDirs만(심링크 하드닝 포함), run_command 쓰기는 sandbox-exec로 프로젝트 이하 강제
- [x] 승인 UX: 자동승인 토글(끄면 쓰기·셸에 [실행]/[건너뛰기]), 읽기 도구는 항상 자동, 25회 한도, 취소, 프로젝트 전환 시 루프 취소
- [x] UI: 채팅 패널 "에이전트" 토글 + 인라인 도구 카드(상태·출력 접기·write_file 클릭 열기), write_file 성공 시 트리 자동 새로고침, 설정에 추가 허용 디렉터리 편집
- [x] 검증: 도구 15 + 어댑터 3 + 서비스 7 + 통합 1 + E2E 1(실제 파일 생성 실증) — 전체 299/299, 스펙: `docs/superpowers/specs/2026-07-18-plan10-agent-mode-design.md`

**인계 노트 (백로그, 최종 리뷰 트리아지 완료 — 전부 비차단):** [P10-2] 절단 캡이 UTF-16 length 기준(바이트 아님, 멀티바이트 경계 mojibake 가능), [P10-3] Anthropic 어댑터 빈 name 필터 비대칭, [P10-4] 연속 tool 결과 병합 다중 케이스 테스트 없음, [P10-5] toolDeps 턴당 1회 조회(전환 시 cancel로 무해화됨), run_command 읽기는 자유라 프롬프트 주입 시 settings.json(평문 키) 읽기 가능(스펙 승인 사항 — 자동승인 끄면 완화).

## ✅ Plan 11: AI 채팅 스레드 영속화 (v2 6탄) — 완료 (main 병합 25449f7)

- [x] 프로젝트별 SQLite 저장 — `userData/chat/<해시>.db`(인덱서 패턴 대칭), main에서 better-sqlite3 동기 직접 연결(ChatStore), 프로젝트 열 때 open/전환 시 close/종료 시 close
- [x] 스키마 threads/messages(도구 배열은 tools JSON 컬럼), CRUD IPC 6종, 저장은 done/전송 시 활성 스레드 디바운스 upsert
- [x] 헤더 3아이콘 UI(＋/히스토리/⋯) — 스레드 목록 드롭다운(전환/×삭제), 제목 더블클릭·메뉴 이름변경, 첫 메시지 자동 제목
- [x] 복원: 프로젝트 열기 시 마지막(updated_at DESC) 스레드 자동 로드 — 도구 카드·diff before/after 칩까지 복원
- [x] 검증: 단위(chat-store 6 + chat-title 3 + chat-persist-title 2 + store)/통합 1/E2E 1(재시작 복원 실증) — 전체 317/317, 스펙: `docs/superpowers/specs/2026-07-18-plan11-chat-threads-design.md`

**인계 노트 (백로그, 최종 리뷰 트리아지 완료 — 전부 비차단):** [P11-1] renameThread가 updated_at 미갱신(이름변경≠새 활동, 방어적), [P11-2] ChatStoredMessage.error 미영속(transient UI 상태 — 의도적), [P11-3] rename Enter+blur 중복(멱등 무해), [P11-5] create/load/rename/delete IPC try/catch 미비(save만 — 드문 DB 실패 시 create throw가 send 거부 가능), [P11-6] 스레드/프로젝트 전환 시 디바운스 타이머 미클리어(sub-300ms 편집 후 즉시 전환 시 마지막 편집 유실 — 크로스 프로젝트 쓰기는 구조적으로 방지됨). Important [I-1] 이름변경 되돌림은 병합 전 해소.

### 다음 후보
사용자 결정 대기 — v2 이후 백로그에서 선택.

### v2 이후 (백로그)
- [ ] 심볼 자동완성(비-AI), Code Beautifier, File/Directory Compare, 리비전 마크, HTML 내보내기, 레이아웃 프리셋, 사용자 정의 언어 규칙, AI 완성 스트리밍, LSP 후속(참조 찾기/rename/시그니처 도움말, Java jdtls)
