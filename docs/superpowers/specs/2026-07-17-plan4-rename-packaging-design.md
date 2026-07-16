# Plan 4: Smart Rename + 시맨틱 토큰 + 패키징 — 설계 문서

**작성일**: 2026-07-17
**상태**: 자율 모드 승인 (사용자 위임 — 비평 에이전트 리뷰로 게이트 대체)
**상위 스펙**: `2026-07-15-sourceinsight-clone-design.md` (§2 MVP 분석 4종 중 4=Smart Rename, §5 해석 UX, §6 시맨틱 토큰)
**선행**: Plan 3 (분석 기능, main 병합 `886ee9f`). 패키징 대상: **macOS만** (사용자 확정).

## 1. 범위

MVP(v1) 마감: Smart Rename, 심볼 DB 기반 시맨틱 토큰 색상, macOS 패키징, 렌더러 typecheck 게이트(P3 인계).

포함:
- **스키마 v3**: 심볼 **이름 식별자의 정확한 위치**(name_line/name_col, **0-기반** — 기존 start_*와 동일 규약, UI에서 +1) 저장. SCHEMA_VERSION=3, SymbolRow/insSym INSERT 확장. HIT_SELECT·getSubclasses는 명시 컬럼이라 무영향 (비평 확인)
- **Smart Rename** (스펙 §2·§5): 커서 심볼 → 대상 수집(정의 이름 위치 + refs) → **파일 그룹 체크박스 미리보기** → 확정 항목만 일괄 치환 → 재인덱싱
- **시맨틱 토큰 색상** (스펙 §2): 심볼 DB 기반 — 전역/멤버(스코프 유무)/종류별 색 구분. Monaco **데코레이션 기반** (semantic tokens API 대신 — 아래 결정 기록)
- **렌더러 typecheck 게이트**: 선재 타입 오류 2건 수정 + `typecheck:renderer`를 build 파이프라인에 통합
- **macOS 패키징**: electron-builder, 무서명(dmg/zip), 네이티브 모듈 asarUnpack, 패키지드 앱 SI_SMOKE 실증

제외:
- Windows/Linux 패키징 (추후 — cross-env 등 준비만 주석으로)
- 코드사인/노터라이즈 (배포 시점 사안)
- LSP 정밀 rename (v2)

## 2. 결정 기록 (자율 모드 — 근거 포함)

| 결정 | 선택 | 근거 |
|---|---|---|
| 정의부 치환 위치 | **스키마 v3**: symbols에 `name_line`/`name_col` 컬럼 추가 (nameCap 노드 위치) | 현 start_*는 def 노드 전체(함수 시그니처 시작) — 이름 식별자 위치가 아님. 첫 줄 텍스트 검색 휴리스틱보다 정확·저렴. v2와 동일하게 버전 승격으로 재인덱싱 강제 |
| rename 적용 주체 | **main이 디스크에서 일괄 치환** (파일별 bottom-up, 위치 텍스트가 oldName과 일치할 때만) → 성공 후 인덱서에 indexFile | 렌더러 모델 편집 경유보다 단순·원자적. 열린 clean 버퍼는 기존 fileIndexed('disk') 리로드 경로가 자동 갱신 |
| dirty 버퍼 충돌 | **대상 파일 중 dirty가 있으면 rename 차단** ("저장 후 다시 시도") | 병합 충돌 UI를 만들지 않음 — SI 철학(미리보기+확인)의 최소 안전 구현 |
| **선행 버그 수정 (비평 major)** | `setDiskContent`의 `model.setValue`가 `onDidChangeContent`를 발화시켜 clean 버퍼를 dirty로 오염 (⚠ 오탐 + 재rename 차단). **`e.isFlush`면 무시** (사용자 편집은 incremental, setValue는 flush) | rename의 "clean 버퍼 자동 리로드" 경로가 이 잠복 결함을 다중 파일로 증폭 — Plan 4 첫 태스크로 수정 + 리로드 후 dirty 미발생 검증 |
| **미포착 사용처 (비평 major)** | 대상 수집은 근사치(정의+call/extends refs)라 일반 식별자 사용처(값 전달, 타입 위치 등)를 놓침 → **FTS로 oldName 포함 파일을 찾아 단어 경계 텍스트 스캔**, 수집된 대상에 없는 발생을 "확인되지 않은 사용처" 그룹으로 표시 (**기본 해제** 체크박스) | false-negative는 미리보기로 보이지 않으면 조용히 코드가 깨짐 — 스캔 그룹으로 가시화하되 기본 해제로 보수적 유지 (§5 철학) |
| 치환 검증 | 각 (line,col)에서 길이 oldName의 텍스트가 oldName과 정확 일치할 때만 치환, 불일치는 건너뛰고 결과에 보고 | 인덱스가 낡았을 가능성(편집 직후) 방어 — 조용한 오염 금지 (스펙 §9 철학) |
| 새 이름 검증 | `/^[A-Za-z_$][A-Za-z0-9_$]*$/` (식별자 형태만) | 언어별 완전 검증은 과잉 — 공통 안전선만 |
| rename 트리거 | **F2** (에디터 포커스, 커서가 단어 위) — Monaco addCommand | VS Code 관례. Cmd/Ctrl+F2(북마크)와 구분 |
| 시맨틱 토큰 구현 | **데코레이션 기반** (createDecorationsCollection + inlineClassName) — Monaco semantic tokens API 미사용 | standalone Monaco의 semantic tokens는 테마 연동 설정이 버전 의존적·문서 부실 (위험). 데코는 이미 참조 하이라이트로 검증된 경로, CSS로 즉시 테마 통제. 성능: 파일당 수백 데코는 문제없음 (2MB 초과 파일은 어차피 심볼 스킵) |
| 토큰 색 구분 | kind 기반 클래스 + **스코프 유무로 멤버/전역 구분**: function/method, class/struct/interface/type/enum, variable(전역)/field(멤버), macro, namespace | 스펙 §2 "전역변수/멤버/로컬 구분" 중 로컬은 DB에 없음(추출 범위) — 전역/멤버 구분까지 구현, 로컬은 Monaco 기본색 유지로 자연 구분됨을 명시 |
| 토큰 데이터 | 신규 api `getFileTokens(path)`: 해당 파일 심볼(name_line/name_col, kind, scope) + refs(kind='call'|'extends', 이름 길이) | 이름 정의 위치와 참조 위치 모두 색칠. import 문자열은 제외 |
| 패키징 도구 | **electron-builder**, mac 타깃 `dir`(검증용)+`dmg`+`zip`, 무서명(identity:null) | 표준 도구. dir 타깃으로 패키지드 앱을 SI_SMOKE로 실증 가능 |
| 네이티브 모듈 리빌드 | **`npmRebuild: false`** + 패키징 전에 기존 `rebuild:electron` 스크립트로 선빌드: `"package": "npm run build && npm run rebuild:electron && electron-builder --mac"` | **비평 blocker 반영**: electron-builder 기본 rebuild는 `CXXFLAGS=-std=c++20` 없이 @electron/rebuild를 돌려 tree-sitter binding.gyp c++17 하드코딩에 그대로 걸림 (Plan 1에서 확인된 실패). 이미 동작하는 스크립트를 재사용 |
| asarUnpack | 네이티브 패키지 디렉터리 전체: `**/node_modules/{better-sqlite3,tree-sitter,tree-sitter-*}/**` | .node만 unpack하면 better-sqlite3의 bindings 경로 해석이 asar 안을 봄 — 패키지 단위 unpack이 안전. 패키지드 SI_SMOKE로 최종 실증 |
| 패키징 후 ABI | 패키징(electron ABI 리빌드 발생) 후 **rebuild:node로 휴지 상태 복구** 스크립트/문서화 | 기존 ABI 이중성 운영 규칙 유지 |
| typecheck 게이트 | 선재 오류 2건(languages.ts TS1202, App.tsx onMenu .then 타입) 수정 후 `"typecheck:renderer": "tsc -p src/renderer/tsconfig.json --noEmit"`를 `build`에 선행 통합 | P3 최종 리뷰 인계 — 렌더러 회귀가 빌드를 실패시키게 |
| languages.ts import 수정 방식 | 1순위 `import Parser from 'tree-sitter'` (esModuleInterop, export= 모듈) — 단 **양쪽 tsconfig 컴파일 + 노드 런타임(`Parser.Query`/`Parser.Language`가 값으로 유지)을 반드시 검증**. 깨지면 2순위: 렌더러 typecheck에서 인덱서 전용 파일 제외 | 비평 지적 — `new Parser.Query(...)`는 값 사용이라 인터롭 시맨틱 검증 필수. 동작 코드의 시맨틱 변경은 검증 없이 금지 |

## 3. Smart Rename 흐름

1. F2 (커서가 단어 위) → RenameOverlay 오픈: 새 이름 입력 + 대상 목록
2. 대상 수집 (인덱서 RPC `getRenameTargets {name, fromPath}`):
   - 정의: `getDefinitions(name)` → (path, name_line, name_col)
   - 참조: `getReferences(name)` (kind call/extends) → (path, line, col)
   - 반환: 파일별 그룹 `{ path, occurrences: [{line, col, isDefinition}] }[]` + resolve 신뢰도(후보 수) 참고 표시
3. UI: 파일 그룹 헤더 체크박스(전체 토글) + 항목별 체크박스, 각 항목에 해당 줄 텍스트 미리보기(main file:read, 열린 모델 우선). 기본 전체 선택
4. 적용 전 검증: 새 이름 식별자 형태, 대상 파일 dirty 여부(하나라도 dirty → 차단 안내)
5. 적용 (main ipc `rename:apply {oldName, newName, targets}`):
   - 파일별로 읽기 → 라인/col 내림차순 치환(오프셋 보존) → 위치 텍스트 ≠ oldName이면 skip 기록 → 쓰기
   - 각 파일 indexFile 트리거 → fileIndexed('disk') → 열린 clean 버퍼 자동 리로드 (기존 경로)
   - 결과 `{changedFiles, replaced, skipped: [{path,line,col}]}` → 오버레이에 요약 표시 (skipped 있으면 경고)
6. 인덱스 근사치 한계는 미리보기+체크박스로 흡수 (스펙 §5 원문 그대로)

## 4. 시맨틱 토큰

- 신규 api `getRefsForFile(db, path)`: `refs WHERE file_id=? AND kind IN ('call','extends')` (getReferences는 이름 기준 프로젝트 전역이라 부적합 — 비평 반영)
- RPC `getFileTokens {path}` → `{ symbols: [{name, kind, scope, nameLine, nameCol}], refs: [{name, kind, line, col}] }` (symbols는 파일 내, refs는 getRefsForFile). 색칠은 희소함을 명시: 정의 이름 + call/extends 참조만, 변수/타입 사용처는 Monaco 기본색 (상위 스펙 §2 문언 내 허용)
- EditorPane: 모델 활성/`fileIndexed` 시 토큰 요청 → 데코레이션 컬렉션 교체. 클래스 매핑:
  - function/method → `sem-func`, class/struct/interface/type/enum → `sem-type`, macro → `sem-macro`, namespace → `sem-ns`
  - variable: scope==='' → `sem-global`, 그 외 → `sem-member`; field → `sem-member`
  - refs: 대응 정의를 이름으로 찾아 같은 클래스 적용 (파일 내 심볼 우선, 없으면 무색 — 원격 조회 안 함: 파일 단위 요청 1회로 제한)
- CSS: vs-dark 조화 색 (예: sem-func #dcdcaa, sem-type #4ec9b0, sem-global #9cdcfe+bold, sem-member #9cdcfe, sem-macro #c586c0, sem-ns #4ec9b0)
- 참조 하이라이트(배경색)와 시맨틱(글자색)은 독립 데코 컬렉션 — 중첩 무해

## 5. 패키징 (macOS)

- `electron-builder` devDep. package.json `"build"` 필드 대신 **electron-builder.yml**:
  - appId `dev.roy.sourceinsight`, productName `SourceInSight`
  - **`npmRebuild: false`** (blocker 반영 — 기본 rebuild는 CXXFLAGS 미주입으로 실패)
  - files: `dist/**`, `package.json` (+기본 node_modules 규칙), asarUnpack: `**/node_modules/{better-sqlite3,tree-sitter,tree-sitter-*}/**`
  - mac: target `[dir, dmg, zip]`, identity null, category developer-tools
- 스크립트: `"package": "npm run build && npm run rebuild:electron && electron-builder --mac"`, 산출 `release/` (gitignore)
- **검증 (필수)**: `release/mac*/SourceInSight.app/Contents/MacOS/SourceInSight`를 `SI_SMOKE=1 SI_OPEN_PROJECT=<fixture> SI_USER_DATA=<tmp>`로 실행 → `[smoke] {...}` + exit 0 (§3.1 패키징 마일스톤 완성)
- 후처리: `npm run rebuild:node` + `npm test`로 휴지 상태 복구 (운영 규칙 유지)

## 6. 오류 처리

- rename 적용 중 파일 쓰기 실패 → 해당 파일 skip 목록에 기록, 나머지 계속, 요약에 표시 (부분 실패 허용 — 이미 쓴 파일 롤백 안 함, 결과가 정확히 보고됨)
- rename 대상 0건 → 오버레이에 "대상 없음"
- 패키지드 앱에서 네이티브 로드 실패 → 기존 명시적 오류 경로 그대로 (§3.1)

## 7. 테스트

- **단위**: name_line/name_col 추출(6언어 대표 픽스처), getRenameTargets 그룹핑, 치환 엔진(bottom-up, 불일치 skip, 동일 줄 다중 발생), getFileTokens 매핑, 새 이름 검증
- **통합**: host RPC getRenameTargets/getFileTokens 왕복; main 치환 엔진은 tmp 파일로
- **E2E**: F2 → 새 이름 → 적용 → 두 파일 디스크 내용 변경 + 열린 버퍼 리로드 + 아웃라인 갱신
- **패키징**: 패키지드 앱 SI_SMOKE exit 0
