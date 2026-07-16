# Plan 4: Smart Rename + 시맨틱 토큰 + 패키징 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MVP(v1) 마감 — Smart Rename(미리보기+확인), 심볼 DB 시맨틱 토큰, 렌더러 typecheck 게이트, macOS 패키징 실증.

**Architecture:** 스키마 v3(심볼 이름 위치)로 정확한 치환/색칠 좌표 확보. rename은 인덱서가 대상 수집(+FTS 미확인 스캔), main이 디스크 치환(순수 엔진 분리), 렌더러가 체크박스 미리보기. 시맨틱 토큰은 데코레이션 기반. 패키징은 rebuild:electron 선빌드 + electron-builder(npmRebuild:false). 스펙: `docs/superpowers/specs/2026-07-17-plan4-rename-packaging-design.md`.

**Tech Stack:** 기존 + `electron-builder` (devDep 1개 신규).

## Global Constraints

- **좌표 규약**: DB/RPC의 line/col은 전부 **0-기반** (name_line/name_col 포함). UI 표시·Monaco 전달 시에만 +1. rename 적용 payload도 0-기반.
- **ABI 운영 규칙 유지**: `npm test`=node ABI 휴지 상태. 패키징·E2E는 electron ABI 자체 처리, 종료 후 `rebuild:node`+`npm test`로 복구.
- **치환 안전선**: 위치의 텍스트가 oldName과 정확 일치할 때만 치환, 불일치는 skip 기록 (조용한 오염 금지). 파일 내 line desc → col desc 순서로 적용.
- **미확인 사용처는 기본 해제** 체크박스 그룹.
- 새 이름 검증: `/^[A-Za-z_$][A-Za-z0-9_$]*$/`.
- indexer:call 화이트리스트에 신규 읽기 메서드 추가 (getRenameTargets, getFileTokens). 쓰기(rename:apply)는 main 전용 ipc.
- 기존 테스트(90 + E2E 2) green 유지. 커밋 한국어 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. 명시적 add.

**알려진 한계 (의도된 것):**
- 로컬 변수 색칠/rename 없음 (DB 미추출). 시맨틱 색칠은 희소(정의 이름+call/extends 참조만).
- rename은 이름 기반 근사치 — 동명 혼입은 체크박스로, 미포착은 미확인 그룹으로 흡수.
- 무서명 패키지 (코드사인 없음).

---

### Task 1: 선행 수정 — setDiskContent dirty 오염 + 렌더러 typecheck 게이트

**Files:**
- Modify: `src/renderer/src/components/EditorPane.tsx` (isFlush 가드)
- Modify: `src/indexer/languages.ts` (TS1202 — import 스타일)
- Modify: `src/renderer/src/App.tsx` (onMenu .then 타입 오류)
- Modify: `package.json` (typecheck:renderer + build 통합)

**Interfaces:**
- Produces: `npm run typecheck:renderer` = `tsc -p src/renderer/tsconfig.json --noEmit` (에러 0). `build` = `tsc -p tsconfig.json && npm run typecheck:renderer && vite build`.

- [ ] **Step 1: isFlush 가드** — EditorPane의 모델 생성부 `onDidChangeContent` 콜백 최상단에:

```ts
model.onDidChangeContent((e) => {
  // setValue(디스크 리로드/setDiskContent)는 flush — 사용자 편집이 아니므로 dirty/버퍼인덱스 제외
  if (e.isFlush) return;
  useAppStore.getState().setDirty(activePath, true);
  scheduleBufferIndex(activePath, model);
});
```

- [ ] **Step 2: languages.ts import 수정 (검증 필수)**

`import Parser = require('tree-sitter');` → `import Parser from 'tree-sitter';` (esModuleInterop). **검증**: `npm run build:main`(tsc CJS) 통과 + `npx vitest run tests/native.test.ts tests/extractor.test.ts` green (Parser.Query/Language가 런타임 값으로 유지되는지 — 실패하면 이 변경을 되돌리고 렌더러 tsconfig의 include에서 인덱서 체인 제외 방식으로 전환, 보고서에 기록).

- [ ] **Step 3: App.tsx onMenu 타입 수정**

`void window.si.openFolderDialog().then((r) => r && openProject(r));` → `void window.si.openFolderDialog().then((r) => { if (r) void openProject(r); });`

- [ ] **Step 4: 스크립트 통합 + 전체 검증**

package.json: `"typecheck:renderer": "tsc -p src/renderer/tsconfig.json --noEmit"`, `"build": "tsc -p tsconfig.json && npm run typecheck:renderer && vite build"`.

Run: `npm run build && npm test`
Expected: typecheck:renderer 에러 0, 90/90.

- [ ] **Step 5: 커밋** — `git add` 4개 파일, "선행 수정: 디스크 리로드 dirty 오염 방지(isFlush) + 렌더러 typecheck 게이트"

---

### Task 2: 스키마 v3 — 심볼 이름 위치(name_line/name_col)

**Files:**
- Modify: `src/indexer/extractor.ts` (SymbolRow += nameLine/nameCol)
- Modify: `src/indexer/db.ts` (SCHEMA_VERSION=3, 컬럼 추가)
- Modify: `src/indexer/pipeline.ts` (insSym 확장)
- Modify: `src/indexer/api.ts` (SymbolHit += nameLine/nameCol, HIT_SELECT/getSubclasses SELECT 확장)
- Test: `tests/extractor-namepos.test.ts`

**Interfaces:**
- Produces: `SymbolRow`/`SymbolHit`에 `nameLine: number; nameCol: number` (0-기반, 이름 식별자 시작 위치). 모든 SymbolHit 반환 경로에 포함.

- [ ] **Step 1: 실패하는 테스트** — `tests/extractor-namepos.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { extractFile } from '../src/indexer/extractor';
import { LANGUAGES } from '../src/indexer/languages';

const lang = (id: string) => LANGUAGES.find((l) => l.id === id)!;

describe('심볼 이름 위치 (nameLine/nameCol)', () => {
  it('TS: 이름 식별자 위치는 def 노드 시작과 다르다', () => {
    const src = 'export function alpha() { return 1; }\n';
    const s = extractFile(src, lang('typescript')).symbols.find((x) => x.name === 'alpha')!;
    expect(s.nameLine).toBe(0);
    expect(s.nameCol).toBe(src.indexOf('alpha')); // 16 — 'export function ' 뒤
    expect(s.nameCol).not.toBe(s.startCol);
  });
  it('C: 함수 이름 위치', () => {
    const src = 'int main_fn() { return 0; }\n';
    const s = extractFile(src, lang('c')).symbols.find((x) => x.name === 'main_fn')!;
    expect(s.nameLine).toBe(0);
    expect(s.nameCol).toBe(4);
  });
  it('Python: 클래스 이름 위치 (둘째 줄)', () => {
    const src = '# c\nclass Foo:\n    pass\n';
    const s = extractFile(src, lang('python')).symbols.find((x) => x.name === 'Foo')!;
    expect(s.nameLine).toBe(1);
    expect(s.nameCol).toBe(6);
  });
});
```

- [ ] **Step 2: RED 확인 → 구현**

- extractor: SymbolRow에 `nameLine: number; nameCol: number;` — push 시 `nameLine: nameCap.node.startPosition.row, nameCol: nameCap.node.startPosition.column`.
- db: SCHEMA의 symbols에 `name_line INTEGER NOT NULL DEFAULT 0, name_col INTEGER NOT NULL DEFAULT 0` 추가, `SCHEMA_VERSION = 3` (주석: v3 — 심볼 이름 식별자 위치).
- pipeline: insSym INSERT 컬럼/값에 name_line/name_col 추가 (`s.nameLine, s.nameCol`).
- api: `SymbolHit`에 `nameLine: number; nameCol: number;`. HIT_SELECT에 `s.name_line AS nameLine, s.name_col AS nameCol` 추가. getSubclasses 수동 SELECT에도 동일 추가.

- [ ] **Step 3: GREEN + 전체 회귀 + 커밋**

Run: `npx vitest run tests/extractor-namepos.test.ts && npm test` → 전부 green.
Commit: "스키마 v3: 심볼 이름 식별자 위치(name_line/name_col) 추출·저장"

---

### Task 3: Rename 백엔드 — 대상 수집 + 치환 엔진

**Files:**
- Modify: `src/indexer/api.ts` (getRenameTargets)
- Create: `src/main/rename.ts` (순수 치환 엔진)
- Modify: `src/indexer/host-core.ts` + `src/shared/protocol.ts` (RPC getRenameTargets)
- Modify: `src/main/main.ts` (ipc rename:apply + indexer:call 화이트리스트 += getRenameTargets)
- Modify: `src/preload/preload.ts` (getRenameTargets/applyRename)
- Test: `tests/rename-engine.test.ts`, `tests/rename-targets.test.ts`

**Interfaces:**
- Produces (protocol.ts에 타입 배치, 0-기반):

```ts
export interface RenameOccurrence { line: number; col: number; isDefinition: boolean }
export interface RenameFileGroup { path: string; occurrences: RenameOccurrence[] }
export interface RenameTargets { groups: RenameFileGroup[]; unconfirmed: RenameFileGroup[] }
export interface RenameApplyResult { changedFiles: number; replaced: number; skipped: Array<{ path: string; line: number; col: number }> }
```

- api: `getRenameTargets(db, name): RenameTargets` — groups = 정의(nameLine/nameCol, isDefinition:true) + refs(kind call/extends, isDefinition:false), path별 그룹·(line,col) 정렬·중복 제거. unconfirmed = FTS(`file_text MATCH`)로 name 포함 파일의 content를 줄 단위 스캔, `(?<![A-Za-z0-9_$])name(?![A-Za-z0-9_$])` 발생 중 groups에 없는 것.
- main rename.ts: `applyRenameToContent(content: string, occurrences: Array<{line: number; col: number}>, oldName: string, newName: string): { content: string; replaced: number; skipped: Array<{line: number; col: number}> }` — 줄 분할, line desc→col desc, 위치 텍스트 검증.
- ipc `rename:apply (oldName, newName, targets: RenameFileGroup[])` → RenameApplyResult: 파일별 read→apply→save(ProjectFiles), 변경 파일마다 indexer `indexFile` 트리거(비동기, catch 로그). preload: `getRenameTargets(name)` (indexer:call), `applyRename(oldName, newName, targets)`.

- [ ] **Step 1: 치환 엔진 TDD** — `tests/rename-engine.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { applyRenameToContent } from '../src/main/rename';

describe('applyRenameToContent', () => {
  it('같은 줄 다중 발생 (col desc로 오프셋 보존)', () => {
    const r = applyRenameToContent('foo(foo);\n', [{ line: 0, col: 0 }, { line: 0, col: 4 }], 'foo', 'barbar');
    expect(r.content).toBe('barbar(barbar);\n');
    expect(r.replaced).toBe(2);
    expect(r.skipped).toEqual([]);
  });
  it('위치 불일치는 skip 기록', () => {
    const r = applyRenameToContent('abc def\n', [{ line: 0, col: 4 }], 'xyz', 'q');
    expect(r.content).toBe('abc def\n');
    expect(r.skipped).toEqual([{ line: 0, col: 4 }]);
  });
  it('여러 줄, 범위 밖 줄은 skip', () => {
    const r = applyRenameToContent('a\nfoo\n', [{ line: 1, col: 0 }, { line: 9, col: 0 }], 'foo', 'z');
    expect(r.content).toBe('a\nz\n');
    expect(r.replaced).toBe(1);
    expect(r.skipped).toEqual([{ line: 9, col: 0 }]);
  });
});
```

- [ ] **Step 2: 대상 수집 TDD** — `tests/rename-targets.test.ts` (tmp 프로젝트 + Indexer 인덱싱 후):

```ts
// 픽스처: a.ts `export function helper() { return 1; }`
//        b.ts `import { helper } from './a';\nexport function go() { return helper(); }\nconst alias = helper;\n`
// 기대: groups에 a.ts(정의 isDefinition:true) + b.ts(call ref) — alias 대입의 bare `helper`는 groups에 없고 unconfirmed(b.ts, 해당 위치)에 있음
// 기대: unconfirmed에는 groups와 중복 없는 위치만
```

(파일 상단 셋업은 tests/resolve.test.ts 패턴 재사용. 단언은 path/isDefinition/미포함·포함 관계를 정확히.)

- [ ] **Step 3: 구현** — api.getRenameTargets는 위 Interfaces 정의대로. FTS MATCH 인자는 searchText와 동일한 이스케이프(`"..."` 감싸기) 재사용. 스캔 정규식은 JS lookbehind 사용 (Node 22 지원).

- [ ] **Step 4: 배선** — host-core 메서드 `getRenameTargets: (p: NameParams) => queries.getRenameTargets(opened().db, p.name)`. main: INDEXER_CALL_ALLOWED += 'getRenameTargets'; ipc `rename:apply` 핸들러 (requireFiles 사용, 새 이름 검증은 UI가 하지만 main도 identifier regex 재검증 — 방어). preload 2종.

- [ ] **Step 5: 검증 + 커밋**

Run: `npx vitest run tests/rename-engine.test.ts tests/rename-targets.test.ts && npm run build && npm test`
Commit: "Smart Rename 백엔드: 대상 수집(정의+참조+FTS 미확인 스캔) + 검증 치환 엔진"

---

### Task 4: Rename UI — RenameOverlay

**Files:**
- Create: `src/renderer/src/components/RenameOverlay.tsx`
- Modify: `src/renderer/src/store.ts` (renameRequest)
- Modify: `src/renderer/src/components/EditorPane.tsx` (F2 → renameRequest)
- Modify: `src/renderer/src/App.tsx` (마운트)
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- store: `renameRequest: { name: string; path: string } | null`, `setRenameRequest` (setProject 리셋 포함).
- EditorPane: F2 addCommand — 커서 단어 있으면 `setRenameRequest({name, path})`.
- RenameOverlay 흐름: 열릴 때 `si.getRenameTargets(name)` → 파일 그룹(기본 체크) + "확인되지 않은 사용처" 그룹(기본 해제) 렌더, 각 발생에 줄 미리보기(getContent 우선, readFile 폴백; line은 0-기반이므로 `lines[occ.line]`, 표기는 `:${occ.line + 1}`). 새 이름 input (identifier regex 검증, 불일치 시 적용 버튼 비활성 + 안내). 적용 시: 체크된 그룹의 path 중 store.tabs dirty가 있으면 차단 안내("저장 후 다시 시도"). `si.applyRename(oldName, newName, checkedGroups)` → 결과 요약 (`N개 파일 M건 치환` + skipped 있으면 경고 목록) → 확인 버튼으로 닫기. Esc/백드롭 닫기(적용 전).

- [ ] **Step 1: 구현** — SearchOverlay의 구조(백드롭/박스/포커스/Esc)와 CSS 패턴을 따르되 체크박스 목록으로. 파일 그룹 헤더 체크박스는 그룹 전체 토글. 상태: `checked: Set<string>` (키 `${path}:${line}:${col}`).

- [ ] **Step 2: 검증 + 커밋**

Run: `npm run build && npm test` (상호작용은 Task 7 E2E).
Commit: "Smart Rename UI: F2 → 파일 그룹 체크박스 미리보기 + 미확인 사용처(기본 해제) + 적용 요약"

---

### Task 5: 시맨틱 토큰 (데코레이션 기반)

**Files:**
- Modify: `src/indexer/api.ts` (getRefsForFile)
- Modify: `src/indexer/host-core.ts` + `src/shared/protocol.ts` (getFileTokens RPC)
- Modify: `src/main/main.ts` (화이트리스트 += getFileTokens) + `src/preload/preload.ts`
- Create: `src/renderer/src/semantic-tokens.ts` (순수 매핑)
- Modify: `src/renderer/src/components/EditorPane.tsx` (데코 배선)
- Modify: `src/renderer/src/theme.css`
- Test: `tests/semantic-tokens.test.ts` (+ api 테스트는 rename-targets 파일에 추가 가능)

**Interfaces:**
- api: `getRefsForFile(db, relPath): Array<{name, kind, line, col}>` — `refs WHERE file_id=(files.path=?) AND kind IN ('call','extends')`.
- RPC `getFileTokens {path}` → `{ symbols: SymbolHit[]; refs: RefsForFileRow[] }` (host에서 getSymbolsForFile + getRefsForFile 합성).
- 순수 함수: `buildTokenDecorations(symbols, refs): Array<{ line: number; col: number; length: number; className: string }>` (0-기반; 호출측에서 +1):
  - kind 매핑: function/method→`sem-func`; class/struct/interface/type/enum→`sem-type`; macro→`sem-macro`; namespace→`sem-ns`; field→`sem-member`; variable→scope===''?`sem-global`:`sem-member`.
  - symbols는 (nameLine,nameCol,name.length). refs는 파일 내 심볼 name→className 맵에서 조회, 없으면 제외.
- EditorPane: 별도 `semDecorations` 컬렉션. `[activePath, outlineVersion]` effect에서 `si.getFileTokens(activePath)` → 데코 교체 (indexing 중엔 skip, cancelled 가드). 참조 하이라이트(배경)와 독립.
- CSS:

```css
.sem-func { color: #dcdcaa; } .sem-type { color: #4ec9b0; } .sem-macro { color: #c586c0; }
.sem-ns { color: #4ec9b0; } .sem-member { color: #9cdcfe; } .sem-global { color: #9cdcfe; font-weight: 600; }
```

- [ ] **Step 1: buildTokenDecorations TDD** — `tests/semantic-tokens.test.ts`: 전역 variable→sem-global, scope 있는 variable/field→sem-member, function→sem-func, ref가 파일 내 동명 심볼 클래스 상속, 미지 ref 제외.
- [ ] **Step 2: api/RPC/배선 구현** (getRefsForFile 단위 테스트는 tests/rename-targets.test.ts의 픽스처 재사용해 1케이스 추가).
- [ ] **Step 3: 검증 + 커밋**

Run: `npx vitest run tests/semantic-tokens.test.ts && npm run build && npm test`
Commit: "시맨틱 토큰: 심볼 DB 기반 데코 색칠 (전역/멤버/종류 구분)"

---

### Task 6: macOS 패키징

**Files:**
- Create: `electron-builder.yml`
- Modify: `package.json` (electron-builder devDep, package 스크립트, author/description 필드)
- Modify: `.gitignore` (release/)

**Interfaces:**
- `npm run package` = `npm run build && npm run rebuild:electron && electron-builder --mac` → `release/` 산출 (dir+dmg+zip).

- [ ] **Step 1: 구성** — `npm i -D electron-builder`. electron-builder.yml:

```yaml
appId: dev.roy.sourceinsight
productName: SourceInSight
npmRebuild: false            # 선빌드(rebuild:electron)가 electron ABI를 준비 — 기본 rebuild는 CXXFLAGS 미주입으로 실패
directories:
  output: release
files:
  - dist/**
  - package.json
asarUnpack:
  - "**/node_modules/better-sqlite3/**"
  - "**/node_modules/tree-sitter/**"
  - "**/node_modules/tree-sitter-*/**"
mac:
  target: [dir, dmg, zip]
  identity: null
  category: public.app-category.developer-tools
```

package.json: `"package": "npm run build && npm run rebuild:electron && electron-builder --mac"`, author/description 최소 필드. .gitignore에 `release/`.

- [ ] **Step 2: 패키징 실행 + 실증 (필수)**

```bash
npm run package
mkdir -p /tmp/si-pkg/proj && printf 'int main() { return 0; }\n' > /tmp/si-pkg/proj/main.c
SI_SMOKE=1 SI_OPEN_PROJECT=/tmp/si-pkg/proj SI_USER_DATA=/tmp/si-pkg/ud \
  "release/mac-arm64/SourceInSight.app/Contents/MacOS/SourceInSight" ; echo "exit=$?"
```
Expected: `[smoke] {"files":1,...}` + exit=0 (경로의 mac-arm64는 실제 산출 디렉터리명에 맞출 것). 실패 시 asar unpack/모듈 로드 오류를 실제로 디버그 — 가짜 통과 금지.

- [ ] **Step 3: 휴지 상태 복구 + 커밋**

`npm run rebuild:node && npm test` → 전부 green.
Commit: "macOS 패키징: electron-builder(npmRebuild:false, 네이티브 선빌드) + 패키지드 SI_SMOKE 실증"

---

### Task 7: E2E rename 흐름 + todo.md 마감

**Files:**
- Create: `tests/e2e/rename.spec.ts`
- Modify: `todo.md`

- [ ] **Step 1: E2E** — 기존 analysis.spec.ts 패턴 (try/finally, SI_OPEN_PROJECT). 픽스처: util.c(`int helper_fn() {...}`) + main.c(호출). 흐름: main.c 열기 → 아웃라인 대기 → helper_fn 위 커서 클릭 → F2 → 오버레이 표시 → 새 이름 `helper_renamed` 입력 → 적용 → 요약 확인/닫기 → 디스크 두 파일에 `helper_renamed` 존재(fs 단언) → 에디터 버퍼도 갱신(`.editor-host` contains) → 아웃라인에 helper_renamed. 셀렉터가 실제 컴포넌트와 어긋나면 앱의 올바른 동작에 맞춰 조정+기록.
- [ ] **Step 2: `npm run test:e2e`** — 3 specs 전부 pass. 이후 `npm run rebuild:node && npm test` 복구.
- [ ] **Step 3: todo.md** — Plan 4 섹션 완료 표기 (패키징은 "macOS만, 무서명" 명시 — 과장 금지). "Plan 5 인계 노트": (1) AI 자동완성은 additive 모듈 (스펙 §7) — 인덱서/DB 무변경, (2) API 키 safeStorage는 main 전용, provider 미설정 시 완전 비활성, (3) ContextBuilder가 쓸 심볼 시그니처 조회는 기존 api로 충분, (4) ABI/패키징 운영 규칙 재확인, (5) 렌더러 typecheck 게이트 존재 — 신규 컴포넌트도 통과 필요.
- [ ] **Step 4: 커밋** — "Smart Rename E2E + todo.md Plan 4 완료 표기"
