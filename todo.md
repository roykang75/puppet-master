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
  되돌려 커밋/휴지 상태를 node ABI(88/88)로 유지할 것. (Plan 4 패키징에서 `CXXFLAGS` cross-env 이슈와 함께 다룸.)

### Plan 4: Smart Rename + 마감
- [ ] Smart Rename (해석 결과 → 파일별 체크박스 미리보기 → 확정 일괄 변경)
- [ ] 심볼 DB 기반 시맨틱 토큰 색상 (전역/멤버/로컬 구분)
- [ ] 패키징 (electron-builder 등, 네이티브 모듈 포함 검증, cross-env)

### Plan 5 (v1.5): AI 코드 자동완성
- [ ] Monaco InlineCompletionsProvider (고스트 텍스트, 300ms 디바운스/취소)
- [ ] CompletionService + ProviderAdapter 2종 (Anthropic SDK / OpenAI 호환 — 로컬 LLM은 baseURL로)
- [ ] ContextBuilder — 심볼 DB에서 관련 시그니처를 프롬프트에 포함
- [ ] API 키 safeStorage 암호화 저장, provider 미설정 시 기능 비활성

### v2 이후 (백로그)
- [ ] LSP 보강(정밀 모드), 심볼 자동완성(비-AI), 스니펫/Clip Window, Code Beautifier, File/Directory Compare, 리비전 마크, HTML 내보내기, 레이아웃 프리셋, 사용자 정의 언어 규칙, AI 채팅
