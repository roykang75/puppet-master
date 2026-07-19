# v3 마스터 스펙 — 풀스택 호출 체인 추적 + 구조 인지 에이전트

> 방향 전환 선언. VSCode 패리티 기능 추가는 **동결**하고, 이 문서의 북극성만 판다.
> 근거: 패리티는 솔로로 못 이기는 게임. 유일한 고유 자산은 **다언어 로컬 심볼 DB + 호출 그래프**이며,
> 사용자 스택(React/Next.js ↔ FastAPI/Spring)은 정확히 "언어 경계를 넘는 흐름"이 매일 필요한 구조다.

## 북극성 (성공 기준)

**"화면의 fetch 한 줄에서 백엔드 핸들러와 그 아래 호출 트리까지 3초 안에 도달한다.
에이전트는 '이거 바꾸면 뭐가 깨져?'에 grep이 아닌 그래프로 답한다."**

측정 가능한 형태:
- S1. React/Next 컴포넌트의 `fetch('/api/users/${id}')`에서 점프 1회로 FastAPI/Spring/Next 핸들러 정의에 도달
- S2. 핸들러에서 역방향으로 "이 엔드포인트를 부르는 프론트 호출부 전부" 목록화
- S3. 에이전트가 심볼 수정 요청 시 callers/refs 기반 blast radius를 컨텍스트로 받아 응답에 반영
- S4. 위 전부 오프라인·제로컨피그 (기존 원칙 유지)

## 현재 자산 (실측)

- 인덱서: tree-sitter 6언어, refs = `call | import | extends` (SCHEMA_VERSION 3)
- 쿼리 API: `searchSymbols/getCallers/getCallees/getReferences/resolve` (이름 기반)
- 에이전트 도구 6종: `list_dir/read_file/write_file/search_text/run_command/library_docs` — **구조 조회 없음**
- 채팅 컨텍스트: 선택 or 커서 ±30줄 + 파일 시그니처 ≤20 (`chat-context.ts`) — **텍스트 수준**
- RelationPanel: Call/Callers/References/Class 탭 (언어 내부만)

## 신규 아키텍처

### A. 인덱서 확장 — HTTP 경계 추출 (SCHEMA_VERSION 4)

새 테이블 2개 (버전 불일치 → 전체 재생성, 기존 규약 그대로):

```sql
CREATE TABLE endpoints (         -- 백엔드 라우트 정의
  id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL, symbol_id INTEGER,      -- 핸들러 심볼(있으면)
  method TEXT NOT NULL,          -- GET/POST/PUT/DELETE/PATCH/* (unknown)
  path TEXT NOT NULL,            -- 정규화: /users/{} (파라미터는 빈 중괄호 세그먼트)
  raw_path TEXT NOT NULL,        -- 원문: /users/{id}
  line INTEGER NOT NULL,
  FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
);
CREATE TABLE http_calls (        -- 프론트 호출부
  id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL, enclosing_symbol_id INTEGER,
  method TEXT NOT NULL, path TEXT NOT NULL, raw_path TEXT NOT NULL,
  line INTEGER NOT NULL, col INTEGER NOT NULL,
  FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
);
```

추출은 기존 extractor 파이프라인에 언어별 후처리로 얹는다 (tree-sitter 쿼리 + 리터럴 파싱):

| 소스 | 패턴 (v1) | 정규화 예 |
|---|---|---|
| TS/JS 호출부 | `fetch(<str>)`, `fetch(<str>, {method})`, `axios.get/post/…(<str>)`, `axios(<obj>)` | `` `/u/${id}` `` → `/u/{}` |
| FastAPI | `@app.get("/p")`, `@router.post(...)` — decorated_definition | `/u/{id}` → `/u/{}` |
| Spring | `@GetMapping("/p")`, `@RequestMapping(path=, method=)` + 클래스 레벨 prefix 결합 | `{id}` → `{}` |
| Next.js | 파일 기반: `app/**/route.ts`(export GET/POST…), `pages/api/**` | `[id]` → `{}` |
| Express | `app.get('/p', h)`, `router.use prefix` **v1 제외** (v2) | `:id` → `{}` |

정규화 규칙 (매칭의 핵심, 순수 함수 `normalizeHttpPath`):
- 파라미터 세그먼트(`{x}`/`[x]`/`:x`/`${...}`) → `{}` · 쿼리스트링 제거 · 트레일링 슬래시 제거
- 베이스 URL(`http://…`, `process.env.X`)은 스킴+호스트 제거 후 경로만. 전체가 동적이면 **unresolved로 기록**(추측 금지)

### B. 쿼리 API — 매칭

`src/indexer/api.ts`에 read-only 추가:
- `getEndpoints(db)` / `getHttpCalls(db)`
- `matchCallToEndpoints(db, callId)`: method 일치(unknown은 와일드카드) + 정규화 path 완전일치 → 후보 배열 (복수면 전부 반환, UI/에이전트가 표시)
- `matchEndpointToCalls(db, endpointId)`: 역방향
- `getImpact(db, symbolId, depth≤3)`: 전이적 callers + refs 요약 (파일·심볼·건수) — blast radius

### C. UI — Relation "Flow" 탭

- 커서가 http_call 위 → Flow 탭에 `[프론트 호출부] → [매칭 엔드포인트(들)] → [핸들러 callees 트리(기존 재귀 재사용)]`
- 커서가 핸들러/엔드포인트 위 → 역방향: 이 엔드포인트를 부르는 호출부 목록
- 클릭 = 점프 (기존 jumpTo). 미매칭 호출부는 "unresolved" 뱃지로 노출 (숨기지 않는다 — 신뢰 유지)

### D. 에이전트 — 구조 도구 + 컨텍스트 업그레이드

읽기 전용 도구 4종 추가 (`tools.ts`, 질문 모드 포함):
- `find_symbol(name)` → 정의+시그니처+위치 (resolve 순위 적용)
- `get_call_graph(name, direction: callers|callees, depth≤2)`
- `get_impact(name)` → blast radius 요약 (B의 getImpact)
- `trace_http(path_or_name)` → Flow 체인 (호출부↔엔드포인트↔핸들러)

컨텍스트 빌더(`chat-context.ts`) 업그레이드: 커서 심볼이 있으면 ±30줄에 더해
**callers 상위 5 + callees 상위 5의 시그니처**를 구조 블록으로 첨부 (실패 시 기존 동작 — additive).
시스템 프롬프트에 "구조 도구 우선, grep(search_text)은 최후" 지침 추가.

## Plan 분할

| Plan | 범위 | 검증 게이트 |
|---|---|---|
| **19** | A+B: 추출(TS fetch/axios·FastAPI·Spring·Next 라우트) + 정규화 + 매칭 + getImpact. UI 무변경 | 순수 단위(정규화/추출/매칭) + 실픽스처(미니 Next+FastAPI 레포) 통합. **S1 데이터 레벨 실증** |
| **20** | C: Flow 탭 + 커서 연동 + unresolved 표시 | E2E: fetch 클릭→핸들러 점프, 역방향 목록. **S1·S2 실증** |
| **21** | D: 에이전트 도구 4종 + 컨텍스트 업그레이드 + 프롬프트 | 단위 + fake 서버 통합("X 바꾸면?"에 callers 반영 응답). **S3 실증** |

## 원칙 · 비범위

- 패리티 백로그(사용자 정의 언어 규칙 등) **동결**. jdtls도 동결 (Spring 지원은 인덱서 어노테이션 추출로 충분히 시작).
- 매칭은 **정적 리터럴 + 파라미터 와일드카드**까지만. 동적 URL 조립은 unresolved — 거짓 매칭보다 정직한 공백.
- 인덱서 원칙 변경: "무변경" → "이 스펙의 경계 추출은 코어 진화로 승인". 그 외 additive 원칙 유지.
- graphql/grpc/websocket, OpenAPI 스펙 연동, Express/Nest 데코레이터: v3.1 이후.
