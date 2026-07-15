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

- [ ] **워처 ↔ 스캐너 제외 규칙 정합**: `watcher.ts`는 .gitignore를 안 보므로, Plan 2에서 워처→인덱서 배선 시 gitignore 필터를 공유할 것 (M-A)
- [ ] **해석 모듈에서 스코프 한정**: `getCallees`/`getDefinitions`는 전역 이름 매칭(스펙 §5 A안 의도) — Plan 2+ 해석 모듈이 로컬→파일→import→전역 우선순위 필터 담당
- [ ] `skipped` 카운트 시맨틱 세분화 (해시동일/IO실패 구분) — UI에서 스킵 사유 표시 시
- [ ] 2MB 초과 파일: 심볼 스킵되나 FTS엔 전체 삽입 — 동작 문서화 또는 정책 통일
- [ ] 중첩 .gitignore 미지원 (루트만) — 대형 저장소에서 필요 시 확장
- [ ] Windows 지원 시: `rebuild:electron`의 인라인 `CXXFLAGS`를 cross-env로 (Plan 4 패키징에서)
- [ ] 워처 테스트 타이밍 의존성 — 느린 CI에서 flaky 관측 시 한도 재조정

---

## 🔜 앞으로 할 작업 (각 단계 완료 후 상세 계획 작성)

### Plan 2: UI 셸
- [ ] 계획 문서 작성 (`docs/superpowers/plans/`)
- [ ] Electron 창 + React + Vite 렌더러 셋업
- [ ] 인덱서 utilityProcess 호스팅 + 버전 있는 IPC(RPC) 프로토콜
- [ ] SI 스타일 패널 레이아웃 (접기/크기조절/배치 저장)
- [ ] Monaco 에디터 + 파일 탭
- [ ] Project Window (파일 트리), Symbol Window (파일별 아웃라인)
- [ ] 워처 배선 (인계 노트의 gitignore 정합 포함)

### Plan 3: 분석 기능
- [ ] Context Window (커서 심볼 정의 미리보기, ~150ms 디바운스)
- [ ] Relation Window (Call/Callers/References/Class 탭, 깊이 3 + 지연 로드)
- [ ] 통합 검색 UI (fragment + FTS, 미리보기)
- [ ] Browser Mode 내비게이션 (Ctrl+클릭 점프, Backspace 뒤로, 히스토리)
- [ ] 자동 참조 하이라이트
- [ ] 영구 북마크 (함수/클래스 기준 오프셋, 프로젝트별)
- [ ] 심볼 해석 모듈 (스펙 §5 — 스코프/import 우선순위, LSP 교체 가능하게 격리)

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
