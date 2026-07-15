# Plan 1: 기반 + 인덱서 코어 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **실행 모델 지시**: 각 태스크는 OMC `executor` 서브에이전트에 **model=opus**로 위임한다.

**Goal:** Electron에서 네이티브 모듈(tree-sitter, better-sqlite3)이 동작함을 검증하고, 6개 언어의 심볼/참조를 SQLite에 인덱싱·증분 갱신·조회하는 인덱서 코어 라이브러리를 완성한다.

**Architecture:** 순수 Node 라이브러리(`src/indexer/`)로 인덱서를 만들고 vitest로 테스트한다. Electron 셸(`src/main/`)은 이 단계에서는 네이티브 모듈 로드 검증용 스켈레톤만 둔다. UI/IPC 연결은 Plan 2.

**Tech Stack:** TypeScript(CommonJS), node-tree-sitter + 언어 문법 6종, better-sqlite3, chokidar, ignore, vitest, Electron + @electron/rebuild.

**스펙**: `docs/superpowers/specs/2026-07-15-sourceinsight-clone-design.md`

## Global Constraints (스펙 §3.1 — 전 태스크 공통)

- **tree-sitter Query API만 사용**: 심볼 추출은 S-표현식 쿼리로 수행. JS에서 `node.children`류 트리 순회로 심볼을 찾는 코드 금지 (범위 계산용 보조 접근은 캡처된 노드에 한해 허용).
- **WASM 폴백 금지**: `web-tree-sitter` 의존성 추가 금지. 네이티브 로드 실패는 명시적 오류.
- **네이티브 ABI 이중성**: 네이티브 모듈은 Node ABI(테스트용)와 Electron ABI(앱용)를 오간다. `npm run rebuild:node` / `npm run rebuild:electron`으로 전환. **vitest 실행 전에는 반드시 Node ABI 상태여야 한다.**
- **인덱스는 캐시**: DB 스키마 버전 불일치 시 전체 드롭 후 재생성 (마이그레이션 없음).
- 파일 경로는 DB에 **프로젝트 루트 기준 상대경로, `/` 구분자**로 저장.
- tree-sitter 쿼리 컴파일 오류(TSQueryError)가 나면 패턴을 삭제하지 말 것: 스크래치 스크립트에서 `parser.parse(src).rootNode.toString()`으로 실제 노드 타입을 확인해 패턴을 수정한다 (문법 패키지 버전에 따라 노드 이름이 다를 수 있음).
- 성능 기준(스펙 §10): 100만 줄 인덱싱 < 2분. Plan 1은 **직렬 인덱싱**으로 구현하고 Task 11 벤치마크로 검증 — 미달 시에만 worker_threads 풀을 후속 태스크로 추가한다(스펙 §3의 워커 풀은 이 조건부 최적화로 처리, YAGNI).
- 커밋 메시지는 한국어. `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 트레일러 포함.

---

### Task 1: 프로젝트 스캐폴딩 + 테스트 러너

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Produces: `npm run build`(tsc), `npm test`(vitest), 디렉토리 규약 `src/indexer/`, `src/main/`, `src/shared/`, `tests/`

- [ ] **Step 1: 설정 파일 작성**

`package.json`:
```json
{
  "name": "sourceinsight",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main/main.js",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "rebuild:electron": "electron-rebuild -f -w tree-sitter,tree-sitter-c,tree-sitter-cpp,tree-sitter-python,tree-sitter-typescript,tree-sitter-java,better-sqlite3",
    "rebuild:node": "npm rebuild tree-sitter tree-sitter-c tree-sitter-cpp tree-sitter-python tree-sitter-typescript tree-sitter-java better-sqlite3",
    "bench": "node dist/scripts/bench.js"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

`vitest.config.ts` (네이티브 모듈은 worker 풀에서 불안정하므로 forks 필수):
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { pool: 'forks', include: ['tests/**/*.test.ts'], testTimeout: 30000 },
});
```

`.gitignore`:
```
node_modules/
dist/
*.db
*.db-wal
*.db-shm
```

- [ ] **Step 2: 개발 의존성 설치**

Run: `npm install -D typescript vitest @types/node`

- [ ] **Step 3: 스모크 테스트 작성 및 통과 확인**

`tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test`
Expected: 1 passed

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore tests/
git commit -m "빌드/테스트 툴체인 스캐폴딩 (tsc + vitest)"
```

---

### Task 2: 네이티브 의존성 설치 + Node 스모크 테스트

**Files:**
- Modify: `package.json` (의존성 추가)
- Test: `tests/native.test.ts`

**Interfaces:**
- Produces: `tree-sitter` + 문법 6종 + `better-sqlite3`가 Node ABI로 로드·동작함이 보장됨

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/native.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('native modules', () => {
  it('parses C with tree-sitter native binding', () => {
    const Parser = require('tree-sitter');
    const C = require('tree-sitter-c');
    const parser = new Parser();
    parser.setLanguage(C);
    const tree = parser.parse('int main() { return 0; }');
    expect(tree.rootNode.type).toBe('translation_unit');
  });

  it('loads all six grammars', () => {
    const Parser = require('tree-sitter');
    const grammars = [
      require('tree-sitter-c'),
      require('tree-sitter-cpp'),
      require('tree-sitter-python'),
      require('tree-sitter-typescript').typescript,
      require('tree-sitter-typescript').tsx,
      require('tree-sitter-java'),
    ];
    for (const g of grammars) {
      const p = new Parser();
      expect(() => p.setLanguage(g)).not.toThrow();
    }
  });

  it('opens an in-memory sqlite db', () => {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t (x)');
    db.prepare('INSERT INTO t VALUES (?)').run(42);
    expect(db.prepare('SELECT x FROM t').get()).toEqual({ x: 42 });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module 'tree-sitter'`

- [ ] **Step 3: 의존성 설치**

Run:
```bash
npm install tree-sitter tree-sitter-c tree-sitter-cpp tree-sitter-python tree-sitter-typescript tree-sitter-java better-sqlite3 chokidar ignore
npm install -D electron @electron/rebuild @types/better-sqlite3
```

주의: `setLanguage`에서 "Incompatible language version" 오류가 나면 node-tree-sitter와 문법 패키지의 ABI 버전 불일치다. `tree-sitter` 패키지 README의 호환 표를 확인해 문법 패키지 버전을 맞춰 재설치한다 (예: `npm install tree-sitter-c@0.21`). 전부 통과할 때까지 버전을 고정한다.

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: PASS (native.test.ts 3개 모두)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tests/native.test.ts
git commit -m "네이티브 의존성 추가: tree-sitter 문법 6종 + better-sqlite3 스모크 테스트"
```

---

### Task 3: Electron 스켈레톤 + ABI 재빌드 검증 (스펙 §3.1 마일스톤)

**Files:**
- Create: `src/main/main.ts`, `src/indexer/probe.ts`

**Interfaces:**
- Produces: "Electron utilityProcess에서 네이티브 모듈 2종이 로드된다"는 사실. Plan 2의 인덱서 호스팅이 이 구조를 그대로 확장한다.

- [ ] **Step 1: 프로브 작성**

`src/indexer/probe.ts`:
```ts
// Electron utilityProcess에서 실행되어 네이티브 모듈 로드 가능 여부를 보고한다.
try {
  const Parser = require('tree-sitter');
  const C = require('tree-sitter-c');
  const Database = require('better-sqlite3');
  const p = new Parser();
  p.setLanguage(C);
  p.parse('int x;');
  new Database(':memory:').exec('CREATE TABLE t (x)');
  process.parentPort.postMessage({ ok: true });
} catch (e) {
  process.parentPort.postMessage({ ok: false, error: String(e) });
}
```

`src/main/main.ts`:
```ts
import { app, BrowserWindow, utilityProcess } from 'electron';
import * as path from 'path';

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 900, height: 600 });
  win.loadURL('data:text/html,<h1>SourceInSight skeleton</h1>');
  const probe = utilityProcess.fork(path.join(__dirname, '..', 'indexer', 'probe.js'));
  probe.on('message', (msg: unknown) => {
    console.log('[native-probe]', JSON.stringify(msg));
    if (!(msg as { ok: boolean }).ok) process.exit(1);
  });
});
app.on('window-all-closed', () => app.quit());
```

- [ ] **Step 2: Electron ABI로 재빌드 후 실행 검증**

Run:
```bash
npm run build
npm run rebuild:electron
npx electron .
```
Expected: 창이 뜨고 터미널에 `[native-probe] {"ok":true}` 출력. `ok:false`면 rebuild 대상 모듈 누락이므로 스크립트의 `-w` 목록을 점검한다.
확인 후 창을 닫는다.

- [ ] **Step 3: Node ABI 복원 후 기존 테스트 통과 확인**

Run:
```bash
npm run rebuild:node
npm test
```
Expected: PASS (Task 2 테스트가 다시 통과 = 양방향 전환 검증)

- [ ] **Step 4: Commit**

```bash
git add src/main/main.ts src/indexer/probe.ts
git commit -m "Electron 스켈레톤: utilityProcess 네이티브 모듈 로드 검증 (스펙 §3.1 마일스톤)"
```

---

### Task 4: 이름 조각 분해 유틸 (Name Fragment)

**Files:**
- Create: `src/indexer/fragments.ts`
- Test: `tests/fragments.test.ts`

**Interfaces:**
- Produces: `splitName(name: string): string[]` — 소문자 조각 배열(중복 제거, 길이 2 이상). Task 8 인덱싱과 Task 10 검색이 동일 함수를 사용해야 한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/fragments.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { splitName } from '../src/indexer/fragments';

describe('splitName', () => {
  it('splits camelCase', () => {
    expect(splitName('CreateWindow')).toEqual(['create', 'window']);
  });
  it('splits snake_case', () => {
    expect(splitName('create_widget_ex')).toEqual(['create', 'widget', 'ex']);
  });
  it('handles consecutive capitals', () => {
    expect(splitName('parseHTMLDocument')).toEqual(['parse', 'html', 'document']);
  });
  it('drops 1-char fragments and dedups', () => {
    expect(splitName('a_map_map')).toEqual(['map']);
  });
  it('returns [] for empty', () => {
    expect(splitName('')).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- fragments`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/indexer/fragments.ts`:
```ts
export function splitName(name: string): string[] {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  const parts = spaced
    .split(/[^a-zA-Z0-9]+/)
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 1);
  return [...new Set(parts)];
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- fragments`
Expected: PASS 5개

- [ ] **Step 5: Commit**

```bash
git add src/indexer/fragments.ts tests/fragments.test.ts
git commit -m "심볼 이름 조각 분해 유틸 (camelCase/snake_case → fragment)"
```

---

### Task 5: 심볼 DB 모듈 (스키마 + 버전 관리)

**Files:**
- Create: `src/indexer/db.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Produces:
  - `SCHEMA_VERSION: number`
  - `openDb(dbPath: string): Database.Database` — WAL+mmap 설정, 스키마 버전 불일치 시 전체 재생성
  - 테이블: `meta`, `files`, `symbols`, `refs`, `name_fragments`, `file_text`(FTS5) — 아래 SQL이 정본

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { openDb, SCHEMA_VERSION } from '../src/indexer/db';

describe('openDb', () => {
  it('creates schema on fresh db', () => {
    const db = openDb(':memory:');
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name`)
      .all()
      .map((r: any) => r.name);
    for (const t of ['meta', 'files', 'symbols', 'refs', 'name_fragments', 'file_text']) {
      expect(tables).toContain(t);
    }
    const v = db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get() as any;
    expect(Number(v.value)).toBe(SCHEMA_VERSION);
  });

  it('cascades symbol/ref/fragment deletion when file is deleted', () => {
    const db = openDb(':memory:');
    const fid = db.prepare(`INSERT INTO files (path,hash,language,indexed_at) VALUES ('a.c','h','c',0)`).run().lastInsertRowid;
    const sid = db.prepare(`INSERT INTO symbols (name,kind,file_id,start_line,start_col,end_line,end_col) VALUES ('f','function',?,0,0,1,0)`).run(fid).lastInsertRowid;
    db.prepare(`INSERT INTO name_fragments (fragment,symbol_id) VALUES ('f2',?)`).run(sid);
    db.prepare(`INSERT INTO refs (name,kind,file_id,line,col) VALUES ('g','call',?,0,0)`).run(fid);
    db.prepare(`DELETE FROM files WHERE id=?`).run(fid);
    expect(db.prepare(`SELECT count(*) c FROM symbols`).get()).toEqual({ c: 0 });
    expect(db.prepare(`SELECT count(*) c FROM refs`).get()).toEqual({ c: 0 });
    expect(db.prepare(`SELECT count(*) c FROM name_fragments`).get()).toEqual({ c: 0 });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- db`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/indexer/db.ts`:
```ts
import Database from 'better-sqlite3';

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  hash TEXT NOT NULL,
  language TEXT NOT NULL,
  indexed_at INTEGER NOT NULL
);
CREATE TABLE symbols (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  start_line INTEGER NOT NULL,
  start_col INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  end_col INTEGER NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  signature TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_symbols_name ON symbols(name);
CREATE INDEX idx_symbols_file ON symbols(file_id);
CREATE TABLE refs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  line INTEGER NOT NULL,
  col INTEGER NOT NULL,
  enclosing_symbol_id INTEGER
);
CREATE INDEX idx_refs_name ON refs(name);
CREATE INDEX idx_refs_file ON refs(file_id);
CREATE TABLE name_fragments (
  fragment TEXT NOT NULL,
  symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE
);
CREATE INDEX idx_fragments ON name_fragments(fragment);
CREATE VIRTUAL TABLE file_text USING fts5(path UNINDEXED, content);
`;

export function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('mmap_size = 268435456');
  db.pragma('foreign_keys = ON');
  const hasMeta = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='meta'`)
    .get();
  const row = hasMeta
    ? (db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get() as { value: string } | undefined)
    : undefined;
  if (!row || Number(row.value) !== SCHEMA_VERSION) rebuildSchema(db);
  return db;
}

function rebuildSchema(db: Database.Database): void {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    DROP TABLE IF EXISTS name_fragments;
    DROP TABLE IF EXISTS refs;
    DROP TABLE IF EXISTS symbols;
    DROP TABLE IF EXISTS files;
    DROP TABLE IF EXISTS meta;
    DROP TABLE IF EXISTS file_text;
  `);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)`).run(String(SCHEMA_VERSION));
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- db`
Expected: PASS 2개

- [ ] **Step 5: Commit**

```bash
git add src/indexer/db.ts tests/db.test.ts
git commit -m "심볼 DB 스키마 및 버전 기반 재생성 (WAL+mmap, FK cascade, FTS5)"
```

---

### Task 6: 언어 레지스트리 + 심볼 추출기 (C, TypeScript)

**Files:**
- Create: `src/indexer/languages.ts`, `src/indexer/extractor.ts`
- Test: `tests/extractor.test.ts`

**Interfaces:**
- Produces:
  - `languages.ts`: `interface LanguageSpec { id: string; extensions: string[]; grammar: unknown; query: string }`, `languageForPath(p: string): LanguageSpec | null`, `getParser(spec): Parser`, `getQuery(spec): Parser.Query` (파서/쿼리는 언어별 캐시)
  - `extractor.ts`:
    ```ts
    interface SymbolRow { name: string; kind: string; startLine: number; startCol: number; endLine: number; endCol: number; scope: string; signature: string }
    interface RefRow { name: string; kind: 'call'; line: number; col: number; enclosingIndex: number | null } // symbols 배열 인덱스
    interface ExtractResult { symbols: SymbolRow[]; refs: RefRow[] }
    function extractFile(source: string, spec: LanguageSpec): ExtractResult
    ```
  - 쿼리 규약: 정의 패턴은 식별자에 `@name` + 정의 노드에 `@def.<kind>`, 호출 참조는 이름 노드에 `@ref.call`. **이후 모든 언어 추가는 이 규약만 따르면 코드 수정 없이 동작한다.**

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/extractor.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { extractFile } from '../src/indexer/extractor';
import { languageForPath } from '../src/indexer/languages';

const C_SRC = `
#define MAX_SIZE 100
struct Widget { int id; };
int counter;
static int helper(int x) { return x * 2; }
int create_widget(int id) {
  counter++;
  return helper(id);
}
`;

const TS_SRC = `
export const MAX = 10;
interface Shape { area(): number; }
export class Circle {
  radius = 1;
  area(): number { return 3.14 * this.radius * this.radius; }
}
export function makeCircle(): Circle {
  const c = new Circle();
  console.log(c.area());
  return c;
}
`;

function byName(result: { symbols: { name: string; kind: string; scope: string }[] }, name: string) {
  return result.symbols.find((s) => s.name === name);
}

describe('extractFile (C)', () => {
  const spec = languageForPath('a.c')!;
  const r = extractFile(C_SRC, spec);

  it('extracts function, struct, macro, global variable', () => {
    expect(byName(r, 'create_widget')?.kind).toBe('function');
    expect(byName(r, 'helper')?.kind).toBe('function');
    expect(byName(r, 'Widget')?.kind).toBe('struct');
    expect(byName(r, 'MAX_SIZE')?.kind).toBe('macro');
    expect(byName(r, 'counter')?.kind).toBe('variable');
  });

  it('captures call refs with enclosing function', () => {
    const call = r.refs.find((x) => x.name === 'helper');
    expect(call).toBeDefined();
    expect(r.symbols[call!.enclosingIndex!].name).toBe('create_widget');
  });

  it('fills signature with first line of definition', () => {
    expect(byName(r, 'create_widget')?.name).toBe('create_widget');
    expect(r.symbols.find((s) => s.name === 'create_widget')!.signature).toContain('int create_widget(int id)');
  });
});

describe('extractFile (TypeScript)', () => {
  const spec = languageForPath('a.ts')!;
  const r = extractFile(TS_SRC, spec);

  it('extracts class, method, interface, function, const', () => {
    expect(byName(r, 'Circle')?.kind).toBe('class');
    expect(byName(r, 'area')?.kind).toBe('method');
    expect(byName(r, 'Shape')?.kind).toBe('interface');
    expect(byName(r, 'makeCircle')?.kind).toBe('function');
    expect(byName(r, 'MAX')?.kind).toBe('variable');
  });

  it('sets scope from enclosing class', () => {
    const area = r.symbols.find((s) => s.name === 'area' && s.kind === 'method');
    expect(area?.scope).toBe('Circle');
  });

  it('captures method call ref (c.area())', () => {
    expect(r.refs.some((x) => x.name === 'area')).toBe(true);
  });
});

describe('error tolerance', () => {
  it('extracts symbols from broken code', () => {
    const spec = languageForPath('b.c')!;
    const r = extractFile('int ok_func() { return 1; }\nint broken( {{{', spec);
    expect(byName(r, 'ok_func')?.kind).toBe('function');
  });
});

describe('languageForPath', () => {
  it('maps extensions', () => {
    expect(languageForPath('x.c')?.id).toBe('c');
    expect(languageForPath('x.ts')?.id).toBe('typescript');
    expect(languageForPath('x.tsx')?.id).toBe('tsx');
    expect(languageForPath('x.txt')).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- extractor`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: languages.ts 구현**

`src/indexer/languages.ts`:
```ts
import Parser = require('tree-sitter');
import * as path from 'path';

export interface LanguageSpec {
  id: string;
  extensions: string[];
  grammar: unknown;
  query: string;
}

const C_QUERY = `
(function_definition declarator: (function_declarator declarator: (identifier) @name)) @def.function
(type_definition declarator: (type_identifier) @name) @def.type
(struct_specifier name: (type_identifier) @name body: (field_declaration_list)) @def.struct
(enum_specifier name: (type_identifier) @name body: (enumerator_list)) @def.enum
(preproc_def name: (identifier) @name) @def.macro
(preproc_function_def name: (identifier) @name) @def.macro
(translation_unit (declaration declarator: (identifier) @name) @def.variable)
(translation_unit (declaration declarator: (init_declarator declarator: (identifier) @name)) @def.variable)
(call_expression function: (identifier) @ref.call)
`;

const TS_QUERY = `
(function_declaration name: (identifier) @name) @def.function
(class_declaration name: (type_identifier) @name) @def.class
(method_definition name: (property_identifier) @name) @def.method
(interface_declaration name: (type_identifier) @name) @def.interface
(type_alias_declaration name: (type_identifier) @name) @def.type
(enum_declaration name: (identifier) @name) @def.enum
(program (lexical_declaration (variable_declarator name: (identifier) @name) @def.variable))
(program (export_statement (lexical_declaration (variable_declarator name: (identifier) @name) @def.variable)))
(public_field_definition name: (property_identifier) @name) @def.field
(call_expression function: (identifier) @ref.call)
(call_expression function: (member_expression property: (property_identifier) @ref.call))
(new_expression constructor: (identifier) @ref.call)
`;

// eslint 없음 — require는 문법 패키지에 타입 정의가 없어 불가피
const tsGrammar = require('tree-sitter-typescript');

export const LANGUAGES: LanguageSpec[] = [
  { id: 'c', extensions: ['.c', '.h'], grammar: require('tree-sitter-c'), query: C_QUERY },
  { id: 'typescript', extensions: ['.ts', '.js', '.mjs', '.cjs'], grammar: tsGrammar.typescript, query: TS_QUERY },
  { id: 'tsx', extensions: ['.tsx', '.jsx'], grammar: tsGrammar.tsx, query: TS_QUERY },
];

const byExt = new Map<string, LanguageSpec>();
for (const l of LANGUAGES) for (const e of l.extensions) byExt.set(e, l);

export function languageForPath(p: string): LanguageSpec | null {
  return byExt.get(path.extname(p).toLowerCase()) ?? null;
}

const parserCache = new Map<string, Parser>();
const queryCache = new Map<string, Parser.Query>();

export function getParser(spec: LanguageSpec): Parser {
  let p = parserCache.get(spec.id);
  if (!p) {
    p = new Parser();
    p.setLanguage(spec.grammar as Parser.Language);
    parserCache.set(spec.id, p);
  }
  return p;
}

export function getQuery(spec: LanguageSpec): Parser.Query {
  let q = queryCache.get(spec.id);
  if (!q) {
    q = new Parser.Query(spec.grammar as Parser.Language, spec.query);
    queryCache.set(spec.id, q);
  }
  return q;
}
```

주의: `.h`는 MVP에서 C로 처리(C++ 헤더 구분은 v2). 쿼리 컴파일 오류 시 Global Constraints의 절차를 따른다.

- [ ] **Step 4: extractor.ts 구현**

`src/indexer/extractor.ts`:
```ts
import { LanguageSpec, getParser, getQuery } from './languages';

export interface SymbolRow {
  name: string;
  kind: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  scope: string;
  signature: string;
}

export interface RefRow {
  name: string;
  kind: 'call';
  line: number;
  col: number;
  enclosingIndex: number | null;
}

export interface ExtractResult {
  symbols: SymbolRow[];
  refs: RefRow[];
}

const SCOPE_KINDS = new Set(['function', 'method', 'class', 'struct', 'interface', 'namespace']);
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB 초과 파일은 스킵 (생성 코드 방어)

function firstLine(text: string): string {
  const nl = text.indexOf('\n');
  return (nl === -1 ? text : text.slice(0, nl)).slice(0, 200).trim();
}

function posLE(aL: number, aC: number, bL: number, bC: number): boolean {
  return aL < bL || (aL === bL && aC <= bC);
}

function containsPoint(s: SymbolRow, line: number, col: number): boolean {
  return posLE(s.startLine, s.startCol, line, col) && posLE(line, col, s.endLine, s.endCol);
}

function containsRange(outer: SymbolRow, inner: SymbolRow): boolean {
  return (
    (outer.startLine !== inner.startLine || outer.startCol !== inner.startCol || outer.endLine !== inner.endLine) &&
    posLE(outer.startLine, outer.startCol, inner.startLine, inner.startCol) &&
    posLE(inner.endLine, inner.endCol, outer.endLine, outer.endCol)
  );
}

function rangeSize(s: SymbolRow): number {
  return (s.endLine - s.startLine) * 100000 + (s.endCol - s.startCol);
}

export function extractFile(source: string, spec: LanguageSpec): ExtractResult {
  if (Buffer.byteLength(source) > MAX_FILE_BYTES) return { symbols: [], refs: [] };
  const tree = getParser(spec).parse(source);
  const query = getQuery(spec);
  const symbols: SymbolRow[] = [];
  const rawRefs: { name: string; line: number; col: number }[] = [];
  const seen = new Set<string>();

  for (const match of query.matches(tree.rootNode)) {
    const defCap = match.captures.find((c) => c.name.startsWith('def.'));
    const nameCap = match.captures.find((c) => c.name === 'name');
    const refCap = match.captures.find((c) => c.name === 'ref.call');
    if (defCap && nameCap) {
      const d = defCap.node;
      const key = `${nameCap.node.text}:${d.startIndex}:${defCap.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      symbols.push({
        name: nameCap.node.text,
        kind: defCap.name.slice(4),
        startLine: d.startPosition.row,
        startCol: d.startPosition.column,
        endLine: d.endPosition.row,
        endCol: d.endPosition.column,
        scope: '',
        signature: firstLine(d.text),
      });
    } else if (refCap) {
      rawRefs.push({
        name: refCap.node.text,
        line: refCap.node.startPosition.row,
        col: refCap.node.startPosition.column,
      });
    }
  }

  // 스코프: 자신을 포함하는 SCOPE_KINDS 정의들의 이름을 바깥→안 순서로 연결
  for (const s of symbols) {
    const containers = symbols
      .filter((o) => SCOPE_KINDS.has(o.kind) && containsRange(o, s))
      .sort((a, b) => rangeSize(b) - rangeSize(a));
    s.scope = containers.map((c) => c.name).join('::');
  }

  const refs: RefRow[] = rawRefs.map((r) => {
    const enclosing = symbols
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => SCOPE_KINDS.has(s.kind) && containsPoint(s, r.line, r.col))
      .sort((a, b) => rangeSize(a.s) - rangeSize(b.s))[0];
    return { name: r.name, kind: 'call', line: r.line, col: r.col, enclosingIndex: enclosing ? enclosing.i : null };
  });

  return { symbols, refs };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm test -- extractor`
Expected: PASS 전체. 쿼리 패턴이 문법 버전과 안 맞으면 Global Constraints 절차로 패턴 수정 후 재실행.

- [ ] **Step 6: Commit**

```bash
git add src/indexer/languages.ts src/indexer/extractor.ts tests/extractor.test.ts
git commit -m "심볼 추출기: Query API 기반 C/TypeScript 정의·호출 추출, 스코프 계산"
```

---

### Task 7: 나머지 언어 쿼리 (C++, Python, Java)

**Files:**
- Modify: `src/indexer/languages.ts` (LANGUAGES 배열에 3개 추가)
- Test: `tests/extractor-langs.test.ts`

**Interfaces:**
- Consumes: Task 6의 쿼리 규약 (`@def.<kind>` + `@name`, `@ref.call`)
- Produces: `.cpp/.cc/.hpp → cpp`, `.py → python`, `.java → java` 매핑

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/extractor-langs.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { extractFile } from '../src/indexer/extractor';
import { languageForPath } from '../src/indexer/languages';

describe('C++', () => {
  const src = `
namespace app {
class Widget {
 public:
  int area();
};
int Widget::area() { return compute(); }
}
`;
  const r = extractFile(src, languageForPath('a.cpp')!);
  it('extracts namespace, class, method', () => {
    expect(r.symbols.find((s) => s.name === 'app')?.kind).toBe('namespace');
    expect(r.symbols.find((s) => s.name === 'Widget')?.kind).toBe('class');
    expect(r.symbols.some((s) => s.name === 'area' && (s.kind === 'method' || s.kind === 'function'))).toBe(true);
  });
  it('captures call ref', () => {
    expect(r.refs.some((x) => x.name === 'compute')).toBe(true);
  });
});

describe('Python', () => {
  const src = `
MAX = 10

class Service:
    def handle(self, req):
        return validate(req)

def main():
    s = Service()
    s.handle(1)
`;
  const r = extractFile(src, languageForPath('a.py')!);
  it('extracts class, function, module variable', () => {
    expect(r.symbols.find((s) => s.name === 'Service')?.kind).toBe('class');
    expect(r.symbols.find((s) => s.name === 'handle')?.kind).toBe('function');
    expect(r.symbols.find((s) => s.name === 'main')?.kind).toBe('function');
    expect(r.symbols.find((s) => s.name === 'MAX')?.kind).toBe('variable');
  });
  it('scope of handle is Service', () => {
    expect(r.symbols.find((s) => s.name === 'handle')?.scope).toBe('Service');
  });
  it('captures method call ref', () => {
    expect(r.refs.some((x) => x.name === 'handle')).toBe(true);
    expect(r.refs.some((x) => x.name === 'validate')).toBe(true);
  });
});

describe('Java', () => {
  const src = `
public class OrderService {
    private int count;
    public OrderService() {}
    public void process(Order o) {
        repository.save(o);
    }
}
`;
  const r = extractFile(src, languageForPath('A.java')!);
  it('extracts class, method, field, constructor', () => {
    expect(r.symbols.find((s) => s.name === 'OrderService' && s.kind === 'class')).toBeDefined();
    expect(r.symbols.find((s) => s.name === 'process')?.kind).toBe('method');
    expect(r.symbols.find((s) => s.name === 'count')?.kind).toBe('field');
  });
  it('captures call ref with enclosing method', () => {
    const call = r.refs.find((x) => x.name === 'save');
    expect(call).toBeDefined();
    expect(r.symbols[call!.enclosingIndex!].name).toBe('process');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- extractor-langs`
Expected: FAIL — `languageForPath('a.cpp')`가 null

- [ ] **Step 3: 쿼리 추가**

`src/indexer/languages.ts`에 추가:
```ts
const CPP_QUERY = `
(function_definition declarator: (function_declarator declarator: (identifier) @name)) @def.function
(function_definition declarator: (function_declarator declarator: (qualified_identifier name: (identifier) @name))) @def.method
(class_specifier name: (type_identifier) @name body: (field_declaration_list)) @def.class
(struct_specifier name: (type_identifier) @name body: (field_declaration_list)) @def.struct
(namespace_definition name: (namespace_identifier) @name) @def.namespace
(field_declaration declarator: (function_declarator declarator: (field_identifier) @name)) @def.method
(type_definition declarator: (type_identifier) @name) @def.type
(enum_specifier name: (type_identifier) @name) @def.enum
(preproc_def name: (identifier) @name) @def.macro
(preproc_function_def name: (identifier) @name) @def.macro
(call_expression function: (identifier) @ref.call)
(call_expression function: (field_expression field: (field_identifier) @ref.call))
`;

const PY_QUERY = `
(function_definition name: (identifier) @name) @def.function
(class_definition name: (identifier) @name) @def.class
(module (expression_statement (assignment left: (identifier) @name) @def.variable))
(call function: (identifier) @ref.call)
(call function: (attribute attribute: (identifier) @ref.call))
`;

const JAVA_QUERY = `
(class_declaration name: (identifier) @name) @def.class
(interface_declaration name: (identifier) @name) @def.interface
(enum_declaration name: (identifier) @name) @def.enum
(method_declaration name: (identifier) @name) @def.method
(constructor_declaration name: (identifier) @name) @def.method
(field_declaration declarator: (variable_declarator name: (identifier) @name)) @def.field
(method_invocation name: (identifier) @ref.call)
(object_creation_expression type: (type_identifier) @ref.call)
`;
```

`LANGUAGES` 배열에 추가:
```ts
  { id: 'cpp', extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh'], grammar: require('tree-sitter-cpp'), query: CPP_QUERY },
  { id: 'python', extensions: ['.py'], grammar: require('tree-sitter-python'), query: PY_QUERY },
  { id: 'java', extensions: ['.java'], grammar: require('tree-sitter-java'), query: JAVA_QUERY },
```

주의: `namespace_definition`의 name이 문법 버전에 따라 `(namespace_identifier)` 또는 `(identifier)`다. 컴파일 오류 시 둘 다 시도.

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: 전체 PASS (기존 테스트 회귀 포함)

- [ ] **Step 5: Commit**

```bash
git add src/indexer/languages.ts tests/extractor-langs.test.ts
git commit -m "C++/Python/Java 심볼 추출 쿼리 추가 (지원 언어 6종 완성)"
```

---

### Task 8: 프로젝트 스캐너 + 인덱싱 파이프라인

**Files:**
- Create: `src/indexer/scanner.ts`, `src/indexer/pipeline.ts`
- Test: `tests/pipeline.test.ts`, 픽스처 `tests/fixtures/sample/` (아래 파일들)

**Interfaces:**
- Consumes: `openDb`, `extractFile`, `languageForPath`, `splitName`
- Produces:
  - `scanProject(root: string): string[]` — 지원 확장자 파일의 절대경로 (.gitignore 존중, node_modules/.git/dist 항상 제외)
  - ```ts
    interface IndexStats { files: number; symbols: number; refs: number; skipped: number }
    type ProgressFn = (done: number, total: number, file: string) => void
    class Indexer {
      constructor(db: Database.Database, root: string)
      indexProject(onProgress?: ProgressFn): IndexStats
      indexFile(absPath: string): boolean   // false = 해시 동일로 스킵
      removeFile(absPath: string): void
    }
    ```
  - FTS rowid = files.id 규약 (삭제를 rowid로 수행)

- [ ] **Step 1: 픽스처 작성**

`tests/fixtures/sample/util.c`:
```c
int create_widget(int id) { return id * 2; }
```
`tests/fixtures/sample/main.c`:
```c
int create_widget(int);
int main(void) { return create_widget(7); }
```
`tests/fixtures/sample/app.ts`:
```ts
export function startApp(): string { return 'unique_needle_string'; }
```
`tests/fixtures/sample/.gitignore`:
```
generated/
```
`tests/fixtures/sample/generated/skip_me.c`:
```c
int should_not_be_indexed(void) { return 0; }
```

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/pipeline.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { openDb } from '../src/indexer/db';
import { scanProject } from '../src/indexer/scanner';
import { Indexer } from '../src/indexer/pipeline';

const FIXTURE = path.join(__dirname, 'fixtures', 'sample');

describe('scanProject', () => {
  it('finds supported files and respects .gitignore', () => {
    const files = scanProject(FIXTURE).map((f) => path.basename(f));
    expect(files).toContain('util.c');
    expect(files).toContain('main.c');
    expect(files).toContain('app.ts');
    expect(files).not.toContain('skip_me.c');
    expect(files).not.toContain('.gitignore');
  });
});

describe('Indexer', () => {
  let db: ReturnType<typeof openDb>;
  let idx: Indexer;
  beforeEach(() => {
    db = openDb(':memory:');
    idx = new Indexer(db, FIXTURE);
  });

  it('indexes the fixture project', () => {
    const stats = idx.indexProject();
    expect(stats.files).toBe(3);
    const sym = db.prepare(`SELECT s.name, f.path FROM symbols s JOIN files f ON f.id=s.file_id WHERE s.name='create_widget' AND s.kind='function'`).all() as any[];
    expect(sym).toHaveLength(1);
    expect(sym[0].path).toBe('util.c');
    const frag = db.prepare(`SELECT count(*) c FROM name_fragments nf JOIN symbols s ON s.id=nf.symbol_id WHERE s.name='create_widget'`).get() as any;
    expect(frag.c).toBe(2); // create, widget
    const fts = db.prepare(`SELECT path FROM file_text WHERE file_text MATCH '"unique_needle_string"'`).all() as any[];
    expect(fts.map((r) => r.path)).toEqual(['app.ts']);
  });

  it('skips unchanged files on reindex', () => {
    idx.indexProject();
    const stats2 = idx.indexProject();
    expect(stats2.skipped).toBe(3);
  });

  it('updates a changed file without duplicating rows', () => {
    idx.indexProject();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'si-'));
    for (const f of ['util.c', 'main.c']) fs.copyFileSync(path.join(FIXTURE, f), path.join(tmp, f));
    const db2 = openDb(':memory:');
    const idx2 = new Indexer(db2, tmp);
    idx2.indexProject();
    fs.writeFileSync(path.join(tmp, 'util.c'), 'int create_widget(int id) { return id * 3; }\nint destroy_widget(int id) { return 0; }\n');
    idx2.indexFile(path.join(tmp, 'util.c'));
    const names = (db2.prepare(`SELECT name FROM symbols ORDER BY name`).all() as any[]).map((r) => r.name);
    expect(names.filter((n) => n === 'create_widget')).toHaveLength(1);
    expect(names).toContain('destroy_widget');
  });

  it('removeFile deletes all rows for the file', () => {
    idx.indexProject();
    idx.removeFile(path.join(FIXTURE, 'util.c'));
    expect(db.prepare(`SELECT count(*) c FROM files WHERE path='util.c'`).get()).toEqual({ c: 0 });
    expect(db.prepare(`SELECT count(*) c FROM symbols s JOIN files f ON f.id=s.file_id WHERE f.path='util.c'`).get()).toEqual({ c: 0 });
    expect(db.prepare(`SELECT count(*) c FROM file_text WHERE path='util.c'`).get()).toEqual({ c: 0 });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm test -- pipeline`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: scanner.ts 구현**

`src/indexer/scanner.ts`:
```ts
import * as fs from 'fs';
import * as path from 'path';
import ignore from 'ignore';
import { languageForPath } from './languages';

const ALWAYS_SKIP = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.cache']);

export function scanProject(root: string): string[] {
  const ig = ignore();
  const giPath = path.join(root, '.gitignore');
  if (fs.existsSync(giPath)) ig.add(fs.readFileSync(giPath, 'utf8'));
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 권한 오류 등은 건너뜀
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (ALWAYS_SKIP.has(entry.name) || ig.ignores(rel + '/')) continue;
        walk(abs);
      } else if (entry.isFile()) {
        if (ig.ignores(rel)) continue;
        if (languageForPath(abs)) out.push(abs);
      }
    }
  };
  walk(root);
  return out.sort();
}
```

- [ ] **Step 5: pipeline.ts 구현**

`src/indexer/pipeline.ts`:
```ts
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import { extractFile } from './extractor';
import { languageForPath } from './languages';
import { splitName } from './fragments';
import { scanProject } from './scanner';

export interface IndexStats {
  files: number;
  symbols: number;
  refs: number;
  skipped: number;
}

export type ProgressFn = (done: number, total: number, file: string) => void;

export class Indexer {
  constructor(
    private db: Database,
    private root: string,
  ) {}

  private toRel(absPath: string): string {
    return path.relative(this.root, absPath).split(path.sep).join('/');
  }

  indexProject(onProgress?: ProgressFn): IndexStats {
    const files = scanProject(this.root);
    const stats: IndexStats = { files: 0, symbols: 0, refs: 0, skipped: 0 };
    let done = 0;
    for (const abs of files) {
      const changed = this.indexFile(abs);
      if (changed) stats.files++;
      else stats.skipped++;
      done++;
      onProgress?.(done, files.length, this.toRel(abs));
    }
    // 디스크에서 사라진 파일 정리
    const rels = new Set(files.map((f) => this.toRel(f)));
    const known = this.db.prepare(`SELECT id, path FROM files`).all() as { id: number; path: string }[];
    for (const k of known) {
      if (!rels.has(k.path)) {
        this.db.prepare(`DELETE FROM files WHERE id=?`).run(k.id);
        this.db.prepare(`DELETE FROM file_text WHERE rowid=?`).run(k.id);
      }
    }
    const c = this.db.prepare(`SELECT (SELECT count(*) FROM symbols) s, (SELECT count(*) FROM refs) r`).get() as { s: number; r: number };
    stats.symbols = c.s;
    stats.refs = c.r;
    return stats;
  }

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
    const rel = this.toRel(absPath);
    const hash = crypto.createHash('sha1').update(content).digest('hex');
    const existing = this.db.prepare(`SELECT id, hash FROM files WHERE path=?`).get(rel) as { id: number; hash: string } | undefined;
    if (existing && existing.hash === hash) return false;

    const { symbols, refs } = extractFile(content, spec);
    const tx = this.db.transaction(() => {
      let fileId: number;
      if (existing) {
        fileId = existing.id;
        this.db.prepare(`UPDATE files SET hash=?, language=?, indexed_at=? WHERE id=?`).run(hash, spec.id, Date.now(), fileId);
        this.db.prepare(`DELETE FROM symbols WHERE file_id=?`).run(fileId);
        this.db.prepare(`DELETE FROM refs WHERE file_id=?`).run(fileId);
        this.db.prepare(`DELETE FROM file_text WHERE rowid=?`).run(fileId);
      } else {
        fileId = Number(
          this.db.prepare(`INSERT INTO files (path, hash, language, indexed_at) VALUES (?,?,?,?)`).run(rel, hash, spec.id, Date.now()).lastInsertRowid,
        );
      }
      const insSym = this.db.prepare(
        `INSERT INTO symbols (name,kind,file_id,start_line,start_col,end_line,end_col,scope,signature) VALUES (?,?,?,?,?,?,?,?,?)`,
      );
      const insFrag = this.db.prepare(`INSERT INTO name_fragments (fragment, symbol_id) VALUES (?,?)`);
      const ids: number[] = [];
      for (const s of symbols) {
        const id = Number(insSym.run(s.name, s.kind, fileId, s.startLine, s.startCol, s.endLine, s.endCol, s.scope, s.signature).lastInsertRowid);
        ids.push(id);
        for (const f of splitName(s.name)) insFrag.run(f, id);
      }
      const insRef = this.db.prepare(`INSERT INTO refs (name,kind,file_id,line,col,enclosing_symbol_id) VALUES (?,?,?,?,?,?)`);
      for (const r of refs) {
        insRef.run(r.name, r.kind, fileId, r.line, r.col, r.enclosingIndex === null ? null : ids[r.enclosingIndex]);
      }
      this.db.prepare(`INSERT INTO file_text (rowid, path, content) VALUES (?,?,?)`).run(fileId, rel, content);
    });
    tx();
    return true;
  }

  removeFile(absPath: string): void {
    const rel = this.toRel(absPath);
    const row = this.db.prepare(`SELECT id FROM files WHERE path=?`).get(rel) as { id: number } | undefined;
    if (!row) return;
    this.db.prepare(`DELETE FROM files WHERE id=?`).run(row.id); // symbols/refs/fragments는 cascade
    this.db.prepare(`DELETE FROM file_text WHERE rowid=?`).run(row.id);
  }
}
```

- [ ] **Step 6: 통과 확인**

Run: `npm test -- pipeline`
Expected: PASS 5개

- [ ] **Step 7: Commit**

```bash
git add src/indexer/scanner.ts src/indexer/pipeline.ts tests/pipeline.test.ts tests/fixtures/
git commit -m "프로젝트 스캐너(.gitignore 존중) + 인덱싱 파이프라인 (해시 기반 증분, FTS 동기화)"
```

---

### Task 9: 파일 워처 (외부 변경 대응)

**Files:**
- Create: `src/indexer/watcher.ts`
- Test: `tests/watcher.test.ts`

**Interfaces:**
- Consumes: 없음 (chokidar 래퍼 — 콜백은 호출측이 `Indexer.indexFile/removeFile`로 연결, Plan 2에서 수행)
- Produces:
  ```ts
  interface WatchHandlers { onChangeOrAdd(absPath: string): void; onRemove(absPath: string): void }
  function watchProject(root: string, handlers: WatchHandlers): { close(): Promise<void> }
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/watcher.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { watchProject } from '../src/indexer/watcher';

function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const t = setInterval(() => {
      if (cond()) { clearInterval(t); resolve(); }
      else if (Date.now() - start > ms) { clearInterval(t); reject(new Error('timeout')); }
    }, 50);
  });
}

describe('watchProject', () => {
  it('reports add, change, unlink for supported files', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'si-watch-'));
    const changed: string[] = [];
    const removed: string[] = [];
    const w = watchProject(tmp, {
      onChangeOrAdd: (p) => changed.push(path.basename(p)),
      onRemove: (p) => removed.push(path.basename(p)),
    });
    try {
      const f = path.join(tmp, 'x.c');
      fs.writeFileSync(f, 'int a;');
      await waitFor(() => changed.includes('x.c'));
      fs.writeFileSync(f, 'int a; int b;');
      await waitFor(() => changed.filter((n) => n === 'x.c').length >= 2);
      fs.unlinkSync(f);
      await waitFor(() => removed.includes('x.c'));
      // 미지원 확장자는 무시
      fs.writeFileSync(path.join(tmp, 'y.txt'), 'hi');
      await new Promise((r) => setTimeout(r, 700));
      expect(changed).not.toContain('y.txt');
    } finally {
      await w.close();
    }
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- watcher`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/indexer/watcher.ts`:
```ts
import * as chokidar from 'chokidar';
import { languageForPath } from './languages';

export interface WatchHandlers {
  onChangeOrAdd(absPath: string): void;
  onRemove(absPath: string): void;
}

const SKIP = /(^|[\\/])(\.git|node_modules|dist|build|out|\.cache)([\\/]|$)/;

export function watchProject(root: string, handlers: WatchHandlers): { close(): Promise<void> } {
  const watcher = chokidar.watch(root, {
    ignored: (p: string) => SKIP.test(p),
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });
  const ifSupported = (fn: (p: string) => void) => (p: string) => {
    if (languageForPath(p)) fn(p);
  };
  watcher.on('add', ifSupported(handlers.onChangeOrAdd));
  watcher.on('change', ifSupported(handlers.onChangeOrAdd));
  watcher.on('unlink', ifSupported(handlers.onRemove));
  return { close: () => watcher.close() };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- watcher`
Expected: PASS (macOS FSEvents 지연으로 간헐 타임아웃 시 `waitFor` 한도를 8000ms로 올려 재실행)

- [ ] **Step 5: Commit**

```bash
git add src/indexer/watcher.ts tests/watcher.test.ts
git commit -m "chokidar 기반 파일 워처 (외부 변경 감지, 지원 확장자 필터)"
```

---

### Task 10: 쿼리 API (검색/정의/호출관계) + 통합 테스트

**Files:**
- Create: `src/indexer/api.ts`
- Test: `tests/api.test.ts`

**Interfaces:**
- Consumes: Task 5 스키마, Task 4 `splitName`, Task 8 `Indexer`
- Produces (Plan 2·3의 UI가 호출할 조회 계층 — 시그니처 고정):
  ```ts
  interface SymbolHit { id: number; name: string; kind: string; scope: string; signature: string; path: string; line: number }
  interface TextHit { path: string; snippet: string }
  interface CallerHit { callerId: number | null; callerName: string | null; callerKind: string | null; path: string; line: number }
  function searchSymbols(db, query: string, limit?: number): SymbolHit[]   // fragment 부분일치 AND
  function searchText(db, query: string, limit?: number): TextHit[]        // FTS5
  function getDefinitions(db, name: string): SymbolHit[]
  function getSymbolsForFile(db, relPath: string): SymbolHit[]
  function getCallers(db, name: string): CallerHit[]      // name을 호출하는 곳
  function getCallees(db, symbolId: number): SymbolHit[]  // 해당 심볼 본문이 호출하는 정의들
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/api.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { openDb } from '../src/indexer/db';
import { Indexer } from '../src/indexer/pipeline';
import { searchSymbols, searchText, getDefinitions, getSymbolsForFile, getCallers, getCallees } from '../src/indexer/api';

const FIXTURE = path.join(__dirname, 'fixtures', 'sample');
let db: ReturnType<typeof openDb>;

beforeAll(() => {
  db = openDb(':memory:');
  new Indexer(db, FIXTURE).indexProject();
});

describe('searchSymbols', () => {
  it('matches by partial fragments (SI Name Fragment 방식)', () => {
    const hits = searchSymbols(db, 'crea wid');
    expect(hits.some((h) => h.name === 'create_widget')).toBe(true);
  });
  it('returns empty for no match', () => {
    expect(searchSymbols(db, 'zzqq')).toEqual([]);
  });
});

describe('searchText', () => {
  it('finds full-text matches with snippet', () => {
    const hits = searchText(db, 'unique_needle_string');
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe('app.ts');
    expect(hits[0].snippet).toContain('unique_needle_string');
  });
});

describe('definitions / file symbols', () => {
  it('getDefinitions returns the function def', () => {
    const defs = getDefinitions(db, 'create_widget');
    expect(defs.some((d) => d.path === 'util.c' && d.kind === 'function')).toBe(true);
  });
  it('getSymbolsForFile lists symbols of one file', () => {
    const syms = getSymbolsForFile(db, 'main.c');
    expect(syms.some((s) => s.name === 'main')).toBe(true);
  });
});

describe('call graph', () => {
  it('getCallers(create_widget) includes main', () => {
    const callers = getCallers(db, 'create_widget');
    expect(callers.some((c) => c.callerName === 'main' && c.path === 'main.c')).toBe(true);
  });
  it('getCallees(main) includes create_widget definition', () => {
    const mainDef = getDefinitions(db, 'main')[0];
    const callees = getCallees(db, mainDef.id);
    expect(callees.some((c) => c.name === 'create_widget')).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- api`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/indexer/api.ts`:
```ts
import type { Database } from 'better-sqlite3';
import { splitName } from './fragments';

export interface SymbolHit {
  id: number;
  name: string;
  kind: string;
  scope: string;
  signature: string;
  path: string;
  line: number;
}

export interface TextHit {
  path: string;
  snippet: string;
}

export interface CallerHit {
  callerId: number | null;
  callerName: string | null;
  callerKind: string | null;
  path: string;
  line: number;
}

const HIT_SELECT = `SELECT s.id, s.name, s.kind, s.scope, s.signature, s.start_line AS line, f.path
FROM symbols s JOIN files f ON f.id = s.file_id`;

export function searchSymbols(db: Database, query: string, limit = 50): SymbolHit[] {
  const frags = splitName(query);
  if (frags.length === 0) return [];
  const conds = frags
    .map(() => `EXISTS (SELECT 1 FROM name_fragments nf WHERE nf.symbol_id = s.id AND nf.fragment LIKE ?)`)
    .join(' AND ');
  return db
    .prepare(`${HIT_SELECT} WHERE ${conds} ORDER BY length(s.name), s.name LIMIT ?`)
    .all(...frags.map((f) => f + '%'), limit) as SymbolHit[];
}

export function searchText(db: Database, query: string, limit = 50): TextHit[] {
  const escaped = `"${query.replace(/"/g, '""')}"`;
  return db
    .prepare(`SELECT path, snippet(file_text, 1, '', '', '…', 12) AS snippet FROM file_text WHERE file_text MATCH ? LIMIT ?`)
    .all(escaped, limit) as TextHit[];
}

export function getDefinitions(db: Database, name: string): SymbolHit[] {
  return db.prepare(`${HIT_SELECT} WHERE s.name = ? ORDER BY f.path, line`).all(name) as SymbolHit[];
}

export function getSymbolsForFile(db: Database, relPath: string): SymbolHit[] {
  return db.prepare(`${HIT_SELECT} WHERE f.path = ? ORDER BY line`).all(relPath) as SymbolHit[];
}

export function getCallers(db: Database, name: string): CallerHit[] {
  return db
    .prepare(
      `SELECT cs.id AS callerId, cs.name AS callerName, cs.kind AS callerKind, f.path, r.line
       FROM refs r
       JOIN files f ON f.id = r.file_id
       LEFT JOIN symbols cs ON cs.id = r.enclosing_symbol_id
       WHERE r.name = ? AND r.kind = 'call'
       ORDER BY f.path, r.line`,
    )
    .all(name) as CallerHit[];
}

export function getCallees(db: Database, symbolId: number): SymbolHit[] {
  return db
    .prepare(
      `${HIT_SELECT} WHERE s.name IN (
         SELECT DISTINCT r.name FROM refs r WHERE r.enclosing_symbol_id = ? AND r.kind = 'call'
       ) AND s.kind IN ('function','method') ORDER BY s.name`,
    )
    .all(symbolId) as SymbolHit[];
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: 전체 PASS

- [ ] **Step 5: Commit**

```bash
git add src/indexer/api.ts tests/api.test.ts
git commit -m "쿼리 API: fragment 심볼 검색, FTS 전문 검색, 정의/호출자/피호출 조회"
```

---

### Task 11: 벤치마크 스크립트 (성능 기준 검증)

**Files:**
- Create: `src/scripts/bench.ts`

**Interfaces:**
- Consumes: `openDb`, `Indexer`
- Produces: `npm run bench <디렉토리>` — 인덱싱 시간/파일/심볼/참조 수 출력. 스펙 §10 기준(100만 줄 < 2분) 판정 근거.

- [ ] **Step 1: 구현**

`src/scripts/bench.ts`:
```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openDb } from '../indexer/db';
import { Indexer } from '../indexer/pipeline';

const target = process.argv[2];
if (!target || !fs.existsSync(target)) {
  console.error('사용법: npm run bench -- <프로젝트 디렉토리>');
  process.exit(1);
}

const dbPath = path.join(os.tmpdir(), `si-bench-${Date.now()}.db`);
const db = openDb(dbPath);
const idx = new Indexer(db, path.resolve(target));

const t0 = Date.now();
let lastPct = -1;
const stats = idx.indexProject((done, total) => {
  const pct = Math.floor((done / total) * 10) * 10;
  if (pct !== lastPct) {
    lastPct = pct;
    process.stdout.write(`\r인덱싱 ${pct}% (${done}/${total})`);
  }
});
const elapsed = (Date.now() - t0) / 1000;

const lines = (db.prepare(`SELECT sum(length(content) - length(replace(content, char(10), '')) + 1) n FROM file_text`).get() as { n: number }).n;
console.log(`\n완료: ${elapsed.toFixed(1)}s`);
console.log(`파일 ${stats.files} (스킵 ${stats.skipped}) / 라인 ${lines} / 심볼 ${stats.symbols} / 참조 ${stats.refs}`);
console.log(`DB: ${dbPath} (${(fs.statSync(dbPath).size / 1024 / 1024).toFixed(1)}MB)`);
```

- [ ] **Step 2: 실제 대형 저장소로 실행**

Run:
```bash
npm run build
git clone --depth 1 https://github.com/redis/redis /tmp/si-bench-redis
npm run bench -- /tmp/si-bench-redis
```
Expected: 정상 완료, 통계 출력. redis(~25만 줄 C 기준) 소요 시간 × 4를 100만 줄 추정치로 삼는다.
- **추정치 < 120초**: 직렬 유지 확정 (결과 수치를 커밋 메시지에 기록)
- **추정치 ≥ 120초**: 이 결과를 보고하고 worker_threads 풀 태스크를 Plan 2 앞에 추가한다 — 임의로 구현하지 말 것

- [ ] **Step 3: Commit**

```bash
git add src/scripts/bench.ts
git commit -m "인덱싱 벤치마크 스크립트 추가 — redis 측정: <측정치 기입>초 / <심볼수> 심볼 (100만 줄 추정 <추정치>초)"
```

---

## Self-Review 결과 (작성 시 수행)

- **스펙 커버리지**: Plan 1 범위(스펙 §3 아키텍처 기반, §3.1 조건 3종, §4 DB, §8 데이터 흐름의 인덱싱/증분/워처, §10 성능 기준) 모두 태스크에 매핑됨. §5 해석 모듈·§6 UI·§7 AI는 Plan 2~5 범위로 의도적 제외.
- **워커 풀**: 스펙 §3의 worker_threads 풀은 Task 11 벤치마크 결과에 따른 조건부 추가로 처리 (Global Constraints에 명시).
- **타입 일관성**: `SymbolRow/RefRow`(Task 6) ↔ `Indexer`(Task 8) ↔ `api.ts`(Task 10)의 컬럼/필드 명칭 대조 완료. FTS rowid=fileId 규약은 Task 8 정의, Task 8/11에서만 사용.

## 후속 계획 (이 플랜 완료 후 작성)

| 계획 | 범위 | 선행 조건 |
|---|---|---|
| Plan 2 | UI 셸: 패널 레이아웃, Monaco, Project/Symbol Window, 파일 탭, 인덱서 utilityProcess RPC | Plan 1 완료 |
| Plan 3 | 분석 기능: Context/Relation Window, 검색 UI, 내비게이션/참조 하이라이트, 북마크 | Plan 2 완료 |
| Plan 4 | Smart Rename(미리보기 UI), 시맨틱 토큰, 패키징 | Plan 3 완료 |
| Plan 5 | AI 자동완성 (v1.5) | Plan 4 완료 |
