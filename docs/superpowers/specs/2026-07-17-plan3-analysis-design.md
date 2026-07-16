# Plan 3: 분석 기능 — 설계 문서

**작성일**: 2026-07-17
**상태**: 자율 모드 승인 (사용자 위임 — 비평 에이전트 리뷰로 게이트 대체)
**상위 스펙**: `2026-07-15-sourceinsight-clone-design.md` (§2 MVP 분석 4종 중 1~3, §5 해석 모듈, §6 UI, §8 데이터 흐름)
**선행**: Plan 2 (UI 셸, main 병합 `1acb58f`)

## 1. 범위

Source Insight의 핵심 차별점인 분석 기능을 붙인다. Smart Rename은 Plan 4.

포함:
- **스키마 v2 + 추출기 확장**: import/include 관계와 클래스 상속(extends/implements) 추출 (6개 언어)
- **심볼 해석 모듈** (스펙 §5 A안): 이름 → 후보 심볼, 우선순위 (로컬/같은 파일 → import 연결 파일 → 전역) + 신뢰도 정렬. 격리 모듈 (v2에서 LSP 교체 가능)
- **유휴 재파싱** (Plan 2 이월): 편집 중 500ms 유휴 시 미저장 버퍼를 인덱싱 (`indexBuffer` RPC)
- **Context Window**: 커서 심볼 정의 미리보기 (~150ms 디바운스, 읽기 전용 Monaco)
- **자동 참조 하이라이트**: 커서 단어의 파일 내 참조 강조 (refs 기반 데코레이션)
- **Browser Mode 내비게이션**: Ctrl/Cmd+클릭·더블클릭 → 정의 점프, 내비게이션 히스토리 (뒤로/앞으로)
- **통합 검색**: 오버레이 검색창 — fragment 심볼 검색 + FTS 전문 검색 통합, 코드 미리보기, Enter 점프
- **Relation Window**: Calls / Callers / References / Class 탭, 깊이 3 + 노드 확장 지연 로드, 클릭 점프
- **영구 북마크**: 함수/클래스 기준 앵커 저장, 프로젝트별, 목록 UI + 점프

제외 (이후):
- Smart Rename, 시맨틱 토큰 색상, 패키징 (Plan 4)
- LSP 보강, 심볼 자동완성 (v2)

## 2. 결정 기록 (자율 모드 — 근거 포함)

| 결정 | 선택 | 근거 |
|---|---|---|
| import/상속 저장 | `refs` 테이블 재사용: kind `'import'`(name=모듈/경로 문자열), kind `'extends'`(name=부모 클래스명, enclosing=자식 클래스 심볼) | 새 테이블 없이 기존 cascade/인덱스 재사용. SCHEMA_VERSION 2로 승격 → 기존 DB 자동 재구축 (스펙 §4 캐시 철학) |
| Backspace 뒤로가기 | **에디터 포커스 밖에서만** Backspace 히스토리 백. 주 경로는 Alt+←/→, 마우스 뒤로/앞으로 버튼, 상단 툴바 ◀▶ | Monaco에서 Backspace는 삭제 키 — 전역 바인딩은 편집 파괴. 원본 SI의 Backspace-back은 브라우저 모드 전용이었음. 스펙 §6의 "마우스 뒤로 버튼"은 완전 지원 |
| 정의 점프 트리거 | Ctrl/Cmd+클릭, 더블클릭은 **수정자 없이 심볼 위** 더블클릭 시 점프 대신 참조 하이라이트만 (더블클릭=단어 선택과 충돌) → 점프는 Ctrl/Cmd+클릭 + F12 | 더블클릭 점프는 텍스트 선택 UX 파괴. SI 사용자 습관은 Ctrl+클릭으로 충분히 커버, F12는 보편 관례 |
| Context 미리보기 렌더 | 읽기 전용 Monaco 보조 에디터, `si-preview:` 스킴의 일회용 모델 (갱신마다 dispose) | 문법 색상 일관성. 실제 파일 URI 재사용 금지 — 편집 모델과의 간섭(dirty/리로드) 차단 |
| 검색 UI | 중앙 상단 오버레이 (Cmd/Ctrl+Shift+F), 심볼 결과와 전문 결과를 섹션으로 통합 표시, ↑↓/Enter 점프, Esc 닫기 | 스펙 §6 "단일 검색창" — 패널 상주 대신 오버레이가 레이아웃 불변 유지 |
| 북마크 UI | 좌측 사이드에 Bookmarks 섹션 추가 (Project/Symbol 아래 3분할), Cmd/Ctrl+F2 토글 | 스펙 §6에 배치 미지정 — 목록 상시 노출이 SI 관례에 부합 |
| 북마크 저장소 | main persistence: `userData/bookmarks/<프로젝트 해시>.json` | UiState와 분리 (수명 상이 — 레이아웃 초기화가 북마크를 지우면 안 됨) |
| 유휴 재파싱 | 렌더러 500ms 디바운스 → `indexBuffer {path, content}` RPC → 파이프라인이 문자열로 인덱싱 (해시 가드 동일) | 디스크 미저장 상태에서 Context/Relation/아웃라인 최신화 (스펙 §8). 저장 시 indexFile과 동일 경로로 수렴 |
| 해석 모듈 위치 | `src/indexer/resolve.ts` — 인덱서 프로세스 내 순수 함수 모듈, RPC `resolve {name, fromPath, line?}` | 스펙 §5 "격리된 독립 모듈". DB 접근이 필요하므로 인덱서 측 |
| Relation Class 탭 | 위(부모 체인) + 아래(자식들, extends refs 역참조) 양방향 | 스펙 §6 "클래스 계층" |
| References 정확도 | refs의 동명 전체 (해석 필터 없음) + 파일 그룹핑 — 후보 수 표시로 근사치 UX 흡수 | 스펙 §5 "복수 후보 시 후보 수 표시" |

## 3. 스키마 v2 + 추출기 확장

`SCHEMA_VERSION = 2` (변경: 없음 — refs kind 값만 추가되므로 구조 동일하나, 기존 DB에 import/extends가 없어 재인덱싱 필요 → 버전 승격으로 강제 재구축).

언어별 쿼리 추가 캡처:
- **imports** (`@ref.import`, name=import 대상 문자열):
  - C/C++: `preproc_include` 경로 (`"x.h"`/`<x.h>` 따옴표 제거)
  - TS/TSX: `import_statement`의 source 문자열, `export ... from` 포함
  - Python: `import a.b` / `from a.b import c`의 모듈 경로
  - Java: `import_declaration`의 qualified name
- **inherits** (`@ref.extends`, name=부모 타입명, enclosing=자식 클래스):
  - TS/TSX: `class_heritage` (extends/implements)
  - Java: superclass + super_interfaces
  - C++: `base_class_clause`
  - Python: `class_definition`의 superclass argument_list (identifier만)
  - C: 해당 없음

extractor는 기존 Query API 원칙 유지 (§3.1 — JS 트리 순회 금지).

**extractor 일반화 (필수)**: 현재 `RefRow.kind`는 `'call'` 하드코딩이고 매치 루프가 `ref.call`만 수집한다 — `ref.*` 캡처를 일반화해 suffix를 kind로 운반한다 (`RefRow.kind: 'call' | 'import' | 'extends'`). extends의 enclosing은 기존 containsPoint 방식이 자동으로 자식 클래스를 잡는다 (부모 타입 식별자가 자식 클래스 def 범위 안에 위치 — 4개 언어 공통, 검증됨).

**문법 검증 우선**: 6개 언어의 신규 캡처는 **설치된 문법 버전의 실제 노드/필드명**에 의존한다 (TS `class_heritage` 구조, Python `superclasses:` 필드, C `system_lib_string` vs `string_literal` 등). 구현 첫 단계에서 언어별 픽스처(제네릭 부모 `extends Base<T>`, qualified 부모 `mod.Base` 포함)로 쿼리를 TDD 검증한 뒤 진행한다. 제네릭/qualified 부모는 최내부 식별자만 캡처해도 무방 (이름 매칭 기반이므로).

## 4. 심볼 해석 모듈 (`src/indexer/resolve.ts`)

```
resolveSymbol(db, name, fromPath): Candidate[]   // Candidate = SymbolHit + confidence
```

우선순위 (스펙 §5):
1. **같은 파일**: 후보 중 fromPath와 같은 파일 → confidence 'same-file'
2. **import 연결 파일**: fromPath의 refs(kind='import')가 가리키는 파일들(경로 휴리스틱 매칭: 상대경로 해석, 확장자 보정, basename 일치) 안의 후보 → 'imported'
3. **전역**: 나머지 동명 심볼 → 'global', 이름 완전일치 → kind 우선순위(function/class/method 우선)로 정렬

로컬 스코프(§5의 1단계)는 로컬 변수를 DB에 안 넣는 현 추출 범위에서 같은-파일 tier에 흡수 — 한계로 문서화. import 경로 매칭은 언어별 완전 해석기가 아닌 **basename/상대경로 휴리스틱** (정확도는 UX로 흡수, §5 철학).

import 경로 매칭 성능: 매칭은 fromPath 한 파일의 import 문자열(통상 수십 개)에 대해서만 수행 — 상대경로는 정확 일치 조회, basename 폴백은 import당 files 테이블 1회 LIKE 스캔(1M줄≈1만 행)으로 총 수 ms 수준. §10의 50ms 검색 예산 내.

**RPC 표면 (전체 열거)** — api.ts 신규 함수와 1:1:
- `resolve {name, fromPath}` → Candidate[] (Ctrl+클릭/F12/Context 공통. 후보 복수면 첫 후보 점프 + 후보 수 표시)
- `indexBuffer {path, content}` → {indexed: boolean}
- `getReferences {name}` → RefHit[] (refs 동명 전체, 파일/줄 — References 탭)
- `getSuperclasses {symbolId}` → SymbolHit[] (해당 클래스의 extends refs → 부모 이름 resolve)
- `getSubclasses {name}` → SymbolHit[] (kind='extends' AND name=클래스명인 refs의 enclosing 심볼들)

**재귀 안전장치 (Calls/Callers/Class 트리)**: 트리별 visited set — 노드 키 `(name, path, line)` — 로 순환(A↔B) 차단. `callerName`이 null(최상위 ref)이면 리프 처리. 동명 심볼 혼입은 §5 철학대로 후보 수 표시로 흡수하고 정확도 한계를 문서화.

## 5. UI 컴포넌트

- **ContextPanel** (기존 빈 패널 교체): 커서 이동 150ms 디바운스 → 커서 단어 → `resolve` → 최상위 후보의 정의 주변(심볼 시작~끝, 최대 80줄) 표시. **소스는 열린 Monaco 모델이 있으면 그 내용을 우선** (미저장 편집 반영), 없으면 main `file:read`. 읽기 전용 Monaco, 헤더에 `이름 — 파일:줄 (후보 N개)`. 클릭 시 해당 위치 점프. *한계(명시적 이월)*: 상위 스펙 §6의 "변수는 타입 선언까지 따라가서 표시"는 로컬 변수가 DB에 없는 현 추출 범위에서 불가 — v2 LSP 보강에서 처리, Context는 이름의 정의만 표시.
- **RelationPanel** (기존 빈 패널 교체): 상단 탭 4개. 활성 심볼(커서 기준 resolve 결과)을 루트로:
  - Calls: `getCallees(symbolId)` 재귀 (깊이 3, 노드 ▶ 확장 시 지연 로드)
  - Callers: `getCallers(name)` 재귀 동일
  - References: refs 동명 전체, 파일별 그룹
  - Class: extends 체인 상향 + 자식 하향
  - 노드 클릭 → 점프. 트리 상태는 세션 한정 (저장 안 함)
- **SearchOverlay**: Cmd/Ctrl+Shift+F. 입력 디바운스 150ms → `searchSymbols` + `searchText` 병렬 → 두 섹션 렌더 (심볼: 이름/종류/파일:줄, 텍스트: 파일 + snippet). ↑↓ 선택, Enter 점프, Esc 닫기.
- **BookmarksSection**: 사이드 3분할. Cmd/Ctrl+F2로 현재 줄 토글. 표시: `파일 · 앵커심볼+오프셋 · 미리보기 텍스트`. 클릭 점프, ✕ 삭제.
- **내비게이션**: 렌더러 히스토리 스택 (엔트리 = {path, line, col}). 점프 계열 행동(정의 점프, 검색 점프, Relation/북마크/아웃라인 클릭) 전에 현재 위치 push. Alt+←/→, 마우스 버튼 3/4, 에디터 밖 Backspace, 툴바 ◀▶ (EditorArea 탭줄 좌측). 스택 상한 100.

## 6. 데이터 흐름 추가분

- **유휴 재파싱**: Monaco onDidChangeContent → 500ms 디바운스 → `indexBuffer {path, content}` → 파이프라인이 `indexFile`을 `읽기 → indexContent(rel, content)`로 분리한 뒤 문자열 경로 사용 (해시 가드 동일 — 저장 시 indexFile과 자연 수렴). `FileIndexedPayload`에 `source?: 'buffer' | 'disk'` 추가 (기본 'disk', main·인덱서 동시 배포라 PROTOCOL_VERSION 불변). **렌더러 처리 규칙**: `source==='buffer'`면 dirty/디스크 리로드 블록 **전체를 건너뛰고** `bumpOutline` + 분석 갱신만 수행 — 그러지 않으면 자기 타이핑(dirty)이 markDiskChanged를 때려 가짜 ⚠가 뜬다 (Plan 2 이벤트 핸들러의 잠복 상호작용, 비평 리뷰 확인). 'disk'는 기존 Plan 2 로직 그대로.
- **단일 연결 불변식**: 증분/버퍼/워처 인덱싱은 모두 인덱서 host의 단일 better-sqlite3 연결에서 직렬 수행 — 향후 worker 풀 도입 시에도 쓰기는 이 연결로 모은다 (SQLITE_BUSY 방지).
- **커서 → 분석 갱신**: onDidChangeCursorPosition 150ms 디바운스 → 단어 추출 → Context/Relation 공용 상태 (store: `cursorSymbol {name, path, line} | null`).

## 7. 오류 처리

- resolve 결과 0건: Context "정의를 찾을 수 없음", 점프는 no-op + 상태바 안내
- 인덱싱 중: Context/Relation/검색은 빈 상태 + "인덱싱 중" 힌트 (Plan 2 관례 유지)
- 북마크 앵커 유실 (심볼 삭제됨): 저장된 절대 줄로 폴백, 목록에 ~ 표시

## 8. 테스트

- **단위**: 추출기 확장 (6언어 import/extends 픽스처), resolve 우선순위 (같은파일/임포트/전역 + 경로 휴리스틱), indexBuffer (해시 가드, FTS 반영), 북마크 앵커 계산/재해석, 히스토리 스택 로직
- **통합**: host RPC — resolve/indexBuffer/클래스 계층 왕복
- **E2E 확장**: 검색 오버레이 → 결과 점프, Ctrl+클릭 정의 점프 → Alt+←로 복귀, Context Window 내용 표시, Relation Callers 표시, 북마크 토글→점프
