# Plan 3: 분석 기능 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 해석 모듈 + Context/Relation Window + 통합 검색 + 내비게이션 + 북마크 + 유휴 재파싱 — Source Insight 핵심 분석 기능 완성.

**Architecture:** 스키마 v2로 import/extends 관계를 추출하고, 격리된 해석 모듈(resolve.ts)이 이름→후보 심볼을 신뢰도 순으로 반환한다. 렌더러는 커서 심볼 상태(cursorSymbol)를 축으로 Context/Relation을 갱신하고, 내비게이션 히스토리·검색 오버레이·북마크가 jumpTo 유틸로 수렴한다. 스펙: `docs/superpowers/specs/2026-07-17-plan3-analysis-design.md`.

**Tech Stack:** 기존 스택 그대로 (tree-sitter Query API, better-sqlite3, Monaco, zustand). 신규 의존성 없음.

## Global Constraints

- **tree-sitter Query API만 사용, WASM 폴백 금지** (상위 스펙 §3.1). JS 트리 순회 금지.
- **문법 검증 우선**: Task 1의 신규 쿼리는 설치된 문법 버전의 실제 노드/필드명에 의존 — 픽스처 TDD로 검증하고, 노드명이 다르면 **쿼리를 조정하되 캡처 이름(`@ref.import`/`@ref.extends`)과 시맨틱은 유지**하고 조정 내역을 보고서에 기록.
- **ABI 이중성 운영 규칙**: `npm test`는 node ABI. Electron 실행/E2E는 electron ABI (`npm run test:e2e`는 자체 리빌드 포함; 수동 실행은 `rebuild:electron` → 실행 → `rebuild:node`). **휴지 상태는 항상 node ABI + `npm test` green.**
- **단일 연결 불변식**: 증분/버퍼/워처 인덱싱은 인덱서 host의 단일 better-sqlite3 연결에서 직렬 수행.
- **경로 규약**: 렌더러↔main↔인덱서 파일 경로는 프로젝트 루트 기준 `/` 구분자 rel.
- **기존 테스트 유지**: 현재 61개 + E2E 1개. 태스크마다 `npm test` green.
- **RPC**: 새 메서드는 main의 일반 릴레이 `indexer:call` (화이트리스트) 경유, 타임아웃 180초.
- **커밋 메시지는 한국어**, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 트레일러. 파일 명시적 add (`git add -A` 금지 — `.omc/` untracked 유지).
- **성능 예산** (상위 스펙 §10): 심볼 검색/해석 응답 < 50ms (resolve의 import 매칭은 fromPath 한 파일의 import에 한정).

**알려진 한계 (의도된 것 — 구현하지 말 것):**
- 변수→타입 선언 추적 없음 (로컬 변수 미추출 — v2 LSP). Context는 이름의 정의만.
- References는 동명 전체 (해석 필터 없음) — 후보 수 표시로 흡수.
- Relation 트리는 초기 깊이 1 로드 + 확장 시 지연 로드 (스펙의 "깊이 3"은 성능 제어 목적 — RPC 폭발 방지를 위해 지연 로드로 동일 목적 달성, visited 가드로 순환 차단).
- 더블클릭 정의 점프 없음 (Ctrl/Cmd+클릭 + F12). Backspace 백은 에디터 포커스 밖에서만.

---

### Task 1: 추출기 ref.* 일반화 + 스키마 v2 + 6언어 import/extends 쿼리

**Files:**
- Modify: `src/indexer/extractor.ts` (RefRow.kind 일반화)
- Modify: `src/indexer/languages.ts` (쿼리 확장)
- Modify: `src/indexer/db.ts` (SCHEMA_VERSION 2)
- Test: `tests/extractor-relations.test.ts`

**Interfaces:**
- Produces: `RefRow.kind: 'call' | 'import' | 'extends'`. refs 테이블에 kind='import'(name=모듈/경로 문자열, 따옴표·꺾쇠 제거) / kind='extends'(name=부모 타입명, enclosing=자식 클래스 심볼) 행. 기존 'call' 동작 불변.
- Consumes: pipeline.ts의 insRef는 이미 r.kind를 그대로 삽입 — 무변경.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/extractor-relations.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { extractFile } from '../src/indexer/extractor';
import { LANGUAGES } from '../src/indexer/languages';

const lang = (id: string) => LANGUAGES.find((l) => l.id === id)!;
const refsOf = (src: string, id: string, kind: string) =>
  extractFile(src, lang(id)).refs.filter((r) => r.kind === kind).map((r) => r.name);

describe('imports 추출', () => {
  it('C: 로컬/시스템 include (따옴표·꺾쇠 제거)', () => {
    const src = '#include "util.h"\n#include <stdio.h>\nint main() { return 0; }\n';
    expect(refsOf(src, 'c', 'import').sort()).toEqual(['stdio.h', 'util.h']);
  });
  it('TS: import/export-from 소스 (따옴표 제거)', () => {
    const src = `import { a } from './a';\nexport { b } from '../lib/b';\nconst x = 1;\n`;
    expect(refsOf(src, 'typescript', 'import').sort()).toEqual(['../lib/b', './a']);
  });
  it('Python: import / from-import (상대 포함)', () => {
    const src = 'import os.path\nfrom mypkg.mod import thing\n';
    expect(refsOf(src, 'python', 'import').sort()).toEqual(['mypkg.mod', 'os.path']);
  });
  it('Java: import 선언', () => {
    const src = 'import java.util.List;\nclass A {}\n';
    expect(refsOf(src, 'java', 'import')).toEqual(['java.util.List']);
  });
});

describe('extends 추출 (enclosing = 자식 클래스)', () => {
  it('TS: extends + implements, 제네릭 부모', () => {
    const src = `class Base<T> {}\ninterface IFoo {}\nclass Child extends Base<number> implements IFoo { m() { return 1; } }\n`;
    const res = extractFile(src, lang('typescript'));
    const ext = res.refs.filter((r) => r.kind === 'extends');
    const names = ext.map((r) => r.name).sort();
    expect(names).toEqual(['Base', 'IFoo']);
    // enclosing이 자식 클래스(Child)인지 — enclosingIndex → symbols
    for (const r of ext) {
      expect(r.enclosingIndex).not.toBeNull();
      expect(res.symbols[r.enclosingIndex!].name).toBe('Child');
    }
  });
  it('Java: superclass + interface', () => {
    const src = 'class Base {}\ninterface IFoo {}\nclass Child extends Base implements IFoo {}\n';
    expect(refsOf(src, 'java', 'extends').sort()).toEqual(['Base', 'IFoo']);
  });
  it('C++: base_class_clause', () => {
    const src = 'class Base {};\nclass Child : public Base { int x; };\n';
    expect(refsOf(src, 'cpp', 'extends')).toEqual(['Base']);
  });
  it('Python: superclass (qualified는 최내부 식별자)', () => {
    const src = 'class Base:\n    pass\n\nclass Child(Base):\n    pass\n';
    expect(refsOf(src, 'python', 'extends')).toEqual(['Base']);
  });
});

describe('기존 call 추출 회귀 없음', () => {
  it('C: call refs 유지', () => {
    const src = 'int helper() { return 1; }\nint main() { return helper(); }\n';
    expect(refsOf(src, 'c', 'call')).toContain('helper');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/extractor-relations.test.ts`
Expected: FAIL — import/extends refs가 빈 배열 (쿼리·kind 미구현).

- [ ] **Step 3: extractor 일반화** — `src/indexer/extractor.ts` 수정

RefRow.kind 타입 확장 및 ref 수집 일반화:

```ts
export type RefKind = 'call' | 'import' | 'extends';

export interface RefRow {
  name: string;
  kind: RefKind;
  line: number;
  col: number;
  enclosingIndex: number | null;
}
```

match 루프의 `refCap` 처리를 일반화 (기존 `c.name === 'ref.call'` → `startsWith('ref.')`):

```ts
const refCap = match.captures.find((c) => c.name.startsWith('ref.'));
// ...
} else if (refCap) {
  const kind = refCap.name.slice(4) as RefKind;
  // import 대상은 따옴표/꺾쇠를 제거해 순수 경로/모듈 문자열로 정규화
  const text = kind === 'import' ? refCap.node.text.replace(/^["'<]+|[">']+$/g, '') : refCap.node.text;
  rawRefs.push({ name: text, kind, line: refCap.node.startPosition.row, col: refCap.node.startPosition.column });
}
```

rawRefs 타입에 `kind: RefKind` 추가, 최종 매핑에서 `kind: r.kind`로 운반 (기존 `kind: 'call'` 하드코딩 제거). enclosing 계산은 기존 containsPoint 로직 그대로 — extends의 부모 식별자는 자식 클래스 def 범위 안이므로 자동으로 자식 클래스가 enclosing이 된다.

- [ ] **Step 4: 언어 쿼리 확장** — `src/indexer/languages.ts`

각 쿼리 문자열 끝에 추가. **아래는 설치된 문법(0.23.x) 기준 초안 — Step 5에서 테스트가 실패하면 `getParser(spec).parse(src)` 결과를 덤프해 실제 노드/필드명으로 조정하고 보고서에 기록** (캡처 이름과 시맨틱은 유지):

C_QUERY 추가:
```
(preproc_include path: (string_literal) @ref.import)
(preproc_include path: (system_lib_string) @ref.import)
```

TS_QUERY 추가 (typescript/tsx 공용):
```
(import_statement source: (string) @ref.import)
(export_statement source: (string) @ref.import)
(class_declaration (class_heritage (extends_clause value: (identifier) @ref.extends)))
(class_declaration (class_heritage (implements_clause (type_identifier) @ref.extends)))
(interface_declaration (extends_type_clause (type_identifier) @ref.extends))
```
주의: `extends Base<number>`는 extends_clause의 value가 `generic_type`/`instantiation_expression`일 수 있음 — 그 경우 `value: (_ (identifier) @ref.extends)` 또는 별도 패턴 추가로 최내부 식별자를 캡처.

CPP_QUERY 추가:
```
(preproc_include path: (string_literal) @ref.import)
(preproc_include path: (system_lib_string) @ref.import)
(base_class_clause (type_identifier) @ref.extends)
```

PY_QUERY 추가:
```
(import_statement name: (dotted_name) @ref.import)
(import_from_statement module_name: (dotted_name) @ref.import)
(import_from_statement module_name: (relative_import) @ref.import)
(class_definition superclasses: (argument_list (identifier) @ref.extends))
(class_definition superclasses: (argument_list (attribute attribute: (identifier) @ref.extends)))
```

JAVA_QUERY 추가:
```
(import_declaration (scoped_identifier) @ref.import)
(class_declaration superclass: (superclass (type_identifier) @ref.extends))
(class_declaration interfaces: (super_interfaces (type_list (type_identifier) @ref.extends)))
```

`import a as b` (python aliased), scoped generic 부모 등 변형은 테스트 픽스처 범위만 통과하면 됨 — 완전성보다 시맨틱 유지.

- [ ] **Step 5: 스키마 버전 승격** — `src/indexer/db.ts`

```ts
export const SCHEMA_VERSION = 2; // v2: refs.kind에 'import'/'extends' 추가 (구조 동일, 재인덱싱 강제)
```

- [ ] **Step 6: 통과 확인 + 전체 회귀**

Run: `npx vitest run tests/extractor-relations.test.ts && npm test`
Expected: 신규 전부 PASS + 기존 61개 green (스키마 재구축은 openDb가 자동 처리 — db.test.ts가 이미 커버).

- [ ] **Step 7: 커밋**

```bash
git add src/indexer/extractor.ts src/indexer/languages.ts src/indexer/db.ts tests/extractor-relations.test.ts
git commit -m "추출기 확장: ref.* 일반화 + 6언어 import/extends 캡처 + 스키마 v2"
```

---

### Task 2: 유휴 재파싱 — indexBuffer 경로 + source 플래그

**Files:**
- Modify: `src/indexer/pipeline.ts` (indexContent 분리)
- Modify: `src/indexer/host-core.ts` (indexBuffer RPC + source 플래그)
- Modify: `src/shared/protocol.ts` (FileIndexedPayload.source, IndexBufferParams)
- Modify: `src/main/main.ts` (indexer:indexBuffer 릴레이)
- Modify: `src/preload/preload.ts` (indexBuffer)
- Modify: `src/renderer/src/App.tsx` (source==='buffer' 처리 규칙)
- Modify: `src/renderer/src/components/EditorPane.tsx` (500ms 디바운스 indexBuffer)
- Test: `tests/pipeline.test.ts`에 추가, `tests/host.test.ts`에 추가

**Interfaces:**
- Produces: `Indexer.indexContent(relPath: string, content: string): boolean` (해시 가드 동일). RPC `indexBuffer {path, content}` → `{indexed}`. `FileIndexedPayload { path, source?: 'buffer' | 'disk' }` — indexFile/워처는 'disk', indexBuffer는 'buffer'. preload `indexBuffer(rel, content): Promise<{indexed: boolean}>`.
- 렌더러 규칙: `source==='buffer'`인 fileIndexed는 **dirty/디스크 리로드 블록 전체를 건너뛰고** 아웃라인/분석 갱신만. PROTOCOL_VERSION 불변 (동시 배포).

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/pipeline.test.ts`에 append

```ts
describe('indexContent (버퍼 인덱싱)', () => {
  it('문자열로 인덱싱하고 해시 가드가 동작한다', () => {
    // 기존 픽스처 스타일 재사용: tmp 프로젝트 + openDb(':memory:' 불가 — 파일 경로) 패턴은 파일 상단 기존 테스트와 동일하게 구성
    // (구체 픽스처 셋업은 이 파일의 기존 beforeAll 패턴을 따를 것)
    const rel = 'buf.ts';
    const c1 = 'export function alpha() { return 1; }\n';
    expect(indexer.indexContent(rel, c1)).toBe(true);
    expect(indexer.indexContent(rel, c1)).toBe(false); // 동일 해시 스킵
    const c2 = c1 + 'export function beta() { return 2; }\n';
    expect(indexer.indexContent(rel, c2)).toBe(true);
    const names = db.prepare(`SELECT s.name FROM symbols s JOIN files f ON f.id=s.file_id WHERE f.path=?`).all(rel).map((r: any) => r.name);
    expect(names).toContain('beta');
    // FTS도 갱신
    const fts = db.prepare(`SELECT path FROM file_text WHERE file_text MATCH 'beta'`).all();
    expect(fts.length).toBeGreaterThan(0);
  });
});
```

(pipeline.test.ts의 기존 db/indexer 셋업 변수명에 맞춰 조정 — 테스트 의도는 위 그대로.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/pipeline.test.ts`
Expected: FAIL — indexContent 없음.

- [ ] **Step 3: pipeline 분리** — `src/indexer/pipeline.ts`

`indexFile`을 읽기+위임으로 분리 (동작 불변):

```ts
/** @returns true면 인덱싱함, false면 해시 동일로 스킵 */
indexFile(absPath: string): boolean {
  const spec = languageForPath(absPath);
  if (!spec) return false;
  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf8');
  } catch {
    return false;
  }
  return this.indexContent(this.toRel(absPath), content);
}

/** 디스크 대신 주어진 내용으로 인덱싱 (유휴 재파싱용). 해시 가드 동일 — 저장 시 indexFile과 자연 수렴. */
indexContent(relPath: string, content: string): boolean {
  const spec = languageForPath(relPath);
  if (!spec) return false;
  const hash = crypto.createHash('sha1').update(content).digest('hex');
  // ...기존 indexFile 본문의 rel/hash 이후 로직을 그대로 이동 (existing 조회부터 tx()까지, rel → relPath)
}
```

- [ ] **Step 4: 프로토콜 + host** 

`src/shared/protocol.ts`:

```ts
export interface FileIndexedPayload {
  path: string;
  source?: 'buffer' | 'disk'; // 생략 시 'disk'
}
export interface IndexBufferParams { path: string; content: string }
```

`src/indexer/host-core.ts`:
- 기존 fileIndexed emit 3곳(워처 add/change, indexFile RPC)에 `source: 'disk'` 명시.
- 메서드 추가:

```ts
indexBuffer(params: IndexBufferParams) {
  const changed = opened().indexer.indexContent(params.path, params.content);
  if (changed) server.emit('fileIndexed', { path: params.path, source: 'buffer' });
  return { indexed: changed };
},
```

- [ ] **Step 5: host 테스트 추가** — `tests/host.test.ts` 기존 테스트 내 indexFile 검증 뒤에 append

```ts
// indexBuffer: 디스크 미저장 내용 인덱싱 + source:'buffer' 이벤트
const res3 = await rpc.request<{ indexed: boolean }>('indexBuffer', {
  path: 'a.ts',
  content: 'export function alpha() { return 1; }\nexport function beta() { return 2; }\nexport function gamma() { return 3; }\n',
});
expect(res3.indexed).toBe(true);
expect(events.some((e) => e.event === 'fileIndexed' && (e.payload as { source?: string }).source === 'buffer')).toBe(true);
const outline3 = await rpc.request<SymbolHit[]>('getFileOutline', { path: 'a.ts' });
expect(outline3.map((s) => s.name)).toContain('gamma');
```

- [ ] **Step 6: main/preload/렌더러 배선**

`src/main/main.ts` registerIpc에 추가:

```ts
ipcMain.handle('indexer:indexBuffer', (_e, rel: string, content: string) => {
  if (!indexer) return { indexed: false }; // 인덱서 없으면 조용히 무시 (편집은 계속 가능)
  return indexer.rpc.request('indexBuffer', { path: rel, content }, { timeoutMs: 180_000 });
});
```

`src/preload/preload.ts` api에 추가:

```ts
indexBuffer: (rel: string, content: string): Promise<{ indexed: boolean }> =>
  ipcRenderer.invoke('indexer:indexBuffer', rel, content),
```

`src/renderer/src/App.tsx` — handleIndexerEvent의 fileIndexed/fileRemoved 분기 최상단에 buffer 단락 추가 (현재 파일 구조에 맞춰 적용):

```ts
if (event === 'fileIndexed' || event === 'fileRemoved') {
  const payload2 = payload as FileIndexedPayload;
  const p = payload2.path;
  // 버퍼 인덱싱 유래 — dirty/디스크 리로드 블록 전체 스킵 (자기 타이핑이 ⚠를 만들면 안 됨)
  if (payload2.source === 'buffer') {
    if (p === st.activePath) st.bumpOutline();
    return;
  }
  // ...기존 disk 로직 그대로
```

`src/renderer/src/components/EditorPane.tsx` — 모델 생성부의 `onDidChangeContent` 콜백 확장 (경로별 타이머):

```ts
const bufferTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleBufferIndex(relPath: string, model: import('monaco-editor').editor.ITextModel): void {
  const prev = bufferTimers.get(relPath);
  if (prev) clearTimeout(prev);
  bufferTimers.set(relPath, setTimeout(() => {
    bufferTimers.delete(relPath);
    if (model.isDisposed()) return;
    void window.si.indexBuffer(relPath, model.getValue()).catch(() => {});
  }, 500));
}
```

기존 `model.onDidChangeContent(() => useAppStore.getState().setDirty(activePath, true));`를 다음으로:

```ts
model.onDidChangeContent(() => {
  useAppStore.getState().setDirty(activePath, true);
  scheduleBufferIndex(activePath, model); // 500ms 유휴 재파싱 (스펙 §8)
});
```

- [ ] **Step 7: 검증 + 커밋**

Run: `npx vitest run tests/pipeline.test.ts tests/host.test.ts && npm run build && npm test`
Expected: 전부 PASS.

```bash
git add src/indexer/pipeline.ts src/indexer/host-core.ts src/shared/protocol.ts src/main/main.ts src/preload/preload.ts src/renderer/src/App.tsx src/renderer/src/components/EditorPane.tsx tests/pipeline.test.ts tests/host.test.ts
git commit -m "유휴 재파싱: indexBuffer 경로(500ms 디바운스) + fileIndexed source 플래그"
```

---

### Task 3: 해석 모듈 + 쿼리 API 확장 + indexer:call 릴레이

**Files:**
- Create: `src/indexer/resolve.ts`
- Modify: `src/indexer/api.ts` (getReferences/getSuperclasses/getSubclasses/RefHit)
- Modify: `src/indexer/host-core.ts` (RPC 4종 추가)
- Modify: `src/shared/protocol.ts` (ResolveParams)
- Modify: `src/main/main.ts` (indexer:call 화이트리스트 릴레이)
- Modify: `src/preload/preload.ts` (resolve/getReferences/getSuperclasses/getSubclasses/searchSymbols/searchText)
- Test: `tests/resolve.test.ts`, `tests/api-relations.test.ts`

**Interfaces:**
- Produces:
  - `resolveSymbol(db, name, fromPath): Candidate[]` — `Candidate = SymbolHit & { confidence: 'same-file' | 'imported' | 'global' }`, 신뢰도→kind 우선순위→경로 순 정렬
  - `getReferences(db, name, limit=200): RefHit[]` — `RefHit { name, kind, path, line, col, enclosingName: string | null }`, kind IN ('call','extends')
  - `getSuperclasses(db, symbolId): SymbolHit[]`, `getSubclasses(db, name): SymbolHit[]`
  - RPC: `resolve {name, fromPath}` / `getReferences {name}` / `getSuperclasses {symbolId}` / `getSubclasses {name}`
  - main ipc `indexer:call (method, params)` — 화이트리스트: resolve, getReferences, getSuperclasses, getSubclasses, searchSymbols, searchText. 타임아웃 180s.
  - preload: `resolve(name, fromPath)`, `getReferences(name)`, `getSuperclasses(symbolId)`, `getSubclasses(name)`, `searchSymbols(query)`, `searchText(query)`
- Consumes: Task 1의 refs kind='import'/'extends'.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/resolve.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openDb } from '../src/indexer/db';
import { Indexer } from '../src/indexer/pipeline';
import { resolveSymbol } from '../src/indexer/resolve';
import type { Database } from 'better-sqlite3';

let work: string;
let db: Database;

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-resolve-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(path.join(proj, 'lib'), { recursive: true });
  // helper가 3곳에 정의: 같은 파일(main.ts), import된 파일(lib/util.ts), 무관 파일(other.ts)
  fs.writeFileSync(path.join(proj, 'main.ts'),
    `import { thing } from './lib/util';\nfunction helper() { return 1; }\nfunction go() { return helper(); }\n`);
  fs.writeFileSync(path.join(proj, 'lib', 'util.ts'),
    `export function helper() { return 2; }\nexport function thing() { return helper(); }\n`);
  fs.writeFileSync(path.join(proj, 'other.ts'), `export function helper() { return 3; }\n`);
  db = openDb(path.join(work, 'test.db'));
  new Indexer(db, proj).indexProject();
});
afterAll(() => { db.close(); fs.rmSync(work, { recursive: true, force: true }); });

describe('resolveSymbol 우선순위', () => {
  it('같은 파일 > import된 파일 > 전역', () => {
    const cands = resolveSymbol(db, 'helper', 'main.ts');
    expect(cands.length).toBe(3);
    expect(cands[0].path).toBe('main.ts');
    expect(cands[0].confidence).toBe('same-file');
    expect(cands[1].path).toBe('lib/util.ts');
    expect(cands[1].confidence).toBe('imported');
    expect(cands[2].path).toBe('other.ts');
    expect(cands[2].confidence).toBe('global');
  });
  it('import 파일에서 조회하면 그 파일이 same-file', () => {
    const cands = resolveSymbol(db, 'helper', 'lib/util.ts');
    expect(cands[0].path).toBe('lib/util.ts');
  });
  it('없는 이름은 빈 배열', () => {
    expect(resolveSymbol(db, 'nope', 'main.ts')).toEqual([]);
  });
  it('basename 폴백: 상대경로가 아닌 import도 파일 매칭', () => {
    // main.ts에 상대 import만 있으므로 lib/util.ts가 imported로 잡히는 것 자체가 상대경로 해석 검증.
    // basename 폴백은 C 스타일 include로 검증:
    const proj2 = path.join(work, 'proj2');
    fs.mkdirSync(path.join(proj2, 'inc'), { recursive: true });
    fs.writeFileSync(path.join(proj2, 'main.c'), '#include "util.h"\nint go() { return helper(); }\n');
    fs.writeFileSync(path.join(proj2, 'inc', 'util.h'), 'int helper();\n#define UTIL_H 1\n');
    fs.writeFileSync(path.join(proj2, 'inc', 'other.h'), 'int helper();\n');
    const db2 = openDb(path.join(work, 'test2.db'));
    new Indexer(db2, proj2).indexProject();
    const cands = resolveSymbol(db2, 'helper', 'main.c');
    // "util.h"는 main.c 옆에 없으므로 basename 매칭으로 inc/util.h가 imported
    const imported = cands.filter((c) => c.confidence === 'imported').map((c) => c.path);
    expect(imported).toContain('inc/util.h');
    db2.close();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/resolve.test.ts`
Expected: FAIL — resolve 모듈 없음.

- [ ] **Step 3: 구현** — `src/indexer/resolve.ts`

```ts
import type { Database } from 'better-sqlite3';
import * as path from 'path';
import { getDefinitions, SymbolHit } from './api';

export type Confidence = 'same-file' | 'imported' | 'global';

export interface Candidate extends SymbolHit {
  confidence: Confidence;
}

// 정의 kind 우선순위 (동일 신뢰도 내 정렬)
const KIND_ORDER = ['function', 'method', 'class', 'struct', 'interface', 'type', 'enum', 'namespace', 'variable', 'field', 'macro'];
const kindRank = (k: string) => {
  const i = KIND_ORDER.indexOf(k);
  return i === -1 ? KIND_ORDER.length : i;
};

const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.java', '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh'];

/** fromPath의 import 문자열 하나를 프로젝트 rel 파일 경로들로 휴리스틱 매칭 */
export function matchImport(db: Database, imp: string, fromPath: string): string[] {
  const out = new Set<string>();
  const byPath = db.prepare(`SELECT path FROM files WHERE path = ?`);
  const bySuffix = db.prepare(`SELECT path FROM files WHERE path LIKE ?`);
  const tryExact = (p: string) => {
    const norm = path.posix.normalize(p);
    if ((byPath.get(norm) as { path: string } | undefined)) out.add(norm);
  };
  if (imp.startsWith('./') || imp.startsWith('../')) {
    const base = path.posix.join(path.posix.dirname(fromPath), imp);
    tryExact(base);
    for (const e of EXTS) tryExact(base + e);
    tryExact(base + '/index.ts');
    tryExact(base + '/index.js');
  } else {
    // 비상대: basename 매칭 — C include("util.h"), Java(a.b.C), Python(a.b) 등
    const lastSeg = imp.split('/').pop()!;
    const hasExt = /\.[a-z]+$/i.test(lastSeg);
    if (hasExt) {
      for (const row of bySuffix.all(`%/${lastSeg}`) as { path: string }[]) out.add(row.path);
      tryExact(lastSeg); // 루트 직속
    } else {
      const dotted = lastSeg.split('.').pop()!; // java.util.List → List / os.path → path
      for (const e of EXTS) {
        for (const row of bySuffix.all(`%/${dotted}${e}`) as { path: string }[]) out.add(row.path);
        tryExact(`${dotted}${e}`);
      }
    }
  }
  out.delete(fromPath);
  return [...out];
}

/** 이름 → 후보 심볼, 신뢰도 순 (스펙 §5 A안: 같은 파일 → import 연결 → 전역) */
export function resolveSymbol(db: Database, name: string, fromPath: string): Candidate[] {
  const defs = getDefinitions(db, name);
  if (defs.length === 0) return [];
  const imports = (
    db
      .prepare(`SELECT r.name FROM refs r JOIN files f ON f.id = r.file_id WHERE f.path = ? AND r.kind = 'import'`)
      .all(fromPath) as { name: string }[]
  ).map((r) => r.name);
  const importedFiles = new Set<string>();
  for (const imp of imports) for (const p of matchImport(db, imp, fromPath)) importedFiles.add(p);

  const conf = (d: SymbolHit): Confidence =>
    d.path === fromPath ? 'same-file' : importedFiles.has(d.path) ? 'imported' : 'global';
  const CONF_RANK: Record<Confidence, number> = { 'same-file': 0, imported: 1, global: 2 };

  return defs
    .map((d) => ({ ...d, confidence: conf(d) }))
    .sort(
      (a, b) =>
        CONF_RANK[a.confidence] - CONF_RANK[b.confidence] ||
        kindRank(a.kind) - kindRank(b.kind) ||
        a.path.localeCompare(b.path) ||
        a.line - b.line,
    );
}
```

- [ ] **Step 4: api 확장 테스트** — `tests/api-relations.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openDb } from '../src/indexer/db';
import { Indexer } from '../src/indexer/pipeline';
import { getReferences, getSuperclasses, getSubclasses, getSymbolsForFile } from '../src/indexer/api';
import type { Database } from 'better-sqlite3';

let work: string;
let db: Database;

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-apirel-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'h.ts'),
    `export class Base {}\nexport class Mid extends Base {}\nexport class Leaf extends Mid {}\nexport function useIt() { const m = new Mid(); return m; }\n`);
  db = openDb(path.join(work, 'test.db'));
  new Indexer(db, proj).indexProject();
});
afterAll(() => { db.close(); fs.rmSync(work, { recursive: true, force: true }); });

describe('클래스 계층', () => {
  it('getSubclasses: Base의 자식은 Mid', () => {
    expect(getSubclasses(db, 'Base').map((s) => s.name)).toEqual(['Mid']);
  });
  it('getSuperclasses: Mid의 부모는 Base', () => {
    const mid = getSymbolsForFile(db, 'h.ts').find((s) => s.name === 'Mid')!;
    expect(getSuperclasses(db, mid.id).map((s) => s.name)).toEqual(['Base']);
  });
});

describe('getReferences', () => {
  it('call + extends 동명 참조를 파일/줄과 함께 반환', () => {
    const refs = getReferences(db, 'Mid');
    const kinds = refs.map((r) => r.kind).sort();
    expect(kinds).toContain('extends'); // Leaf extends Mid
    expect(kinds).toContain('call');    // new Mid()
    for (const r of refs) expect(r.path).toBe('h.ts');
  });
});
```

- [ ] **Step 5: api 구현** — `src/indexer/api.ts`에 추가

```ts
export interface RefHit {
  name: string;
  kind: string;
  path: string;
  line: number;
  col: number;
  enclosingName: string | null;
}

export function getReferences(db: Database, name: string, limit = 200): RefHit[] {
  return db
    .prepare(
      `SELECT r.name, r.kind, f.path, r.line, r.col, es.name AS enclosingName
       FROM refs r
       JOIN files f ON f.id = r.file_id
       LEFT JOIN symbols es ON es.id = r.enclosing_symbol_id
       WHERE r.name = ? AND r.kind IN ('call','extends')
       ORDER BY f.path, r.line LIMIT ?`,
    )
    .all(name, limit) as RefHit[];
}

const CLASS_KINDS = `('class','struct','interface')`;

export function getSuperclasses(db: Database, symbolId: number): SymbolHit[] {
  return db
    .prepare(
      `${HIT_SELECT} WHERE s.name IN (
         SELECT DISTINCT r.name FROM refs r WHERE r.enclosing_symbol_id = ? AND r.kind = 'extends'
       ) AND s.kind IN ${CLASS_KINDS} ORDER BY s.name`,
    )
    .all(symbolId) as SymbolHit[];
}

export function getSubclasses(db: Database, name: string): SymbolHit[] {
  return db
    .prepare(
      `SELECT DISTINCT s.id, s.name, s.kind, s.scope, s.signature, s.start_line AS line, f.path
       FROM refs r
       JOIN symbols s ON s.id = r.enclosing_symbol_id
       JOIN files f ON f.id = s.file_id
       WHERE r.kind = 'extends' AND r.name = ? AND s.kind IN ${CLASS_KINDS}
       ORDER BY s.name`,
    )
    .all(name) as SymbolHit[];
}
```

- [ ] **Step 6: host/protocol/main/preload 배선**

`src/shared/protocol.ts`:

```ts
export interface ResolveParams { name: string; fromPath: string }
```

`src/indexer/host-core.ts` — import에 `resolveSymbol` 추가, 메서드 4종:

```ts
resolve: (p: ResolveParams) => resolveSymbol(opened().db, p.name, p.fromPath),
getReferences: (p: NameParams) => queries.getReferences(opened().db, p.name),
getSuperclasses: (p: SymbolIdParams) => queries.getSuperclasses(opened().db, p.symbolId),
getSubclasses: (p: NameParams) => queries.getSubclasses(opened().db, p.name),
```

`src/main/main.ts` registerIpc에 일반 릴레이 추가:

```ts
const INDEXER_CALL_ALLOWED = new Set([
  'resolve', 'getReferences', 'getSuperclasses', 'getSubclasses',
  'searchSymbols', 'searchText', 'getCallers', 'getCallees',
]);
ipcMain.handle('indexer:call', (_e, method: string, params: unknown) => {
  if (!INDEXER_CALL_ALLOWED.has(method)) throw new Error(`허용되지 않은 메서드: ${method}`);
  if (!indexer) throw new Error('인덱서가 실행 중이 아닙니다');
  return indexer.rpc.request(method, params, { timeoutMs: 180_000 });
});
```

`src/preload/preload.ts` api에 추가 (타입은 api.ts/resolve.ts에서 type-only import):

```ts
resolve: (name: string, fromPath: string): Promise<Candidate[]> =>
  ipcRenderer.invoke('indexer:call', 'resolve', { name, fromPath }),
getReferences: (name: string): Promise<RefHit[]> =>
  ipcRenderer.invoke('indexer:call', 'getReferences', { name }),
getSuperclasses: (symbolId: number): Promise<SymbolHit[]> =>
  ipcRenderer.invoke('indexer:call', 'getSuperclasses', { symbolId }),
getSubclasses: (name: string): Promise<SymbolHit[]> =>
  ipcRenderer.invoke('indexer:call', 'getSubclasses', { name }),
searchSymbols: (query: string): Promise<SymbolHit[]> =>
  ipcRenderer.invoke('indexer:call', 'searchSymbols', { query }),
searchText: (query: string): Promise<TextHit[]> =>
  ipcRenderer.invoke('indexer:call', 'searchText', { query }),
getCallers: (name: string): Promise<CallerHit[]> =>
  ipcRenderer.invoke('indexer:call', 'getCallers', { name }),
getCallees: (symbolId: number): Promise<SymbolHit[]> =>
  ipcRenderer.invoke('indexer:call', 'getCallees', { symbolId }),
```

- [ ] **Step 7: 검증 + 커밋**

Run: `npx vitest run tests/resolve.test.ts tests/api-relations.test.ts && npm run build && npm test`
Expected: 전부 PASS.

```bash
git add src/indexer/resolve.ts src/indexer/api.ts src/indexer/host-core.ts src/shared/protocol.ts src/main/main.ts src/preload/preload.ts tests/resolve.test.ts tests/api-relations.test.ts
git commit -m "해석 모듈(resolve) + 참조/클래스 계층 쿼리 + indexer:call 릴레이"
```

---

### Task 4: 렌더러 내비게이션/커서 인프라 + 참조 하이라이트

**Files:**
- Create: `src/renderer/src/navigation.ts`
- Modify: `src/renderer/src/store.ts` (cursorSymbol, pendingJump)
- Modify: `src/renderer/src/components/EditorPane.tsx` (커서 디바운스, Ctrl+클릭/F12, pendingJump 소비, 참조 하이라이트, getCursorLocation)
- Modify: `src/renderer/src/App.tsx` (Alt+←/→, 마우스 3/4, 에디터 밖 Backspace)
- Modify: `src/renderer/src/components/FileTabs.tsx` (◀▶ 버튼)
- Modify: `src/renderer/src/theme.css` (하이라이트/버튼 스타일)
- Test: `tests/renderer-navigation.test.ts`

**Interfaces:**
- Produces:
  - `navigation.ts`: `export interface Loc { path: string; line: number; col: number }`, `class NavHistory { push(loc), back(cur): Loc|null, forward(cur): Loc|null, canBack/canForward }` (상한 100, 연속 동일 위치 dedupe) + 모듈 싱글턴 `navHistory`
  - `jumpTo(path, line, col?)`: 현재 위치 push 후 store의 `openTab(path)` + `pendingJump` 설정 — **이후 모든 태스크(검색/Relation/Context/북마크)의 점프 단일 진입점**
  - store: `cursorSymbol: { name, path, line, col } | null`, `setCursorSymbol`, `pendingJump: Loc | null`, `setPendingJump`
  - EditorPane export: `getCursorLocation(): Loc | null`
- Consumes: `window.si.resolve` (Task 3).

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/renderer-navigation.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { NavHistory } from '../src/renderer/src/navigation';

const L = (line: number) => ({ path: 'a.ts', line, col: 1 });

describe('NavHistory', () => {
  it('push 후 back은 직전 위치, forward는 복귀', () => {
    const h = new NavHistory();
    h.push(L(1)); // 점프 직전 위치 기록
    const back = h.back(L(50)); // 현재 50에서 뒤로
    expect(back).toEqual(L(1));
    expect(h.forward(L(1))).toEqual(L(50));
  });
  it('빈 스택 back/forward는 null', () => {
    const h = new NavHistory();
    expect(h.back(L(1))).toBeNull();
    expect(h.forward(L(1))).toBeNull();
  });
  it('push는 forward 스택을 비운다', () => {
    const h = new NavHistory();
    h.push(L(1));
    h.back(L(50));
    h.push(L(2));
    expect(h.forward(L(2))).toBeNull();
  });
  it('연속 동일 위치는 dedupe, 상한 100', () => {
    const h = new NavHistory();
    h.push(L(1));
    h.push(L(1));
    expect(h.back(L(9))).toEqual(L(1));
    expect(h.back(L(1))).toBeNull(); // 중복은 한 번만
    for (let i = 0; i < 150; i++) h.push(L(i));
    expect((h as any).backStack.length).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현** — `src/renderer/src/navigation.ts`

```ts
export interface Loc {
  path: string;
  line: number;
  col: number;
}

const MAX = 100;
const same = (a: Loc | undefined, b: Loc) => !!a && a.path === b.path && a.line === b.line && a.col === b.col;

/** 뒤로/앞으로 스택. push는 "점프 직전 현재 위치"를 기록한다. */
export class NavHistory {
  private backStack: Loc[] = [];
  private forwardStack: Loc[] = [];

  push(loc: Loc): void {
    if (same(this.backStack[this.backStack.length - 1], loc)) return;
    this.backStack.push(loc);
    if (this.backStack.length > MAX) this.backStack.shift();
    this.forwardStack = [];
  }

  back(current: Loc): Loc | null {
    const prev = this.backStack.pop();
    if (!prev) return null;
    this.forwardStack.push(current);
    return prev;
  }

  forward(current: Loc): Loc | null {
    const next = this.forwardStack.pop();
    if (!next) return null;
    this.backStack.push(current);
    return next;
  }

  get canBack(): boolean { return this.backStack.length > 0; }
  get canForward(): boolean { return this.forwardStack.length > 0; }
}

export const navHistory = new NavHistory();
```

Run: `npx vitest run tests/renderer-navigation.test.ts` → PASS.

- [ ] **Step 3: store 확장** — `src/renderer/src/store.ts`

상태/액션 추가 (기존 구조에 삽입):

```ts
cursorSymbol: { name: string; path: string; line: number; col: number } | null;
pendingJump: { path: string; line: number; col: number } | null;
setCursorSymbol(s: AppState['cursorSymbol']): void;
setPendingJump(j: AppState['pendingJump']): void;
// 구현:
cursorSymbol: null,
pendingJump: null,
setCursorSymbol: (cursorSymbol) => set({ cursorSymbol }),
setPendingJump: (pendingJump) => set({ pendingJump }),
```

`setProject`의 리셋에 `cursorSymbol: null, pendingJump: null` 추가.

- [ ] **Step 4: jumpTo + EditorPane 확장**

`src/renderer/src/navigation.ts`에 append (store/EditorPane 의존은 함수 내 동적 임포트 없이 — navigation은 store만 임포트, getCursorLocation은 콜백 주입):

```ts
import { useAppStore } from './store';

let currentLocProvider: (() => Loc | null) | null = null;
export function setCurrentLocProvider(fn: () => Loc | null): void {
  currentLocProvider = fn;
}

/** 모든 점프의 단일 진입점: 현재 위치를 히스토리에 push하고 대상 열기+이동 */
export function jumpTo(path: string, line: number, col = 1): void {
  const cur = currentLocProvider?.();
  if (cur) navHistory.push(cur);
  const st = useAppStore.getState();
  st.openTab(path);
  st.setPendingJump({ path, line, col });
}

export function goBack(): void {
  const cur = currentLocProvider?.();
  if (!cur) return;
  const prev = navHistory.back(cur);
  if (!prev) return;
  const st = useAppStore.getState();
  st.openTab(prev.path);
  st.setPendingJump(prev);
}

export function goForward(): void {
  const cur = currentLocProvider?.();
  if (!cur) return;
  const next = navHistory.forward(cur);
  if (!next) return;
  const st = useAppStore.getState();
  st.openTab(next.path);
  st.setPendingJump(next);
}
```

`src/renderer/src/components/EditorPane.tsx` 확장 (현재 파일 구조에 맞춰):

```ts
export function getCursorLocation(): { path: string; line: number; col: number } | null {
  const st = useAppStore.getState();
  const pos = editorInstance?.getPosition();
  if (!st.activePath || !pos) return null;
  return { path: st.activePath, line: pos.lineNumber, col: pos.column };
}
```

에디터 생성 useEffect에 추가:
1. `setCurrentLocProvider(getCursorLocation);`
2. **커서 디바운스 (150ms)** → cursorSymbol:

```ts
let cursorTimer: ReturnType<typeof setTimeout> | null = null;
editorInstance.onDidChangeCursorPosition((e) => {
  if (cursorTimer) clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => {
    const st = useAppStore.getState();
    const model = editorInstance?.getModel();
    if (!model || !st.activePath) return;
    const word = model.getWordAtPosition(e.position);
    st.setCursorSymbol(word ? { name: word.word, path: st.activePath, line: e.position.lineNumber, col: e.position.column } : null);
    highlightReferences(model, word?.word ?? null);
  }, 150);
});
```

3. **참조 하이라이트** (파일 내 whole-word 일치 — 스펙 §6의 자동 참조 하이라이트를 텍스트 기반으로):

```ts
let refDecorations: import('monaco-editor').editor.IEditorDecorationsCollection | null = null;

function highlightReferences(model: import('monaco-editor').editor.ITextModel, word: string | null): void {
  if (!editorInstance) return;
  refDecorations?.clear();
  if (!word) return;
  const matches = model.findMatches(word, false, false, true /* wholeWord */, null, false, 200);
  refDecorations = editorInstance.createDecorationsCollection(
    matches.map((m) => ({ range: m.range, options: { className: 'ref-highlight' } })),
  );
}
```

4. **Ctrl/Cmd+클릭 + F12 정의 점프**:

```ts
editorInstance.onMouseDown((e) => {
  if (!(e.event.ctrlKey || e.event.metaKey)) return;
  const pos = e.target.position;
  const model = editorInstance?.getModel();
  const st = useAppStore.getState();
  if (!pos || !model || !st.activePath) return;
  const word = model.getWordAtPosition(pos);
  if (word) void resolveAndJump(word.word, st.activePath);
});
editorInstance.addCommand(monaco.KeyCode.F12, () => {
  const loc = getCursorLocation();
  const model = editorInstance?.getModel();
  if (!loc || !model) return;
  const word = model.getWordAtPosition({ lineNumber: loc.line, column: loc.col });
  if (word) void resolveAndJump(word.word, loc.path);
});

async function resolveAndJump(name: string, fromPath: string): Promise<void> {
  const cands = await window.si.resolve(name, fromPath).catch(() => []);
  if (cands.length === 0) {
    useAppStore.getState().setError(`정의를 찾을 수 없음: ${name}`);
    return;
  }
  useAppStore.getState().setError(null);
  jumpTo(cands[0].path, cands[0].line);
}
```

5. **pendingJump 소비** — activePath 모델 세팅 이후 적용되도록 별도 useEffect:

```ts
const pendingJump = useAppStore((s) => s.pendingJump);
useEffect(() => {
  if (!pendingJump || pendingJump.path !== activePath) return;
  const model = monaco.editor.getModel(uriOf(pendingJump.path));
  if (!model || editorInstance?.getModel() !== model) return; // 모델 로드 후 재시도됨 (아래)
  editorInstance?.revealLineInCenter(pendingJump.line);
  editorInstance?.setPosition({ lineNumber: pendingJump.line, column: pendingJump.col });
  editorInstance?.focus();
  useAppStore.getState().setPendingJump(null);
}, [pendingJump, activePath]);
```

주의: activePath의 모델이 비동기 로드(readFile) 중이면 이 effect가 모델 세팅 전에 돌 수 있다 — 기존 readFile `.then`에서 `editorInstance?.setModel(model)` 직후 `useAppStore.getState().setPendingJump(useAppStore.getState().pendingJump ? { ...useAppStore.getState().pendingJump! } : null);`처럼 pendingJump를 재설정해 effect를 재트리거하거나, setModel 직후 직접 pendingJump를 확인해 reveal하는 헬퍼를 호출한다 (구현 단순한 쪽 선택 — 후자 권장: `applyPendingJump()` 함수로 공용화).

- [ ] **Step 5: App/FileTabs 배선**

`src/renderer/src/App.tsx` — 두 번째 useEffect(저장 핸들러)에 내비게이션 키 추가:

```ts
import { goBack, goForward } from './navigation';
// onKey 내부에 추가:
if (ev.altKey && ev.key === 'ArrowLeft') { ev.preventDefault(); goBack(); }
if (ev.altKey && ev.key === 'ArrowRight') { ev.preventDefault(); goForward(); }
// Backspace 백: 에디터 포커스 밖에서만 (스펙 결정 기록)
if (ev.key === 'Backspace' && !(document.activeElement?.closest('.editor-host'))
    && !(document.activeElement instanceof HTMLInputElement)) {
  ev.preventDefault(); goBack();
}
// 마우스 뒤로/앞으로 버튼 — 별도 리스너:
const onMouse = (ev: MouseEvent) => {
  if (ev.button === 3) { ev.preventDefault(); goBack(); }
  if (ev.button === 4) { ev.preventDefault(); goForward(); }
};
window.addEventListener('mouseup', onMouse);
// cleanup에 removeEventListener 추가
```

`src/renderer/src/components/FileTabs.tsx` — 탭 왼쪽에 ◀▶:

```tsx
import { goBack, goForward } from '../navigation';
// tabs.length === 0이어도 렌더하도록 완화하고, 맨 앞에:
<div className="nav-buttons">
  <span className="nav-btn" title="뒤로 (Alt+←)" onClick={goBack}>◀</span>
  <span className="nav-btn" title="앞으로 (Alt+→)" onClick={goForward}>▶</span>
</div>
```

`src/renderer/src/theme.css` 추가:

```css
.ref-highlight { background: rgba(74, 158, 255, 0.18); border-radius: 2px; }
.nav-buttons { display: flex; align-items: center; padding: 0 4px; border-right: 1px solid var(--border); }
.nav-btn { padding: 2px 6px; cursor: pointer; color: var(--fg-dim); font-size: 11px; }
.nav-btn:hover { color: var(--fg); }
```

- [ ] **Step 6: 검증 + 커밋**

Run: `npm run build && npm test`
Expected: 전부 PASS. (상호작용 검증은 Task 9 E2E — Ctrl+클릭 점프/Alt+← 복귀.)

```bash
git add src/renderer/src/navigation.ts src/renderer/src/store.ts src/renderer/src/components/EditorPane.tsx src/renderer/src/App.tsx src/renderer/src/components/FileTabs.tsx src/renderer/src/theme.css tests/renderer-navigation.test.ts
git commit -m "내비게이션 히스토리/jumpTo + 커서 심볼 상태 + Ctrl+클릭·F12 정의 점프 + 참조 하이라이트"
```

---

### Task 5: Context Window

**Files:**
- Modify: `src/renderer/src/components/ContextPanel.tsx` (전면 교체)
- Modify: `src/renderer/src/theme.css` (헤더 스타일)

**Interfaces:**
- Consumes: store `cursorSymbol`/`outlineVersion`, `window.si.resolve`, `getContent`(EditorPane — 열린 모델 우선), `window.si.readFile`, `jumpTo`, monaco-setup.
- Produces: 커서 심볼 정의 미리보기 패널 (읽기 전용 Monaco, `si-preview:` 스킴 일회용 모델).

- [ ] **Step 1: 구현** — `src/renderer/src/components/ContextPanel.tsx` 전면 교체

```tsx
import { useEffect, useRef, useState } from 'react';
import { monaco } from '../monaco-setup';
import { useAppStore } from '../store';
import { getContent } from './EditorPane';
import { jumpTo } from '../navigation';
import type { Candidate } from '../../../indexer/resolve';

const MAX_PREVIEW_LINES = 80;

export function ContextPanel() {
  const cursorSymbol = useAppStore((s) => s.cursorSymbol);
  const outlineVersion = useAppStore((s) => s.outlineVersion);
  const indexing = useAppStore((s) => s.indexing);
  const [header, setHeader] = useState<{ label: string; path: string; line: number } | null>(null);
  const [hint, setHint] = useState<string>('심볼 위에 커서를 두면 정의를 표시합니다');
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    editorRef.current = monaco.editor.create(hostRef.current!, {
      theme: 'vs-dark',
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      model: null,
    });
    return () => {
      editorRef.current?.getModel()?.dispose();
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (indexing) { setHeader(null); setHint('인덱싱 중…'); return; }
    if (!cursorSymbol) { setHeader(null); setHint('심볼 위에 커서를 두면 정의를 표시합니다'); return; }
    let cancelled = false;
    void (async () => {
      const cands: Candidate[] = await window.si.resolve(cursorSymbol.name, cursorSymbol.path).catch(() => []);
      if (cancelled) return;
      if (cands.length === 0) { setHeader(null); setHint(`정의를 찾을 수 없음: ${cursorSymbol.name}`); return; }
      const top = cands[0];
      // 열린 모델이 있으면 그 내용(미저장 편집 반영), 없으면 디스크
      const content = getContent(top.path) ?? (await window.si.readFile(top.path).catch(() => null));
      if (cancelled || content == null) return;
      const lines = content.split('\n');
      const start = Math.max(0, top.line - 1); // top.line은 0-기반 start_line (Plan 1 규약)
      const slice = lines.slice(start, start + MAX_PREVIEW_LINES).join('\n');
      const ext = top.path.split('.').pop() ?? 'txt';
      const uri = monaco.Uri.parse(`si-preview:///preview.${ext}`);
      monaco.editor.getModel(uri)?.dispose();
      const model = monaco.editor.createModel(slice, undefined, uri);
      editorRef.current?.setModel(model);
      setHeader({
        label: `${top.name} — ${top.path}:${top.line + 1}${cands.length > 1 ? ` (후보 ${cands.length}개)` : ''}`,
        path: top.path,
        line: top.line + 1,
      });
      setHint('');
    })();
    return () => { cancelled = true; };
  }, [cursorSymbol, outlineVersion, indexing]);

  return (
    <div className="panel">
      <div className="panel-title">
        Context
        {header && (
          <span className="context-header" onClick={() => jumpTo(header.path, header.line)}>
            {header.label}
          </span>
        )}
      </div>
      <div className="panel-body context-body">
        {hint && <div className="hint">{hint}</div>}
        <div ref={hostRef} className="context-editor" style={{ display: hint ? 'none' : 'block' }} />
      </div>
    </div>
  );
}
```

**줄 번호 규약 주의**: Plan 1의 `SymbolHit.line`은 `start_line`(tree-sitter row, **0-기반**)이다. SymbolWindow의 revealLine 사용을 확인해 동일 보정(+1)을 적용할 것 — SymbolWindow가 이미 `revealLine(s.line)`으로 동작 중이라면 그 관례를 따르고, 어긋나면 이 태스크에서 통일해 보고서에 기록.

theme.css 추가:

```css
.context-header { margin-left: 10px; color: var(--accent); cursor: pointer; text-transform: none; letter-spacing: 0; }
.context-header:hover { text-decoration: underline; }
.context-body { display: flex; flex-direction: column; }
.context-editor { flex: 1; min-height: 0; }
```

- [ ] **Step 2: 검증 + 커밋**

Run: `npm run build && npm test`
수동 확인(선택, ABI dance): 픽스처에서 함수 호출 위에 커서 → Context에 정의 표시.

```bash
git add src/renderer/src/components/ContextPanel.tsx src/renderer/src/theme.css
git commit -m "Context Window: 커서 심볼 정의 미리보기 (해석 모듈 + 읽기 전용 Monaco)"
```

---

### Task 6: 통합 검색 오버레이

**Files:**
- Create: `src/renderer/src/components/SearchOverlay.tsx`
- Modify: `src/renderer/src/App.tsx` (마운트 + Cmd/Ctrl+Shift+F 토글)
- Modify: `src/renderer/src/store.ts` (searchOpen)
- Modify: `src/renderer/src/components/EditorPane.tsx` (findFirstAndReveal export)
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Produces: store `searchOpen: boolean`, `setSearchOpen`. `SearchOverlay` — 입력 150ms 디바운스로 `searchSymbols`+`searchText` 병렬 조회, 심볼/텍스트 두 섹션, ↑↓/Enter/Esc/클릭. EditorPane export `findFirstAndReveal(path: string, query: string): void` (텍스트 결과 점프용 — 모델 로드 후 첫 일치로 이동, 없으면 1행).
- Consumes: `window.si.searchSymbols/searchText` (Task 3), `jumpTo`.

- [ ] **Step 1: store + EditorPane 지원**

store에 `searchOpen: boolean; setSearchOpen(v: boolean): void;` 추가 (`searchOpen: false`, setProject 리셋에 포함).

EditorPane에 export 추가:

```ts
/** 텍스트 검색 결과 점프: 파일 열고 첫 일치 위치로 이동 (FTS는 줄 정보가 없음) */
export function findFirstAndReveal(path: string, query: string): void {
  jumpTo(path, 1);
  // 모델 로드 후 첫 일치 탐색 — pendingJump 소비 시점에 이어서 실행되도록 지연 재시도
  const tryFind = (attempt = 0): void => {
    const model = monaco.editor.getModel(uriOf(path));
    if (!model) {
      if (attempt < 20) setTimeout(() => tryFind(attempt + 1), 100);
      return;
    }
    const m = model.findMatches(query, false, false, false, null, false, 1)[0];
    if (m && editorInstance?.getModel() === model) {
      editorInstance.revealLineInCenter(m.range.startLineNumber);
      editorInstance.setPosition({ lineNumber: m.range.startLineNumber, column: m.range.startColumn });
    }
  };
  tryFind();
}
```

(jumpTo와 uriOf/editorInstance는 이 모듈에 이미 존재 — jumpTo는 navigation에서 import.)

- [ ] **Step 2: SearchOverlay 구현** — `src/renderer/src/components/SearchOverlay.tsx`

```tsx
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { jumpTo } from '../navigation';
import { findFirstAndReveal } from './EditorPane';
import type { SymbolHit, TextHit } from '../../../indexer/api';

interface Item {
  kind: 'symbol' | 'text';
  label: string;
  detail: string;
  path: string;
  line?: number; // symbol만
  query?: string; // text만
}

export function SearchOverlay() {
  const open = useAppStore((s) => s.searchOpen);
  const setOpen = useAppStore((s) => s.setSearchOpen);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setQ(''); setItems([]); setSel(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) { setItems([]); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      void Promise.all([
        window.si.searchSymbols(q).catch(() => [] as SymbolHit[]),
        window.si.searchText(q).catch(() => [] as TextHit[]),
      ]).then(([syms, texts]) => {
        if (cancelled) return;
        const si: Item[] = syms.slice(0, 30).map((s) => ({
          kind: 'symbol', label: s.name, detail: `${s.kind} · ${s.path}:${s.line + 1}`, path: s.path, line: s.line + 1,
        }));
        const ti: Item[] = texts.slice(0, 30).map((t2) => ({
          kind: 'text', label: t2.snippet, detail: t2.path, path: t2.path, query: q,
        }));
        setItems([...si, ...ti]);
        setSel(0);
      });
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open]);

  if (!open) return null;

  const pick = (it: Item) => {
    setOpen(false);
    if (it.kind === 'symbol') jumpTo(it.path, it.line!);
    else findFirstAndReveal(it.path, it.query!);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && items[sel]) pick(items[sel]);
  };

  const symbols = items.filter((i) => i.kind === 'symbol');
  const texts = items.filter((i) => i.kind === 'text');
  const idxOf = (it: Item) => items.indexOf(it);

  return (
    <div className="search-backdrop" onClick={() => setOpen(false)}>
      <div className="search-box" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          placeholder="심볼 조각 또는 텍스트 검색…  (Esc 닫기)"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="search-results">
          {symbols.length > 0 && <div className="search-section">심볼</div>}
          {symbols.map((it) => (
            <div key={`s${idxOf(it)}`} className={`search-item${idxOf(it) === sel ? ' selected' : ''}`} onClick={() => pick(it)}>
              <span className="search-label">{it.label}</span>
              <span className="search-detail">{it.detail}</span>
            </div>
          ))}
          {texts.length > 0 && <div className="search-section">전문 (FTS)</div>}
          {texts.map((it) => (
            <div key={`t${idxOf(it)}`} className={`search-item${idxOf(it) === sel ? ' selected' : ''}`} onClick={() => pick(it)}>
              <span className="search-label search-snippet">{it.label}</span>
              <span className="search-detail">{it.detail}</span>
            </div>
          ))}
          {q.trim().length >= 2 && items.length === 0 && <div className="hint">결과 없음</div>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: App 배선 + CSS**

App.tsx: `<SearchOverlay />`를 `.app` 안(StatusBar 옆 형제)에 마운트 (root 있을 때만). onKey에 추가:

```ts
if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && (ev.key === 'f' || ev.key === 'F')) {
  ev.preventDefault();
  useAppStore.getState().setSearchOpen(!useAppStore.getState().searchOpen);
}
```

theme.css:

```css
.search-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.35); z-index: 50; display: flex; justify-content: center; }
.search-box { margin-top: 8vh; width: 640px; max-height: 60vh; background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
.search-box input { padding: 10px 12px; font-size: 14px; background: var(--bg); color: var(--fg); border: none; border-bottom: 1px solid var(--border); outline: none; border-radius: 6px 6px 0 0; }
.search-results { overflow-y: auto; }
.search-section { padding: 4px 12px; font-size: 11px; text-transform: uppercase; color: var(--fg-dim); background: var(--bg); }
.search-item { display: flex; justify-content: space-between; gap: 12px; padding: 5px 12px; cursor: pointer; }
.search-item:hover, .search-item.selected { background: var(--bg-active); }
.search-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.search-snippet { color: var(--fg-dim); font-size: 12px; }
.search-detail { color: var(--fg-dim); font-size: 12px; white-space: nowrap; }
```

- [ ] **Step 4: 검증 + 커밋**

Run: `npm run build && npm test`

```bash
git add src/renderer/src/components/SearchOverlay.tsx src/renderer/src/components/EditorPane.tsx src/renderer/src/App.tsx src/renderer/src/store.ts src/renderer/src/theme.css
git commit -m "통합 검색 오버레이: fragment 심볼 + FTS 전문 통합, 키보드 내비게이션·점프"
```

---

### Task 7: Relation Window

**Files:**
- Modify: `src/renderer/src/components/RelationPanel.tsx` (전면 교체)
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: store `cursorSymbol`/`outlineVersion`/`indexing`, `window.si.resolve/getCallers/getCallees/getReferences/getSuperclasses/getSubclasses`, `jumpTo`.
- Produces: Calls/Callers/Refs/Class 4탭 트리. 초기 깊이 1, ▶ 확장 시 지연 로드, 트리별 visited 가드.

- [ ] **Step 1: 구현** — `src/renderer/src/components/RelationPanel.tsx` 전면 교체

```tsx
import { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { jumpTo } from '../navigation';
import type { Candidate } from '../../../indexer/resolve';
import type { SymbolHit, CallerHit } from '../../../indexer/api';

type Tab = 'calls' | 'callers' | 'refs' | 'class';

interface Node {
  key: string;           // `${name}:${path}:${line}` — visited/expand 키
  label: string;
  detail: string;        // path:line
  path: string;
  line: number;          // 1-기반
  name: string;
  symbolId: number | null;
  expandable: boolean;
  children: Node[] | null; // null = 미로드
}

const keyOf = (name: string, path: string, line: number) => `${name}:${path}:${line}`;

function symToNode(s: SymbolHit): Node {
  return {
    key: keyOf(s.name, s.path, s.line), label: s.name, detail: `${s.path}:${s.line + 1}`,
    path: s.path, line: s.line + 1, name: s.name, symbolId: s.id, expandable: true, children: null,
  };
}

function callerToNode(c: CallerHit): Node {
  const nm = c.callerName ?? '(최상위)';
  return {
    key: keyOf(nm, c.path, c.line), label: nm, detail: `${c.path}:${c.line + 1}`,
    path: c.path, line: c.line + 1, name: nm, symbolId: c.callerId,
    expandable: c.callerName !== null, children: null,
  };
}

async function loadChildren(tab: Tab, node: Node, visited: Set<string>): Promise<Node[]> {
  let next: Node[] = [];
  if (tab === 'calls' && node.symbolId !== null) {
    next = (await window.si.getCallees(node.symbolId)).map(symToNode);
  } else if (tab === 'callers') {
    next = (await window.si.getCallers(node.name)).map(callerToNode);
  } else if (tab === 'class' && node.symbolId !== null) {
    const [supers, subs] = await Promise.all([
      window.si.getSuperclasses(node.symbolId),
      window.si.getSubclasses(node.name),
    ]);
    next = [
      ...supers.map((s) => ({ ...symToNode(s), label: `▲ ${s.name}` })),
      ...subs.map((s) => ({ ...symToNode(s), label: `▼ ${s.name}` })),
    ];
  }
  // 순환 가드: 이미 방문한 노드는 리프로
  return next.map((n) => (visited.has(n.key) ? { ...n, expandable: false } : n));
}

export function RelationPanel() {
  const cursorSymbol = useAppStore((s) => s.cursorSymbol);
  const outlineVersion = useAppStore((s) => s.outlineVersion);
  const indexing = useAppStore((s) => s.indexing);
  const [tab, setTab] = useState<Tab>('callers');
  const [root, setRoot] = useState<Candidate | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [refs, setRefs] = useState<Array<{ path: string; line: number; kind: string; enclosingName: string | null }>>([]);
  const [visited] = useState(() => new Set<string>());

  useEffect(() => {
    if (indexing || !cursorSymbol) { setRoot(null); setNodes([]); setRefs([]); return; }
    let cancelled = false;
    void (async () => {
      const cands = await window.si.resolve(cursorSymbol.name, cursorSymbol.path).catch(() => []);
      if (cancelled) return;
      const top = cands[0] ?? null;
      setRoot(top);
      visited.clear();
      if (!top) { setNodes([]); setRefs([]); return; }
      visited.add(keyOf(top.name, top.path, top.line));
      if (tab === 'refs') {
        const rs = await window.si.getReferences(top.name).catch(() => []);
        if (!cancelled) setRefs(rs.map((r) => ({ path: r.path, line: r.line + 1, kind: r.kind, enclosingName: r.enclosingName })));
      } else {
        const rootNode = symToNode(top);
        const children = await loadChildren(tab, rootNode, visited).catch(() => []);
        if (!cancelled) {
          children.forEach((c) => visited.add(c.key));
          setNodes(children);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [cursorSymbol, tab, outlineVersion, indexing]);

  const expand = async (node: Node, list: Node[], setList: (n: Node[]) => void) => {
    if (node.children !== null) { node.children = null; setList([...list]); return; } // 접기
    const children = await loadChildren(tab, node, visited).catch(() => []);
    children.forEach((c) => visited.add(c.key));
    node.children = children;
    setList([...list]);
  };

  const renderNodes = (ns: Node[], depth: number): React.ReactNode =>
    ns.map((n) => (
      <div key={n.key + depth}>
        <div className="rel-item" style={{ paddingLeft: depth * 14 + 8 }}>
          <span
            className="tree-icon"
            onClick={(e) => { e.stopPropagation(); if (n.expandable) void expand(n, nodes, setNodes); }}
          >
            {n.expandable ? (n.children !== null ? '▾' : '▸') : '·'}
          </span>
          <span className="rel-label" onClick={() => jumpTo(n.path, n.line)}>{n.label}</span>
          <span className="rel-detail">{n.detail}</span>
        </div>
        {n.children && renderNodes(n.children, depth + 1)}
      </div>
    ));

  return (
    <div className="panel">
      <div className="panel-title">Relation{root ? ` — ${root.name}` : ''}</div>
      <div className="rel-tabs">
        {(['calls', 'callers', 'refs', 'class'] as Tab[]).map((t) => (
          <span key={t} className={`rel-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {{ calls: 'Calls', callers: 'Callers', refs: 'Refs', class: 'Class' }[t]}
          </span>
        ))}
      </div>
      <div className="panel-body">
        {indexing && <div className="hint">인덱싱 중…</div>}
        {!indexing && !root && <div className="hint">심볼 위에 커서를 두세요</div>}
        {!indexing && root && tab === 'refs' && (
          refs.length === 0 ? <div className="hint">참조 없음</div> :
          refs.map((r, i) => (
            <div key={i} className="rel-item" style={{ paddingLeft: 8 }} onClick={() => jumpTo(r.path, r.line)}>
              <span className="rel-label">{r.enclosingName ?? '(파일)'}<span className="rel-kind"> {r.kind}</span></span>
              <span className="rel-detail">{r.path}:{r.line}</span>
            </div>
          ))
        )}
        {!indexing && root && tab !== 'refs' && (
          nodes.length === 0 ? <div className="hint">{tab === 'class' ? '클래스 관계 없음' : '결과 없음'}</div> : renderNodes(nodes, 0)
        )}
      </div>
    </div>
  );
}
```

theme.css:

```css
.rel-tabs { flex: none; display: flex; gap: 2px; padding: 2px 6px; border-bottom: 1px solid var(--border); }
.rel-tab { padding: 2px 8px; font-size: 11px; cursor: pointer; color: var(--fg-dim); border-radius: 3px; }
.rel-tab.active { background: var(--bg-active); color: var(--fg); }
.rel-item { display: flex; align-items: center; gap: 6px; padding: 2px 8px; cursor: pointer; white-space: nowrap; }
.rel-item:hover { background: var(--bg-hover); }
.rel-label { overflow: hidden; text-overflow: ellipsis; }
.rel-kind { color: var(--fg-dim); font-size: 11px; }
.rel-detail { margin-left: auto; color: var(--fg-dim); font-size: 11px; }
```

- [ ] **Step 2: 검증 + 커밋**

Run: `npm run build && npm test`

```bash
git add src/renderer/src/components/RelationPanel.tsx src/renderer/src/theme.css
git commit -m "Relation Window: Calls/Callers/Refs/Class 4탭 지연 로드 트리 (순환 가드)"
```

---

### Task 8: 영구 북마크

**Files:**
- Create: `src/renderer/src/bookmarks.ts` (앵커 계산/재해석 — 순수 함수)
- Create: `src/renderer/src/components/BookmarksSection.tsx`
- Modify: `src/main/persistence.ts` + `src/main/main.ts` + `src/preload/preload.ts` (bookmarks:load/save)
- Modify: `src/renderer/src/store.ts` (bookmarks 상태)
- Modify: `src/renderer/src/App.tsx` (Cmd/Ctrl+F2 토글, 프로젝트 열기 시 로드, side-v 3분할)
- Test: `tests/bookmarks.test.ts`

**Interfaces:**
- Produces:
  - `Bookmark { path, line, anchorName: string | null, anchorLine: number, offset: number, text }` (line/anchorLine은 1-기반 저장)
  - `computeAnchor(symbols: SymbolHit[], line1: number): { anchorName, anchorLine, offset }` — line1 이전에서 가장 가까운 심볼(start 기준), 없으면 anchorName null/offset=line1
  - `resolveBookmarkLine(symbols: SymbolHit[], bm: Bookmark): number` — 동명 심볼 찾으면 그 시작+offset, 없으면 저장된 line 폴백
  - main: `Persistence.loadBookmarks(root)/saveBookmarks(root, list)` → `userData/bookmarks/<해시>.json`; ipc `bookmarks:load`/`bookmarks:save`; preload 동명
  - store: `bookmarks: Bookmark[]`, `setBookmarks`
- Consumes: `window.si.getFileOutline`, `getCursorLocation`(EditorPane), `jumpTo`.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/bookmarks.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { computeAnchor, resolveBookmarkLine } from '../src/renderer/src/bookmarks';
import type { SymbolHit } from '../src/indexer/api';

const sym = (name: string, line0: number): SymbolHit =>
  ({ id: 1, name, kind: 'function', scope: '', signature: '', path: 'a.ts', line: line0 } as SymbolHit);

describe('computeAnchor', () => {
  it('줄 이전의 가장 가까운 심볼 + 오프셋', () => {
    const syms = [sym('foo', 4), sym('bar', 19)]; // 0-기반 → 1-기반 5, 20
    expect(computeAnchor(syms, 25)).toEqual({ anchorName: 'bar', anchorLine: 20, offset: 5 });
    expect(computeAnchor(syms, 7)).toEqual({ anchorName: 'foo', anchorLine: 5, offset: 2 });
  });
  it('앞선 심볼이 없으면 anchorName null', () => {
    expect(computeAnchor([sym('foo', 9)], 3)).toEqual({ anchorName: null, anchorLine: 0, offset: 3 });
  });
});

describe('resolveBookmarkLine', () => {
  const bm = { path: 'a.ts', line: 25, anchorName: 'bar', anchorLine: 20, offset: 5, text: '' };
  it('앵커 심볼이 이동하면 따라간다', () => {
    expect(resolveBookmarkLine([sym('bar', 29)], bm)).toBe(35); // bar가 30행으로 → 30+5
  });
  it('앵커 유실 시 저장된 줄로 폴백', () => {
    expect(resolveBookmarkLine([sym('other', 0)], bm)).toBe(25);
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현** — `src/renderer/src/bookmarks.ts`

```ts
import type { SymbolHit } from '../../indexer/api';

export interface Bookmark {
  path: string;
  line: number;        // 1-기반 (폴백용 절대 줄)
  anchorName: string | null;
  anchorLine: number;  // 1-기반 (표시용)
  offset: number;      // 앵커 시작으로부터의 줄 오프셋
  text: string;        // 미리보기 한 줄
}

/** line1(1-기반) 이전에서 시작하는 가장 가까운 심볼을 앵커로 */
export function computeAnchor(
  symbols: SymbolHit[],
  line1: number,
): { anchorName: string | null; anchorLine: number; offset: number } {
  let best: SymbolHit | null = null;
  for (const s of symbols) {
    const sLine1 = s.line + 1;
    if (sLine1 <= line1 && (!best || sLine1 > best.line + 1)) best = s;
  }
  if (!best) return { anchorName: null, anchorLine: 0, offset: line1 };
  return { anchorName: best.name, anchorLine: best.line + 1, offset: line1 - (best.line + 1) };
}

/** 저장된 앵커를 현재 아웃라인에 재해석 — 유실 시 절대 줄 폴백 */
export function resolveBookmarkLine(symbols: SymbolHit[], bm: Bookmark): number {
  if (!bm.anchorName) return bm.line;
  const found = symbols.find((s) => s.name === bm.anchorName);
  return found ? found.line + 1 + bm.offset : bm.line;
}
```

Run: `npx vitest run tests/bookmarks.test.ts` → PASS.

- [ ] **Step 3: main/preload 지속성**

`src/main/persistence.ts`에 추가 (Bookmark 타입은 `import type { Bookmark } from '...'` 대신 여기서 `unknown[]`로 취급 — main은 내용 무해석):

```ts
loadBookmarks(root: string): unknown[] {
  try {
    return JSON.parse(fs.readFileSync(path.join(this.baseDir, 'bookmarks', `${this.projectHash(root)}.json`), 'utf8')) as unknown[];
  } catch {
    return [];
  }
}

saveBookmarks(root: string, list: unknown[]): void {
  const dir = path.join(this.baseDir, 'bookmarks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${this.projectHash(root)}.json`), JSON.stringify(list, null, 2));
}
```

`src/main/main.ts` registerIpc:

```ts
ipcMain.handle('bookmarks:load', () => (currentRoot ? persistence.loadBookmarks(currentRoot) : []));
ipcMain.handle('bookmarks:save', (_e, list: unknown[]) => {
  if (currentRoot) persistence.saveBookmarks(currentRoot, list);
});
```

`src/preload/preload.ts`:

```ts
loadBookmarks: (): Promise<unknown[]> => ipcRenderer.invoke('bookmarks:load'),
saveBookmarks: (list: unknown[]): Promise<void> => ipcRenderer.invoke('bookmarks:save', list),
```

- [ ] **Step 4: store/UI/토글**

store: `bookmarks: Bookmark[]` (type-only import), `setBookmarks(list)`; setProject 리셋 포함.

`src/renderer/src/components/BookmarksSection.tsx`:

```tsx
import { useAppStore } from '../store';
import { jumpTo } from '../navigation';
import { resolveBookmarkLine, Bookmark } from '../bookmarks';

export function BookmarksSection() {
  const bookmarks = useAppStore((s) => s.bookmarks);
  const setBookmarks = useAppStore((s) => s.setBookmarks);

  const jump = async (bm: Bookmark) => {
    const symbols = await window.si.getFileOutline(bm.path).catch(() => []);
    jumpTo(bm.path, resolveBookmarkLine(symbols, bm));
  };
  const remove = (bm: Bookmark) => {
    const next = bookmarks.filter((b) => b !== bm);
    setBookmarks(next);
    void window.si.saveBookmarks(next);
  };

  return (
    <div className="panel">
      <div className="panel-title">Bookmarks</div>
      <div className="panel-body">
        {bookmarks.length === 0 && <div className="hint">Cmd/Ctrl+F2로 북마크 토글</div>}
        {bookmarks.map((bm, i) => (
          <div key={i} className="rel-item" style={{ paddingLeft: 8 }}>
            <span className="rel-label" onClick={() => void jump(bm)}>
              {bm.anchorName ? `${bm.anchorName}+${bm.offset}` : `:${bm.line}`} <span className="rel-kind">{bm.text}</span>
            </span>
            <span className="rel-detail">{bm.path}</span>
            <span className="tab-close" onClick={() => remove(bm)}>×</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

App.tsx:
- Workspace의 side-v Group을 3분할: project(45)/symbols(30)/bookmarks(25) — Separator 포함, id "bookmarks".
- openProject 성공 후 `window.si.loadBookmarks().then((l) => st.setBookmarks(l as Bookmark[]))`.
- onKey에 토글 추가:

```ts
if ((ev.metaKey || ev.ctrlKey) && ev.key === 'F2') {
  ev.preventDefault();
  void toggleBookmark();
}
// App 모듈 함수 (computeAnchor/getContent/getCursorLocation import 필요):
async function toggleBookmark(): Promise<void> {
  const st = useAppStore.getState();
  const loc = getCursorLocation();
  if (!loc) return;
  // 같은 path + 같은 저장 line이면 제거, 아니면 추가
  const dup = st.bookmarks.find((b) => b.path === loc.path && b.line === loc.line);
  let next: Bookmark[];
  if (dup) {
    next = st.bookmarks.filter((b) => b !== dup);
  } else {
    const symbols = await window.si.getFileOutline(loc.path).catch(() => []);
    const anchor = computeAnchor(symbols, loc.line);
    const text = (getContent(loc.path)?.split('\n')[loc.line - 1] ?? '').trim().slice(0, 60);
    next = [...st.bookmarks, { path: loc.path, line: loc.line, ...anchor, text }];
  }
  st.setBookmarks(next);
  void window.si.saveBookmarks(next);
}
```

- [ ] **Step 5: 검증 + 커밋**

Run: `npx vitest run tests/bookmarks.test.ts && npm run build && npm test`

```bash
git add src/renderer/src/bookmarks.ts src/renderer/src/components/BookmarksSection.tsx src/main/persistence.ts src/main/main.ts src/preload/preload.ts src/renderer/src/store.ts src/renderer/src/App.tsx tests/bookmarks.test.ts
git commit -m "영구 북마크: 심볼 앵커+오프셋 저장/재해석, 사이드 패널 목록, Cmd/Ctrl+F2 토글"
```

---

### Task 9: E2E 확장 + todo.md 마감

**Files:**
- Create: `tests/e2e/analysis.spec.ts`
- Modify: `todo.md`

**Interfaces:**
- Consumes: Task 1~8 전체. 기존 smoke.spec.ts의 픽스처/기동 패턴.

- [ ] **Step 1: E2E 작성** — `tests/e2e/analysis.spec.ts`

```ts
import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

test('분석 흐름: 검색 점프 → Context → Ctrl+클릭 정의 점프 → 뒤로 → Relation → 북마크', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-an-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'util.c'), 'int helper_fn() {\n  return 42;\n}\n');
  fs.writeFileSync(path.join(proj, 'main.c'), '#include "util.h"\nint helper_fn();\nint main() {\n  return helper_fn();\n}\n');

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: path.join(work, 'ud') },
  });
  try {
    const page = await app.firstWindow();

    // 인덱싱 완료 대기: main.c 열고 아웃라인 확인
    await page.locator('.tree-item', { hasText: 'main.c' }).click();
    await expect(page.locator('.symbol-item', { hasText: 'main' })).toBeVisible({ timeout: 30_000 });

    // 1) 검색 오버레이 → helper 심볼 → Enter 점프 → util.c 활성
    await page.keyboard.press('ControlOrMeta+Shift+f');
    await page.locator('.search-box input').fill('helper');
    await expect(page.locator('.search-item', { hasText: 'helper_fn' }).first()).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Enter');
    await expect(page.locator('.tab.active', { hasText: 'util.c' })).toBeVisible({ timeout: 10_000 });

    // 2) main.c로 복귀 (뒤로)
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(page.locator('.tab.active', { hasText: 'main.c' })).toBeVisible({ timeout: 10_000 });

    // 3) 커서를 helper_fn 호출 위에 → Context에 정의 표시
    await page.locator('.editor-host .view-line span', { hasText: 'helper_fn' }).last().click();
    await expect(page.locator('.context-header', { hasText: 'helper_fn' })).toBeVisible({ timeout: 15_000 });

    // 4) Relation Callers 탭 — helper_fn의 caller에 main
    await page.locator('.rel-tab', { hasText: 'Callers' }).click();
    await expect(page.locator('.rel-item', { hasText: 'main' })).toBeVisible({ timeout: 15_000 });

    // 5) 북마크 토글 → 목록 표시
    await page.keyboard.press('ControlOrMeta+F2');
    await expect(page.locator('.panel-title', { hasText: 'Bookmarks' })).toBeVisible();
    await expect(page.locator('.rel-detail', { hasText: 'main.c' }).first()).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
```

주의: 셀렉터/키 입력이 실제 앱 동작과 어긋나면 **앱의 올바른 동작에 맞춰 테스트를 조정**하고 사유를 기록 (예: Alt+ArrowLeft가 OS 차원에서 소비되면 `.nav-btn` 클릭으로 대체).

- [ ] **Step 2: E2E 실행**

Run: `npm run test:e2e`
Expected: 2 passed (기존 smoke + analysis). 실패 시 Playwright 아티팩트로 디버그.

- [ ] **Step 3: 휴지 상태 복구 + 전체 검증**

Run: `npm run rebuild:node && npm test`
Expected: 전부 PASS (node ABI).

- [ ] **Step 4: todo.md 갱신**

- "Plan 3: 분석 기능" 섹션 체크박스 완료 표기 (계획 문서 작성 항목 포함).
- Plan 3 인계 노트에서 해소된 항목 반영 (스코프 한정: resolve 모듈 도입으로 부분 해소 — 로컬 스코프 한정은 여전히 근사치임을 명시).
- "Plan 4 인계 노트" 섹션 추가: (1) Smart Rename은 getReferences+resolve 조합으로 후보 목록 구성 가능 — 체크박스 미리보기 UI만 필요, (2) 시맨틱 토큰은 getSymbolsForFile+refs로 파일 단위 토큰 구성, (3) Relation 트리 이름 기반 재귀의 동명 혼입 한계, (4) FTS 결과에 줄 정보 없음(findMatches 폴백 사용 중), (5) ABI 이중성 규칙 재확인.

- [ ] **Step 5: 커밋**

```bash
git add tests/e2e/analysis.spec.ts todo.md
git commit -m "분석 기능 E2E(검색·Context·Relation·북마크·내비게이션) + todo.md Plan 3 완료 표기"
```
