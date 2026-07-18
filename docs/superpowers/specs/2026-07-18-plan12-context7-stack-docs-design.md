# Plan 12: 프로젝트 스택 감지 + Context7 온디맨드 문서 — 설계 문서

**상위 스펙**: `2026-07-15-sourceinsight-clone-design.md` v2 백로그 — "AI가 프로젝트 스택의 최신 라이브러리 문서를 참고"

## 1. 목표

프로젝트를 열면 **사용 언어·프레임워크(+버전)를 로컬에서 자동 감지**하고, AI 채팅/에이전트가
필요할 때 **Context7에서 해당 라이브러리의 최신 문서를 온디맨드로 가져와** 참고한다.
사용자가 라이브러리나 버전을 일일이 알려줄 필요가 없다.

핵심 원칙:
- **열기는 로컬 파싱만** — 네트워크에 절대 막히지 않음(오프라인 안전)
- **문서는 온디맨드** — 방대한 문서를 프롬프트에 미리 주입하지 않음(토큰 폭발 방지). LLM이 도구로 필요한 것만 fetch
- 기존 인프라 재사용 — 읽기 전용 도구 루프(Plan: 하이브리드 컨텍스트), `AgentToolDeps` 주입 패턴, 설정 API 키 패턴

## 2. Context7 API (실측)

- 베이스: `https://context7.com/api/v2`
- 검색/해석: `GET /libs/search?libraryName={name}&query={q}` → 매치 목록, 각 항목에 `id`
- 문서 조회: `GET /context?libraryId={id}&query={q}&type=json` → 질의 기반 리랭킹된 코드/설명 스니펫
- 인증: `Authorization: Bearer ctx7sk...` (키 없어도 저율 제한으로 동작; 키는 context7.com/dashboard)
- 초과: HTTP 429 + `Retry-After` 헤더

## 3. 아키텍처 / 파일 구조

### 3.1 스택 감지 (main, 로컬)
- **신규** `src/main/stack/detect.ts` — 순수 모듈(electron 임포트 금지, node ABI 테스트).
  - `detectStack(files: {path: string; content: string}[]): ProjectStack`
  - 매니페스트 파서(각각 순수 함수):
    - `package.json` → dependencies + devDependencies (JS/TS)
    - `pyproject.toml`([project.dependencies] / poetry) · `requirements.txt` (Python)
    - `go.mod` (Go)
    - `pom.xml` · `build.gradle`/`build.gradle.kts` (Java)
  - 언어: 확장자 빈도 상위 → 언어명 매핑(기존 인덱서 언어셋 재사용)
  - `ProjectStack = { languages: string[]; libraries: { name: string; version?: string }[] }`
  - 라이브러리 상한 20개(중복 제거, dependencies 우선 정렬)
- **호출 위치**: `main.ts` `openProjectInMain`에서 프로젝트 루트의 매니페스트 파일들을 `fs`로 읽어
  `detectStack` 호출 → 결과를 모듈 변수 `currentStack: ProjectStack | null`에 저장. 실패해도 열기 성공.
- **요약 문자열**: **신규** `src/shared/stack-summary.ts` `buildStackSummary(stack): string`
  (순수, shared — renderer/main 공용). 예: `언어: TypeScript, CSS · 라이브러리: react@18.3.1, vite@5.2.0, zustand@4.5, …`

### 3.2 Context7 클라이언트 (main)
- **신규** `src/main/context7/client.ts` — electron-free(전역 `fetch` 사용), 순수 로직 + 네트워크.
  - `searchLibrary(name, query, apiKey, fetchImpl?): Promise<string | null>` → 최적 매치 `id` (없으면 null)
  - `getDocs(libraryId, query, apiKey, fetchImpl?): Promise<string>` → 스니펫 텍스트(상한 절단)
  - `fetchImpl` 주입 → 테스트에서 fetch 모킹
  - 오류 매핑: 429 → `RateLimitError`, 네트워크/기타 → `Context7Error`(kind 문자열). 값 노출 최소화
- **신규** `src/main/context7/service.ts` — 세션 인메모리 캐시 + 키 조회 결합.
  - `libraryDocs(library, query): Promise<string>`
    - name→id 캐시(Map), (id, query 정규화)→docs 캐시(Map, 세션 한정)
    - 키는 `settingsStore`에서 조회. 미설정이면 키 없이 호출(저율)
    - 실패 시 사용자용 안내 문자열 반환(예: "문서를 가져오지 못했습니다: 오프라인/제한/미해석") — 도구는 항상 문자열 반환, 에이전트 루프 계속

### 3.3 도구 편입 (기존 에이전트 루프 재사용)
- `src/main/agent/tools.ts`:
  - `AGENT_TOOLS`·`READONLY_AGENT_TOOLS`에 `library_docs` 추가
    - 스키마: `{ library: string(필수), query: string(필수) }`
    - description(영문/한글 혼용 기존 톤): "라이브러리의 최신 문서를 Context7에서 가져온다. library=패키지명, query=알고 싶은 주제."
  - `AgentToolDeps`에 `libraryDocs?: (library: string, query: string) => Promise<string>` 추가(현 `searchText` 주입과 동일 패턴)
  - `executeTool`에 `library_docs` 분기 → `deps.libraryDocs`. 미주입/미지원이면 안내 문자열
  - `toolSummary('library_docs', args)` → `library` 표시
  - 읽기 전용이므로 승인 불필요(APPROVAL_REQUIRED 미포함)
- `src/renderer/src/components/ChatPanel.tsx` `TOOL_META`에 `library_docs` → 아이콘(`VscBook`) + 라벨 `"Docs"`

### 3.4 스택 요약 프롬프트 첨부
- `src/shared/protocol.ts` `ChatContext`에 `stack?: string` 추가
- `src/main/chat/prompt.ts` `buildChatSystemPrompt`에 stack 섹션: `if (context?.stack) …` →
  "이 프로젝트의 스택(참고): {stack}" 한 줄. chat·agent 공용이라 양쪽 반영
- **신규 IPC** `stack:get` → `currentStack` 요약 문자열 반환(`buildStackSummary`). preload `getProjectStack(): Promise<string | null>`
- `ChatPanel.send()`: 전송 시 `window.si.getProjectStack()`(세션 캐시, 값싼 호출)로 요약을 받아 `context.stack`에 병합

### 3.5 설정: Context7 API 키
- `src/main/settings.ts`: `context7ApiKey?: string`(평문, 파일 0600). `toPublic()`은 `hasContext7Key: boolean`만 노출(값 미전달)
- IPC: `settings:context7:set-key`(값 저장), 공개 설정에 `hasContext7Key`
- `src/renderer/src/components/SettingsOverlay.tsx`: Context7 키 입력 필드(LLM 키 필드와 동일 UX — 입력 시 저장, 표시엔 설정됨 여부만)

## 4. 데이터 흐름

```
프로젝트 열기 → main: 매니페스트 fs 읽기 → detectStack → currentStack 저장 (네트워크 X)
채팅 전송 → renderer: getProjectStack() → context.stack 첨부 → 프롬프트에 "스택" 한 줄
LLM이 최신 API 필요 판단 → library_docs(library, query) 도구 호출
  → main context7/service: 캐시 확인 → 없으면 searchLibrary→getDocs (키 있으면 Bearer)
  → 스니펫 반환(또는 실패 안내) → 에이전트 루프에 tool result로 전달
```

## 5. 오류 처리
- 열기: 매니페스트 없음/파싱 실패 → 해당 소스만 스킵, 스택 부분 감지. 열기 항상 성공
- Context7: 오프라인/타임아웃/429/미해석 → 도구가 사람이 읽을 안내 문자열 반환(예외를 IPC로 던지지 않음). 앱·에이전트 정상 진행
- 키 미설정: 키 없이 호출(저율). 429면 "키를 설정하면 제한이 완화됩니다" 안내

## 6. 테스트
- `detect.ts`: 각 매니페스트 파서(package.json deps+devDeps, pyproject, requirements, go.mod, pom, gradle), 언어 확장자 집계, 라이브러리 상한/중복 제거
- `stack-summary.ts`: 요약 포맷, 빈 스택
- `context7/client.ts`: fetch 모킹 — search 매치 파싱, docs 파싱, 429→RateLimitError, 네트워크 오류 매핑, 절단
- `context7/service.ts`: 캐시 히트(두 번째 호출 fetch 미발생), 실패 시 안내 문자열
- `agent/tools.ts`: `library_docs`가 READONLY/AGENT 도구셋에 포함, executeTool 분기가 deps.libraryDocs 호출
- `chat/prompt.ts`: stack 섹션 렌더, 없으면 생략

## 7. 범위 밖 (v2 백로그)
- 디스크 캐시(TTL 영속), 스택 변경 감지 후 자동 재감지
- Ruby/Rust/PHP/기타 매니페스트
- 문서 인용 UI(어느 라이브러리 문서를 참고했는지 카드 표시)
- 스택 요약을 사이드바에 시각화

## 8. 보안
- Context7 키: 평문 저장(파일 0600), IPC로 값 미전달(`hasContext7Key`만). LLM 키와 동일 원칙
- 도구는 읽기 전용(네트워크 조회만) — 파일 쓰기/실행 없음, 승인 불필요
- 감지는 프로젝트 매니페스트만 읽음(루트 하위). 외부 경로 접근 없음
