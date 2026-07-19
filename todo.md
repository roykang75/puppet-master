# Puppet Master TODO

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

## ✅ Plan 12: 프로젝트 스택 감지 + Context7 온디맨드 문서 (v2 7탄) — 완료 (main 병합 34bf83b)

- [x] 스택 감지(로컬, 열 때만·네트워크X): 매니페스트 파서(package.json·requirements·pyproject+poetry·go.mod·pom·gradle) + 확장자 언어 집계 → `ProjectStack`
- [x] 스택 요약을 chat/agent 시스템 프롬프트에 상주(`ChatContext.stack`, `buildStackSummary` shared)
- [x] `library_docs` 에이전트 도구 — Context7 API v2(`libs/search`→`context`) 온디맨드 조회, 읽기전용/에이전트 도구셋 편입, 세션 캐시, 실패 시 안내 문자열(예외 미전파), "Docs" 배지
- [x] 설정에 Context7 API 키(평문 0600, IPC로 값 미노출·`hasContext7Key`만)
- [x] 검증: 단위(스택 파서/요약/Context7 클라이언트·서비스/도구 편입/프롬프트) — 전체 356/356, 스펙: `docs/superpowers/specs/2026-07-18-plan12-context7-stack-docs-design.md`

**인계 노트 (백로그, 최종 리뷰 트리아지 완료 — 전부 비차단):** [P12-1] parseGoMod 정규식 취약, [P12-2] base() Windows '\' 미처리, [P12-3] parsePomXml이 dependencyManagement도 매치(휴리스틱), [P12-4] parseGradle 테스트 커버리지 없음, [P12-5] **실제 Context7 응답 스키마(results/snippets 키) 통합 시 확인 필요**(방어적 파서라 실패해도 안전), 언어 통계는 루트 표본만(MVP — 인덱서 연동 정밀화 여지), 디스크 캐시·Ruby/Rust/PHP 매니페스트는 v2.

## ✅ Plan 13: TS LSP를 정식 tsserver로 교체 (v2 8탄) — 완료 (main 병합 17b03a8)

- [x] **원인**: 에디터 TS LSP가 tsgo(typescript@7 네이티브 프리뷰)라 `import "./globals.css"` 등 자산 import를 잘못 진단(VS Code/Antigravity는 정상). tsgo엔 `lib/tsserver.js`가 없음
- [x] `typescript-language-server@5.3` + 클래식 `typescript-classic`(npm:typescript@5.9) 별칭 추가 — tsgo(빌드/타입체크)는 무변경 유지
- [x] `servers.ts`: TS를 pyright처럼 Electron-as-node로 스폰(cli.mjs --stdio, `ELECTRON_RUN_AS_NODE`), `initializationOptions.tsserver.path`로 클래식 tsserver 지정
- [x] `LspClient.initialize`에 initializationOptions 배선(client/manager), 패키징 asarUnpack + tsserver `lib/*.d.ts` extraResources 복원(최종 리뷰 C1)
- [x] 내장 Monaco TS/JS 워커 진단 off 유지(`monaco-setup.ts`) — 진단은 정식 tsserver 담당
- [x] 검증: 단위 356/356 + **dev 실측 PASS**(`import "./globals.css"`=에러0, 타입오류=에러1 → tsserver Electron-as-node 기동 + 진짜오류 유지). 스펙: `docs/superpowers/specs/2026-07-18-plan13-classic-tsserver-lsp-design.md`

**인계 노트 (백로그, 비차단):** [P13-1] **실제 `npm run package` 스모크 빌드로 C1(.d.ts 복원)과 unpacked ESM 경로 최종 확인**(플랜 범위 밖 — 배포 전 권장). [M2] tsgoExePath()는 이제 빌드 툴체인 가드로 테스트만 참조(의도적, 삭제 금지).

## ✅ 세션 UI/UX 개선 (main 직접 커밋)

- [x] 앱 이름 변경 **SourceInSight → Puppet Master**(식별자 `puppetmaster`, appId `dev.roy.puppetmaster`) + userData 마이그레이션(`f184bf3`)
- [x] 창 테두리색 `#2B2B2B` + 사이드바 Symbols·Bookmarks 개별 접기/펴기(min=max=24px 잠금으로 독립 동작) (`bffc628`)
- [x] AI 채팅 하이브리드 자동 컨텍스트(활성파일 + 인덱서 검색 시드) + 질문 모드=읽기전용 에이전트, 컨텍스트 체크박스 제거·상시 실행, 에이전트/질문 모드 선택 UI + 자동승인 배치 (`c572a92`)
- [x] 도구 카드 아이콘+영문 라벨(`2839b26`) → 배지(pill) 스타일(`f7dd22f`)
- [x] 에디터 가짜 오류(빨간 줄) 제거 — 내장 TS/JS 워커 진단 off(`64d25ad`), 이후 Plan 13으로 근본 교체
- [x] AI 설정: 모델 추가/편집을 팝업 모달로, 목록은 컴팩트 행(설정 창이 길어지지 않게) (`aa8d0c9`)

## ✅ Plan 18: 부채 정리 + 채팅 FTS (main 직접 커밋)

- [x] **[P12-5] Context7 실 스키마 파서 수정** (`fd56abb`): 실제 `/context` 응답이 `codeSnippets[].codeList[].code`
  구조라 기존 `snippets[].code` 파서는 항상 빈 결과→raw JSON 덤프였음. 실 스키마 우선 파싱(codeDescription/codeList)
  + 구버전 폴백 유지, 빈 결과는 JSON 미덤프. context7-client 11/11.
- [x] **채팅 스레드 FTS 검색** (`fd56abb`): ChatStore에 messages 외부콘텐츠 FTS5 + insert/delete 트리거 동기화
  + 열 때 rebuild(기존 DB 정합). `searchMessages`는 토큰 인용으로 특수문자 안전, 스레드당 1건 bm25 순.
  chat:threads:search IPC/preload/protocol 배선, 히스토리 드롭다운에 검색 입력+스니펫 결과 UI. chat-store 11/11(FTS 6).
- [x] **[P13-1] 패키지 스모크 빌드로 실제 버그 발견·수정** (`68c905e`): `npm run package` 정적 검사 결과
  typescript-classic·typescript-language-server가 **devDependencies라 electron-builder 번들에서 통째로 제외** →
  배포 앱에서 tsserver.js·cli.mjs 부재로 **TS LSP 완전 불능**(extraResources의 .d.ts만 남아 복원된 듯 착시).
  두 모듈을 dependencies로 이동 → asarUnpack 정상 언팩 실증(cli.mjs·tsserver.js + .d.ts 102), servers.ts
  require.resolve→unpacked 경로 일치 확인.
- 검증: 전체 **364/364** green, dev 빌드 클린, node ABI 복구.

**남은 확인(비차단):** 패키지 `.app`을 실제 실행해 TS LSP를 구동하는 최종 수동 확인(정적 검사는 통과 — spawn 대상 전부 실재).

## ✅ Plan 14: LSP 후속 3종 (v2 9탄) — 완료 (main 직접 커밋)

- [x] **참조 찾기(Shift+F12)**: manager `references` kind(includeDeclaration) + Monaco `registerReferenceProvider`.
  기존 RelationPanel References 탭(인덱서 이름매칭)과 별개·공존. `toLocations` 재사용.
  *한계*: Monaco 네이티브 피크는 열려있지 않은 파일 본문 미리보기를 모델 부재로 못 채울 수 있음(위치·이동은 정상).
- [x] **시그니처 도움말**: manager `signatureHelp` kind + `toSignatureHelp`/`LspSignatureHelpN` + Monaco
  `registerSignatureHelpProvider`(트리거 `(` `,`).
- [x] **LSP Rename(F2)**: LSP 언어(TS/JS/Py)는 references(정밀 위치)→기존 `RenameTargets` 형태(전부 체크,
  unconfirmed=[])로 주입 → 기존 RenameOverlay 미리보기+applyRename 파이프라인 그대로 재사용. 비면 인덱서
  `getRenameTargets` 폴백, 그 외 언어는 인덱서 Smart Rename. (`lsp-rename.ts` locationsToRenameTargets, Monaco 비의존)
- [x] IPC 허용목록 확장만(`LSP_CALL_ALLOWED`에 references/signatureHelp), 인덱서/DB 무변경.
- [x] 검증: 단위(convert/manager/rename) + **실서버 통합**(classic tsserver 실왕복 references=선언+사용 across files,
  signatureHelp=name 파라미터 실증) — 전체 **373/373**, 빌드 클린, node ABI 유지.
  스펙: `docs/superpowers/specs/2026-07-19-plan14-lsp-references-rename-signature-design.md`

**인계 노트(백로그, 비차단):** 참조 피크의 미열림 파일 미리보기 한계(위 한계), LSP rename은 식별자 단순치환 가정
(비식별자 rename 엣지 미포함 — references 위치 기반, 폴백 안전), Monaco 피크/시그니처 팝업의 GUI 물리동작은
실서버 왕복까진 실증됨·에디터 UI 구동은 사용자 수동 확인 권장(Plan 6 F12 계열과 동일).

## ✅ Plan 15: 심볼 자동완성(비-AI) (v2 10탄) — 완료 (main 직접 커밋)

- [x] **비-LSP 인덱싱 언어(c/cpp/java)** — LSP가 없어 자동완성 전무였던 언어에 인덱서 심볼 DB 기반 완성 제공.
  `symbol-completion.ts`: Monaco `registerCompletionItemProvider(['c','cpp','java'])` → `searchSymbols`(fragment-prefix)
  → 이름 dedup + kind 매핑. LSP 언어(ts/js/py)는 기존 LSP 완성이 담당(제외).
- [x] EditorPane에서 registerLspFeatures 옆 1회 배선. 인덱서/DB 무변경(기존 read-only RPC 재사용).
- [x] 검증: 단위(dedup/kind매핑/언어목록) 5건, 전체 **378/378**, 빌드 클린. Monaco basic-languages id(c/cpp/java) 일치 확인.
- **분리**: Code Beautifier는 포매터 의존성(prettier vs LSP formatting, pyright 미지원) 결정이 별도라 후속 Plan으로 뺌.

**인계 노트(비차단):** searchSymbols는 전 언어 전역 검색이라 C 파일에서 Java 심볼도 제안될 수 있음(SI식 전역 완성 — 의도적,
필요 시 path 확장자 필터로 언어 한정 가능). 에디터 드롭다운 GUI 물리동작은 수동 확인 권장.

## ✅ Plan 16: File Compare (v2 11탄) — 완료 (main 직접 커밋)

- [x] **트리 우클릭 컨텍스트 메뉴** "비교 대상으로 선택" → 다른 파일 우클릭 "'<base>'와(과) 비교" → diff 탭.
  기존 DiffView/openDiffTab 재사용. store에 `compareBase` + `Tab.diff.label`(탭 제목 대체), `compare.ts`
  순수 헬퍼(buildCompareDiff), FileTabs 제목 label 우선.
- [x] DiffView 모델 URI를 `Uri.parse`→`Uri.from`으로 — 파일 비교의 "A ↔ B"(공백·비ASCII) 경로도 안전.
- [x] **Directory Compare는 후속 분리** (main 재귀 워크 + 결과 패널이 별도 서브시스템).
- [x] 검증: 단위(compare 2) + **E2E 신규 compare.spec 실증**(우클릭→선택→비교→diff 탭 렌더). 전체 380/380.
  DiffView 변경 회귀 없음(rename/agent E2E PASS).
- [x] **부수 수정**: 스테일 E2E `agent.spec` 셀렉터(`.chat-context-toggle` 체크박스→`.chat-mode` select)를
  현재 UI에 맞게 정정 — 세션 이전 UI/UX 개선(c572a92, 토글→드롭다운) 때 누락됐던 테스트 rot.

## ✅ Plan 17: 리비전 마크 (git gutter) (v2 12탄) — 완료 (main 직접 커밋)

- [x] **git HEAD 대비 변경 라인을 에디터 gutter 바로 표시**(추가=녹색/수정=파랑/삭제=빨강). `git-diff.ts`:
  `parseGitDiff`(순수, -U0 헌크→범위) + `getFileChanges`(execFile, 비-git/오류 조용히 []). IPC `git:fileDiff`.
- [x] EditorPane gutter 데코레이션(`linesDecorationsClassName`), 파일 전환/저장·재인덱싱(outlineVersion) 신호로 재계산
  — semantic-tokens effect와 동일 패턴(모델 준비 재시도 포함).
- [x] 검증: 단위(parseGitDiff 4) + **실제 git 통합**(temp repo 커밋→수정/추가/삭제 감지, 비-git → []) 4
  + **E2E revision-marks.spec**(실제 앱 gutter에 .rev-mark-modify/.rev-mark-add 실증). 전체 **388/388**,
  smoke/analysis E2E 무회귀, node ABI 복구.
- **분리**: HTML 내보내기·레이아웃 프리셋은 별건 후속.

**인계 노트(비차단):** 마크는 **디스크 기준**(HEAD vs 워킹트리 파일) — 저장 전 미저장 편집은 미반영(저장 후 갱신).
미추적(untracked) 파일은 마크 없음(git diff 대상 아님). 삭제는 앵커 라인 빨강 바로 단순 표시(삼각형 아님).

## ✅ HTML 내보내기 (v2 13탄) — 완료 (main 직접 커밋)

- [x] **활성 파일을 하이라이트된 자기완결 HTML로 내보내기** (File 메뉴 "HTML로 내보내기…", Cmd/Ctrl+Shift+E).
  Monaco `colorize`(.mtkN 스팬) + 라이브 스타일시트의 `.mtk` 색 규칙 수집(`.monaco-editor ` 프리픽스 제거)
  + 테마 `--bg`/`--fg` 인라인 → 단일 HTML 문서. `html-doc.ts`(순수 조립) + `html-export.ts`(colorize/수집/저장).
- [x] main `file:exportHtml`(save dialog + write, 사용자가 고른 경로라 루트 제한 밖 허용), preload, MenuAction, App 핸들러.
- [x] 검증: 단위(buildHtmlDocument 3 — 구조/이스케이프/색 폴백), 전체 **391/391**, 빌드 클린.

**인계 노트(비차단):** colorize 출력 + 네이티브 저장 다이얼로그는 Playwright 블록으로 E2E 비현실적 → 실 저장 산출물은
수동 확인 대상. 선택 영역만 내보내기·인쇄용 라인번호는 후속.

## ✅ Directory Compare (v2 14탄) — 완료 (main e72ad6a)
- [x] 트리 폴더 우클릭 "비교 대상 폴더로 선택"→"폴더 비교" 재귀 비교. main dir-compare.ts(.git/node_modules 스킵,
  바이트 비교, 동일 제외), dircmp:// 탭 + DirCompareView(다름→파일 diff, 한쪽만→열기). File Compare 인프라 재사용.
- [x] 검증: 단위 3 + **E2E dir-compare.spec 실증**(폴더 비교→결과 목록→파일 diff). 전체 그린.

## ✅ 레이아웃 프리셋 (v2 15탄) — 완료 (main 6132ba5)
- [x] react-resizable-panels v4 임퍼러티브 API(groupRef getLayout/setLayout)로 3그룹 레이아웃 캡처·적용
  (리마운트 없이 에디터 보존). 전역 파일(layout-presets.json) + IPC, StatusBar 프리셋 드롭다운(저장/적용/삭제).
- [x] 검증: 단위(Persistence 라운드트립 3). 라이브 적용은 문서화된 임퍼러티브 API — 수동 확인.

## ✅ Code Beautifier (v2 16탄) — 완료 (main 8611e98)
- [x] LSP 문서 포매팅(Plan 14 인프라 재사용): manager.format + toTextEdits + IPC + Monaco
  registerDocumentFormattingEditProvider → 네이티브 "Format Document"(Shift+Alt+F). tsserver=TS/JS, pyright 미지원→무변경.
- [x] 검증: 단위(toTextEdits 2) + **실서버 통합**(tsserver가 messy.ts에 정렬 편집 반환 실증). 전체 400/400.

## 🧭 v3 방향 전환 — 풀스택 호출 체인 추적 + 구조 인지 에이전트

**패리티 기능 추가 동결.** VSCode 재조립으로는 "더 좋다"에 도달 불가 판정 — 유일한 고유 자산
(다언어 심볼 DB + 호출 그래프)을 사용자 스택(React/Next ↔ FastAPI/Spring)의 언어 경계에 집중.
북극성: **"fetch 한 줄에서 백엔드 핸들러+호출 트리까지 3초, 에이전트는 grep이 아닌 그래프로 답한다."**
스펙: `docs/superpowers/specs/2026-07-19-v3-fullstack-flow-design.md`

- [x] **Plan 19** (`4c7f2a2`): 인덱서 HTTP 경계 추출(fetch/axios·FastAPI/Flask·Spring prefix·Next 라우트) + 정규화
  + 양방향 매칭 + getImpact (SCHEMA_VERSION 4). **S1·S2 데이터 레벨 실증**(fetch 템플릿→FastAPI read_user,
  axios→Spring getOrder, unresolved 정직 기록). 추출 13+통합 9, 전체 422/422. 기존 쿼리 무변경(별도 트리 워크).
- [x] **Plan 20** (`b73db0f`): Relation "Flow" 탭 — 파일 기반 단일 왕복(getFlowForFile), 호출부→매칭 핸들러
  점프·엔드포인트→역방향 호출부, unresolved 뱃지. **E2E flow.spec으로 북극성 S1·S2 화면 실증**
  (fetch→read_user 클릭→main.py 점프→역방향 loadUser). 전체 424/424.
- [x] **Plan 21** (`6ae8baa`): 에이전트 구조 도구 4종(find_symbol/get_call_graph/get_impact/trace_http, 질문 모드
  포함) + 프롬프트 "구조 도구 우선·grep 최후" + 커서 심볼 callers/callees 구조 블록(ChatContext.structure).
  **S3 실증**(fake 서버: "target 바꾸면?"→get_impact→callers가 응답에 반영). 전체 439/439.

**v3 1차 완료 — 북극성 3게이트(S1·S2·S3) 전부 실증.** 남은 확인(비차단): dev 실사용 체감(F12/Flow/에이전트
질문), 대형 레포에서 추출 성능 계측, [v3.1 후보] Express/Nest·httpx/requests 백엔드 호출부·OpenAPI 연동.

## ✅ 전체 검색 강화 (발견성 + 줄 단위 텍스트 검색) — 완료
- [x] 인덱서 `searchTextDetailed`(스키마 무변경, read-only): FTS로 파일 프리필터(≤50) → 줄 단위 대소문자 무시
  스캔으로 정확 위치(0-기반 line/col) 수집. 파일당 20·전체 200 캡, lineText 트림·200자 절단. host RPC + 허용목록 + preload 추가.
- [x] SearchOverlay: 텍스트 결과를 파일별 그룹 헤더(path+건수) + 줄 항목(줄번호·질의 하이라이트)으로 교체,
  클릭/Enter가 `jumpTo(path, line+1, col+1)`로 정확 점프. FTS 폴백(findFirstAndReveal) 제거.
- [x] 발견성: File 메뉴 "Find in Files…"(CmdOrCtrl+Shift+F, registerAccelerator:false로 이중발화 방지) +
  Project 패널 돋보기 버튼(VscSearch).
- [x] 검증: 단위 7종(위치·다중매치·대소문자·캡·특수문자·limit·빈질의) 전체 449/449, `npm run build` EXIT=0,
  기존 E2E analysis.spec 그대로 통과(심볼 경로 무변경).
- [x] **선택 텍스트 프리필**(VS Code 동일 UX): 에디터 선택 후 전체 검색을 열면 선택 내용이 검색어로 자동 입력.
  순수 헬퍼 `normalizeSearchSeed`(첫 줄·트림·200자 캡·무의미시 null) + `getSelectedText`(EditorPane) +
  스토어 `searchSeed`(소비 즉시 클리어) + 열기 3지점 배선(Cmd/Ctrl+Shift+F 열림시만·메뉴·돋보기 버튼) +
  SearchOverlay 프리필+전체선택. 단위 8종 457/457, E2E `search-seed.spec`(더블클릭→돋보기→프리필+결과), build EXIT=0.

- [x] **검색 결과 미리보기 + 더블클릭 이동**: 단일 클릭/↑↓ 선택 → 오버레이 하단 `.search-preview` 패널에
  대상 위치 ±7줄 표시(이동 없음), 더블클릭/Enter → jumpTo + 닫힘. 순수 헬퍼 `buildPreviewSlice`(경계 클램프) +
  열린 버퍼(getContent) 우선·디스크(readFile) 폴백·마지막 path 캐시. 단위 7종 464/464,
  E2E `search-preview.spec`(클릭=미리보기·더블클릭=이동), analysis.spec 클릭→더블클릭 갱신, build EXIT=0.

- [x] **AI diff 줄 주석 → 채팅 피드백**(Orca "Annotate AI Diffs" 차용): 에이전트가 제안/적용한 diff 탭
  (origin==='agent')에서만 하단 주석 바 표시 — modified 커서 줄 추적, 코멘트 추가/삭제(같은 줄 교체),
  `채팅으로 피드백 보내기` → 정렬·80자 절단된 피드백을 `chatDraft`로 프리필 후 chat 탭 전환·textarea 포커스.
  순수 헬퍼 `composeDiffFeedback`(diff-feedback.ts) + store `origin`/`chatDraft`. 파일 비교 diff는 현행 유지.
  단위 12종(피드백 합성 4·store 2 신규 포함) 471/471, E2E `diff-annotate.spec`(칩→diff→주석→프리필), build EXIT=0.

- [x] **에이전트 격리 모드(worktree 샌드박스)**(Orca "Parallel Worktrees" 차용 2탄 — 단일 에이전트 v1):
  옵트인 격리 on 시 에이전트가 프로젝트 밖 git worktree(`userData/agent-worktrees/<projectHash>/agent-wt`)에서
  작업 → 턴 종료 후 사용자가 리뷰(diff)하고 [적용]/[폐기]. 원본 오염 없음.
  - main `agent/worktree.ts`(electron-free·테스트가능): `isGitRepo`/`ensureWorktree`(재사용+dirty 동기화
    M/A/??/D, 캡 파일 500·2MB/파일 스킵)/`worktreeChanges`(porcelain -z)/`applyWorktree`(wt→원본 복사·삭제 후
    폐기)/`discardWorktree`(worktree remove+prune).
  - `AgentService`에 `isolation` deps 주입 — 턴 시작 시 `projectRoot`를 wt로 교체(파일 도구·sandbox-exec 쓰기
    루트가 자동 격리), searchText/indexerQuery는 원본 인덱스(read-only) 유지. 비-git인데 격리 on이면 명시적
    오류 안내 후 중단(직접 모드 묵시 폴백 금지). 턴 종료 시 `worktree` 이벤트로 변경 목록 방출.
  - settings `agent.isolate`(부분 갱신, allowedDirs와 독립) + IPC(`agent:isolationAvailable`/`worktreeRead`/
    `worktreeApply`(적용 후 재인덱싱→열린 탭 라이브 리로드)/`worktreeDiscard`). ChatPanel: 에이전트 컨트롤에
    "격리(worktree)" 토글(비-git이면 disabled), 입력창 위 적용 바(파일 칩 클릭 → 기존 diff 주석 뷰 재사용).
  - 검증: 단위/통합 `agent-worktree.test`(dirty 동기화·changes·apply·discard·비-git throw·재사용·resolveToolPath
    격리) + `agent-service` 격리 3종(deps.projectRoot 교체·비-git 중단·미사용 회귀), 483/483.
    E2E `agent-isolation.spec`(격리 on→wt 생성·원본 없음→적용 바→[적용]→원본 반영+트리) + 기존 agent.spec 회귀,
    build EXIT=0.
  - **v1 스코프 아웃**(의도적): 병렬 worktree 다중, 브랜치/커밋 생성, 3-way 병합(적용=파일 복사·마지막 승리 —
    diff 리뷰가 안전장치), 인덱서의 wt 신규 파일 인식.

- [x] **에이전트 신뢰 프리셋(Agent Trust Presets)**(Orca "Agent Trust Presets" 차용 3탄 v1 — 1·2·3탄 완결):
  기존 자동승인 이분법(ON=전부 자동 / OFF=쓰기·셸 매번 승인)을 4단계 프리셋으로 교체. 핵심 공백이던
  "쓰기는 자동, **셸만 승인**" 중간 단계를 채움.
  - `shared/protocol.ts` `AgentTrustPreset`(explore/careful/edits/full) + 순수 모듈 `main/agent/trust.ts`
    (electron-free): `toolsForPreset`(explore→읽기전용 도구셋, 그 외→전체) + `needsApproval`(careful→쓰기·셸,
    edits→셸만, full/explore→없음, 읽기 도구는 항상 false) — 승인 정책 단일 진실(기존 APPROVAL_REQUIRED 상수 제거).
  - `AgentService.send` 시그니처 `autoApprove:boolean`→`preset:AgentTrustPreset`, 도구셋은 에이전트 모드에서
    `toolsForPreset(preset)`(질문 모드 readOnly는 프리셋 무관·기존 READONLY 경로 유지), 승인 분기는 `needsApproval`.
    main IPC는 허용 4종 외 값을 'careful'로 강등(안전 기본).
  - 영속화: settings `agent.trustPreset`(부분 갱신, allowedDirs/isolate와 독립, 기본 'full'=이전 autoApprove:true
    동작 보존). store `autoApprove`→`trustPreset`. ChatPanel: 자동승인 체크박스→`<select className="chat-trust">`
    (탐색만/신중/편집 자동/전체 자동), 변경 시 store+settings 저장, 로드 시 settings에서 초기화.
  - **스코프 아웃**(의도적): 명령 패턴별 허용목록(npm test 자동/rm 승인), 프리셋별 allowedDirs, 격리와의 자동
    연동(프리셋 자동 변경 금지 — 놀람 방지).
  - 검증: 단위 `agent-trust.test`(4프리셋×도구 판정 매트릭스+toolsForPreset) + `agent-service` 프리셋 분기 4종
    (edits write 자동·run_command awaiting / careful 양쪽 awaiting / full 양쪽 자동 / explore 도구셋 쓰기·셸 부재) +
    settings trustPreset merge/영속/기본값, 501/501. E2E `agent.spec`/`agent-isolation.spec`(체크박스→select 회귀,
    기본 'full'로 흐름 동일) + `diff-annotate.spec` 회귀, build EXIT=0.

### 동결된 백로그 (v3 이후 재평가)
- AI 완성 스트리밍(won't-do — Monaco API 제약), Java jdtls(별도 프로젝트), 사용자 정의 언어 규칙(스펙 선행 필요)
