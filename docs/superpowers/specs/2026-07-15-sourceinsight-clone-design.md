# SourceInSight (가칭) — 설계 문서

**작성일**: 2026-07-15
**상태**: 사용자 검토 대기
**근거 문서**: `Source_Insight_Report.md` (Source Insight 분석 보고서)

## 1. 개요와 목표

Source Insight 방식의 **대규모 코드베이스 분석·탐색용 독립 데스크톱 에디터**를 만든다.
핵심 가치는 원본과 동일하다: **컴파일 환경 없이, 오류가 있는 코드에서도, 수백만 줄 규모에서 실시간으로** 코드의 구조와 심볼 관계를 보여주는 것.

- **지원 언어**: C, C++, Python, TypeScript/TSX(JavaScript 포함), Java — tree-sitter 문법 6개.
  React/Node/FastAPI/Spring Boot는 각 언어의 라이브러리이므로 언어 수준 분석으로 커버한다.
  (프레임워크 인지 기능 — 예: Spring 라우트 맵 — 은 범위 외)
- **목표 규모**: ~100만 줄. 초기 인덱싱 2분 이내(목표 수십 초), 증분 갱신은 파일 단위 밀리초 수준.
- **MVP 무게중심**: 분석 기능 + 기본 편집 (편집기 고급 기능은 Monaco 기본 제공 수준으로 시작).
- **UX**: Source Insight 방식을 따른다 (사용자가 가장 편했던 UX).

## 2. 범위

### MVP (v1)

분석 기능 4종:
1. **Context Window** — 커서 심볼의 정의 자동 미리보기
2. **Relation Window** — 호출 트리 / 피호출(Callers) 트리 / 참조 / 클래스 계층
3. **프로젝트 전체 검색** — Name Fragment 심볼 검색 + FTS5 전문 검색 통합
4. **Smart Rename** — 미리보기 리스트 + 사용자 확인 방식

SI 스타일 UX 핵심:
- Symbol Window (파일별 심볼 아웃라인), Project Window (파일 트리), 파일 탭
- 자동 참조 하이라이트 (클릭 시 스코프 내 참조 강조)
- Browser Mode 내비게이션 (Ctrl+클릭/더블클릭 → 정의 점프, Backspace → 뒤로)
- 영구 북마크 (함수/클래스 기준 오프셋 저장, 프로젝트별)
- Monaco 내장: 미니맵(Overview Scroller 대응), 코드 폴딩, 검색/치환
- 심볼 DB 기반 시맨틱 토큰 색상 (전역변수/멤버/로컬 구분 — Syntax Formatting 대응)

### v1.5 (MVP 직후 첫 업데이트)

- **AI 코드 자동완성** — 로컬 LLM / OpenAI / Anthropic API 지원 (§7)

### v2 이후

LSP 보강(정밀 모드), 심볼 자동완성(비-AI, 심볼 DB 기반), 스니펫/Clip Window,
Code Beautifier, File/Directory Compare, 리비전 마크, HTML 내보내기,
다중 레이아웃 프리셋, 사용자 정의 언어 규칙, AI 채팅(코드 설명 등).

## 3. 기술 스택과 아키텍처

**스택**: Electron + React + Monaco (UI) / Node.js 인덱서 (tree-sitter 네이티브 바인딩 + better-sqlite3).

```
┌─────────────────────────────────────────────┐
│ Electron Main (창 관리, 파일 I/O, 프로세스 조정) │
└──────┬──────────────────────┬───────────────┘
       │ IPC                  │ IPC (버전 있는 프로토콜)
┌──────▼──────────┐    ┌──────▼──────────────┐
│ Renderer (React) │    │ Indexer Worker      │
│ - Monaco 에디터   │    │ (Node utility proc) │
│ - 5개 패널 UI     │    │ - tree-sitter 파싱   │
│ - 내비게이션 히스토리│    │ - SQLite 심볼 DB     │
└─────────────────┘    │ - chokidar 파일 워처 │
                       │ - worker_threads 풀  │
                       └─────────────────────┘
```

- **인덱서는 별도 프로세스**: 초기 인덱싱 중에도 UI가 멈추지 않는다. 내부에서 worker_threads 풀로 파일 병렬 파싱.
- **인덱서 ↔ UI는 버전 있는 IPC 프로토콜 뒤에 격리**: 향후 병목이 실측되면 UI 변경 없이 인덱서만 Rust 등으로 교체 가능 (Node 선택의 보험).

### 3.1 Node 채택 조건 (필수 준수)

Node 재검토(2026-07-15) 결과, 100만 줄 목표에서 Node는 병목이 아니다
(참고: tree-sitter 병렬 파이프라인이 Linux 커널 2.1M 노드를 ~3분에 인덱싱한 사례).
단, 다음 3가지를 지킨다:

1. **tree-sitter Query API만 사용** — 심볼 추출은 S-표현식 쿼리로 C 레벨에서 매칭하고
   캡처 결과만 JS로 받는다. JS에서 노드 트리를 직접 순회(`node.children` 반복)하는
   코드는 금지 (JS↔네이티브 경계 비용 폭증).
2. **WASM 폴백 금지** — 네이티브 바인딩 로드 실패 시 조용히 WASM으로 폴백하지 않고
   명시적 오류를 낸다 (WASM은 5~10배 느림).
3. **네이티브 스켈레톤 최우선 마일스톤** — 구현 첫 단계는 "node-tree-sitter +
   better-sqlite3가 로드되는 Electron 앱"의 빌드/패키징 검증이다.
   (@electron/rebuild로 ABI 재빌드, 번들러에서 두 모듈 external 처리)

## 4. 심볼 데이터베이스 (SQLite)

인덱스는 언제든 버려도 되는 캐시로 취급한다 (손상/버전 불일치 시 자동 재구축).

- `files` — 경로, 콘텐츠 해시, 언어, 마지막 인덱스 시각
- `symbols` — 이름, 종류(함수/클래스/구조체/메서드/필드/전역변수/매크로/타입),
  파일, 위치(시작/끝), 스코프 경로, 시그니처
- `refs` — 이름, 파일, 위치, 참조 종류(호출/사용). **이름 기준으로 저장**하고
  심볼과의 매칭(해석)은 조회 시점에 수행
- `name_fragments` — camelCase/snake_case 분해 조각 인덱스
  (`CreateWindow` → `create`, `window`) — Name Fragment 검색용
- FTS5 가상 테이블 — 전문 검색
- `PRAGMA mmap_size` 설정으로 메모리 맵 I/O 활용, WAL 모드

## 5. 심볼 해석 모듈 (A안: tree-sitter 휴리스틱)

`refs`의 이름 → `symbols` 후보 매칭을 담당하는 **격리된 독립 모듈**. 매칭 규칙 우선순위:

1. 같은 파일의 로컬 스코프
2. 같은 파일 전체
3. include(C/C++) / import(TS·Python·Java) 관계로 연결된 파일
4. 프로젝트 전체 동명 심볼 — 후보가 복수면 전부 표시하되 신뢰도 순 정렬

정확도는 근사치임을 UX로 흡수한다:
- Relation Window: 복수 후보 시 후보 수 표시
- **Smart Rename**: 해석 결과를 파일별 체크박스 미리보기 리스트로 제시,
  사용자가 확정한 항목만 일괄 변경 (원본 Source Insight와 동일한 접근)

이 모듈만 교체하면 v2에서 LSP 보강(하이브리드)으로 확장된다.

## 6. UI 설계 (Source Insight 방식)

```
┌────────────── 파일 탭 ───────────────────────┐
│ Project │ Symbol  │              │ Relation  │
│ Window  │ Window  │   에디터      │  Window   │
│ (파일)  │(아웃라인)│  (Monaco)    │ (호출트리) │
├─────────┴─────────┴──────────────┴───────────┤
│         Context Window (정의 미리보기)          │
└──────────────────────────────────────────────┘
```

- 패널은 접기/크기 조절 가능, 배치는 프로젝트별로 저장
- **Context Window**: 커서 이동 시 ~150ms 디바운스 후 심볼 정의 표시.
  변수는 타입 선언까지 따라가서 표시
- **Relation Window**: Call Tree / Callers / References / Class 계층 탭.
  기본 깊이 3 제한 + 노드 확장 시 지연 로드 (성능 제어 — 보고서 4장 대응).
  노드 클릭 → 해당 위치로 점프
- **검색**: 단일 검색창. 심볼 조각 검색(fragment index)과 전문 검색(FTS5)을
  통합 표시, 결과에 코드 미리보기
- **내비게이션**: 클릭 → 참조 하이라이트 / Ctrl+클릭·더블클릭 → 정의 점프 /
  Backspace·마우스 뒤로 버튼 → 히스토리 백
- **북마크**: "가장 가까운 함수/클래스 이름 + 상대 오프셋"으로 저장해 코드가
  변해도 위치 유지, 프로젝트별 목록

## 7. AI 코드 자동완성 (v1.5)

기존 아키텍처에 완전 추가형(additive) 모듈. 인덱서/심볼 DB는 변경 없음.

```
Renderer: Monaco InlineCompletionsProvider (고스트 텍스트)
  · 300ms 디바운스, 새 키 입력 시 이전 요청 취소
        │ IPC
Main: CompletionService
  ├─ ContextBuilder — 커서 앞/뒤 코드 + 심볼 DB에서 관련 심볼
  │   시그니처 조회해 프롬프트에 포함 (심볼 DB 보유가 차별점)
  ├─ ProviderAdapter 인터페이스: complete(ctx) → 토큰 스트림
  │   ├─ AnthropicAdapter — 공식 @anthropic-ai/sdk, messages.stream() 사용.
  │   │   최신 Claude는 어시스턴트 프리필 미지원 → 시스템 프롬프트로
  │   │   "코드 이어쓰기만 출력" 지시 + stop_sequences 사용
  │   └─ OpenAIAdapter — 공식 openai SDK.
  │       로컬 LLM(Ollama·LM Studio·llama.cpp)은 OpenAI 호환 엔드포인트를
  │       제공하므로 baseURL 변경만으로 지원 (별도 어댑터 불필요)
  └─ 설정: provider/model/endpoint는 사용자 설정.
      API 키는 Electron safeStorage로 암호화 저장 (평문 저장 금지)
```

- Provider 미설정 시 기능은 완전히 비활성 (코어 기능에 영향 없음)
- 인라인 완성 기본 추천 모델: 지연시간 우선 — Anthropic `claude-haiku-4-5`,
  로컬은 Qwen2.5-Coder 계열. 사용자가 설정에서 변경 가능
- 로컬 LLM 옵션으로 "코드가 외부로 나가지 않는 모드" 자연 지원

## 8. 데이터 흐름

- **프로젝트 열기**: 폴더 선택 → .gitignore 존중 스캔 → 워커 풀 병렬 파싱 →
  DB 기록 → 진행률 표시. 인덱싱 완료 전에도 파일 열람/편집 가능
  (분석 기능은 인덱싱 진행에 따라 점진 활성화)
- **편집 중**: 저장 또는 500ms 유휴 시 해당 파일만 재파싱 → DB 갱신 →
  열린 패널(Symbol/Context/Relation)에 변경 통지
- **외부 변경**: chokidar가 감지 → 해당 파일 재인덱싱 (git pull 등 대응)

## 9. 오류 처리

- 파싱 오류 무시하고 추출 가능한 심볼만 저장 (tree-sitter ERROR 노드 허용) —
  오류-허용 파싱 철학
- 심볼 DB 손상/스키마 버전 불일치 → 자동 전체 재인덱싱
- 네이티브 모듈 로드 실패 → 명시적 오류 다이얼로그 (조용한 성능 저하 금지)
- AI provider 오류(키 만료, 네트워크) → 완성 기능만 조용히 비활성 + 상태바 표시

## 10. 테스트 전략

- **단위**: 언어별 픽스처 파일로 심볼/참조 추출 검증 (6개 언어 각각),
  심볼 해석 모듈의 스코프 규칙 검증
- **통합**: 실제 OSS 저장소(redis=C, spring-petclinic=Java 등) 인덱싱 —
  심볼 개수·소요 시간·증분 갱신 검증
- **성능 기준**: 100만 줄 초기 인덱싱 < 2분, 단일 파일 재파싱 < 100ms,
  심볼 검색 응답 < 50ms
- **UI**: Playwright 스모크 테스트 (프로젝트 열기 → 검색 → 정의 점프 → Relation 표시)

## 11. 주요 결정 기록

| 결정 | 선택 | 근거 |
|---|---|---|
| 제품 형태 | 독립 데스크톱 에디터 | 원본 UX 충실 재현 |
| MVP 무게중심 | 분석 중심 + 기본 편집 | Source Insight의 차별점에 집중 |
| 스택 | Electron+React+Monaco / Node 인덱서 | 단일 언어(TS), Monaco가 UX 상당 부분 내장 |
| 인덱서 언어 | Node 유지 (조건부, §3.1) | 100만 줄에서 병목 아님, IPC 격리로 교체 가능 |
| 심볼 해석 | A안: tree-sitter 휴리스틱 | 컴파일 독립 = 핵심 가치, v2에서 LSP 확장 여지 |
| Smart Rename | 미리보기+확인 방식으로 MVP 포함 | 휴리스틱 부정확성을 UX로 흡수 |
| AI 자동완성 | v1.5 (MVP 직후) | 추가형 모듈이라 설계 변경 없음 |
