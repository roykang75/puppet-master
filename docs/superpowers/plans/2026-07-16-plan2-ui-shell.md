# Plan 2: UI 셸 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Electron 창 + React 렌더러 + Monaco로 SI 스타일 에디터 셸을 세우고, Plan 1 인덱서를 utilityProcess로 호스팅해 버전 있는 RPC로 배선한다 (편집/저장/저장 시 재인덱싱 포함).

**Architecture:** Renderer(React, sandbox) ↔ preload(contextBridge) ↔ Main(창/메뉴/파일 I/O/RPC 릴레이) ↔ utilityProcess(인덱서 host). RPC는 `{id, method, params}` 요청 / `{id, ok, result|error}` 응답 / `{event, payload}` 이벤트로 구성된 버전 1 프로토콜. 스펙: `docs/superpowers/specs/2026-07-16-plan2-ui-shell-design.md`.

**Tech Stack:** Electron 43, tsc(main/preload/indexer → `dist/`, CJS) + Vite(렌더러 전용 → `dist/renderer/`), React 19, zustand 5, react-resizable-panels 4, monaco-editor 0.55, @playwright/test 1.61.

## Global Constraints

- **네이티브 로드 경로 보존**: main/indexer의 tsc 빌드와 `utilityProcess.fork` 패턴(probe.ts와 동일)을 유지. main/indexer를 번들하지 않는다.
- **tree-sitter Query API만 사용, WASM 폴백 금지** (상위 스펙 §3.1 — 이번 계획은 인덱서 로직을 건드리지 않지만 준수).
- **기존 테스트 유지**: 기존 vitest 39개는 모든 태스크 완료 시점마다 초록이어야 한다. `npm test`.
- **rootDir 규약**: tsc는 `src/` → `dist/` (renderer 제외). 렌더러 소스는 `src/renderer/` 아래, Vite root.
- **경로 규약**: 렌더러↔main↔인덱서 사이의 파일 경로는 항상 프로젝트 루트 기준 `/` 구분자 rel 경로. abs 경로는 main과 인덱서 내부에서만.
- **커밋 메시지는 한국어**, `Co-Authored-By: Claude ...` 트레일러 유지.
- **RPC 기본 타임아웃 10초**, `openProject`/`indexFile` 릴레이는 180초 (초기 인덱싱 중 큐잉 감안).
- 오류는 조용히 삼키지 않는다: 프로토콜 버전 불일치·인덱서 비정상 종료는 명시적 다이얼로그 (스펙 §6).

**알려진 한계 (의도된 것 — 구현하지 말 것):**
- 초기 인덱싱 중 인덱서 RPC는 큐잉된다(host는 단일 스레드). 렌더러는 인덱싱 완료(`indexDone`) 후에만 아웃라인을 요청한다.
- 외부 변경 감지는 인덱싱 지원 확장자(6개 언어)만. README 등 비코드 파일은 리로드 통지 없음.
- 바이너리 파일 감지 없음. dirty 탭 닫기 확인 없음. 충돌 해결 UI 없음.

---

### Task 1: 빌드 툴체인 — Vite 렌더러 + 스크립트

**Files:**
- Modify: `tsconfig.json` (renderer 제외)
- Modify: `package.json` (스크립트, devDeps)
- Create: `vite.config.ts`
- Create: `src/renderer/tsconfig.json`
- Create: `src/renderer/index.html`
- Create: `src/renderer/src/main.tsx`
- Create: `src/renderer/src/App.tsx` (임시 플레이스홀더)
- Create: `src/renderer/src/theme.css`

**Interfaces:**
- Produces: `npm run build` = tsc + vite build (renderer → `dist/renderer/`). `npm run dev` = Vite 개발 서버 URL로 Electron 실행. 렌더러 진입점 `#root`에 `<App/>` 마운트.

- [ ] **Step 1: 의존성 설치**

```bash
npm i -D react react-dom @types/react @types/react-dom vite @vitejs/plugin-react zustand react-resizable-panels monaco-editor @playwright/test
```

참고: 전부 devDependencies — 렌더러 코드는 Vite가 번들하므로 런타임 deps가 아니다.

- [ ] **Step 2: tsconfig에서 렌더러 제외**

`tsconfig.json`에 exclude 추가 (renderer는 Vite/자체 tsconfig 소관):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "node16",
    "moduleResolution": "node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["src/renderer"]
}
```

- [ ] **Step 3: Vite 설정 + 렌더러 tsconfig**

`vite.config.ts` (저장소 루트 — vitest는 `vitest.config.ts`를 우선 사용하므로 충돌 없음):

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
});
```

`src/renderer/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src", "../preload/preload.ts", "../shared/protocol.ts", "../indexer/api.ts", "../indexer/pipeline.ts"]
}
```

- [ ] **Step 4: 렌더러 최소 골격**

`src/renderer/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>SourceInSight</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme.css';

createRoot(document.getElementById('root')!).render(<App />);
```

`src/renderer/src/App.tsx` (Task 7에서 교체될 임시 플레이스홀더):

```tsx
export function App() {
  return <div className="empty-state">SourceInSight</div>;
}
```

`src/renderer/src/theme.css` (다크 테마 전체 — Task 7 이후에도 이 파일이 최종본):

```css
:root {
  --bg: #1e1f22;
  --bg-panel: #26282c;
  --bg-hover: #2f3237;
  --bg-active: #383c42;
  --border: #3a3d42;
  --fg: #d4d6da;
  --fg-dim: #8a8f98;
  --accent: #4a9eff;
  --warn: #e8a33d;
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  background: var(--bg);
  color: var(--fg);
  font: 13px/1.4 -apple-system, 'Segoe UI', 'Helvetica Neue', sans-serif;
  user-select: none;
}
.app { display: flex; flex-direction: column; height: 100%; }
.app-main { flex: 1; min-height: 0; }

.panel { height: 100%; display: flex; flex-direction: column; background: var(--bg-panel); overflow: hidden; }
.panel-title {
  flex: none; padding: 4px 8px; font-size: 11px; letter-spacing: 0.05em;
  text-transform: uppercase; color: var(--fg-dim); border-bottom: 1px solid var(--border);
}
.panel-body { flex: 1; overflow: auto; min-height: 0; }
.hint { padding: 8px; color: var(--fg-dim); }

.resize-handle { background: var(--border); }
.resize-handle[data-panel-group-direction='horizontal'] { width: 3px; }
.resize-handle[data-panel-group-direction='vertical'] { height: 3px; }

.tree-item { padding: 2px 8px; cursor: pointer; white-space: nowrap; }
.tree-item:hover { background: var(--bg-hover); }
.tree-icon { display: inline-block; width: 14px; color: var(--fg-dim); }

.symbol-item { padding: 2px 8px; cursor: pointer; white-space: nowrap; }
.symbol-item:hover { background: var(--bg-hover); }
.symbol-kind { display: inline-block; width: 18px; color: var(--accent); font-weight: 600; }
.symbol-line { color: var(--fg-dim); margin-left: 6px; font-size: 11px; }

.tabs { flex: none; display: flex; background: var(--bg-panel); border-bottom: 1px solid var(--border); overflow-x: auto; }
.tab {
  display: flex; align-items: center; gap: 6px; padding: 5px 10px; cursor: pointer;
  border-right: 1px solid var(--border); white-space: nowrap; color: var(--fg-dim);
}
.tab.active { background: var(--bg); color: var(--fg); }
.tab:hover { background: var(--bg-hover); }
.dirty-dot { color: var(--accent); }
.disk-changed { color: var(--warn); }
.tab-close { color: var(--fg-dim); padding: 0 2px; }
.tab-close:hover { color: var(--fg); }

.editor-area { height: 100%; display: flex; flex-direction: column; background: var(--bg); }
.editor-host { flex: 1; min-height: 0; }

.statusbar {
  flex: none; display: flex; justify-content: space-between; gap: 12px;
  padding: 3px 10px; font-size: 12px; color: var(--fg-dim);
  background: var(--bg-panel); border-top: 1px solid var(--border);
}
.statusbar .error { color: var(--warn); }

.empty-state {
  height: 100%; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 16px; color: var(--fg-dim);
}
.empty-state button {
  padding: 8px 20px; font-size: 14px; color: var(--fg); background: var(--bg-active);
  border: 1px solid var(--border); border-radius: 4px; cursor: pointer;
}
.empty-state button:hover { background: var(--bg-hover); }
.recent-list { display: flex; flex-direction: column; gap: 4px; }
.recent-item { color: var(--accent); cursor: pointer; }
.recent-item:hover { text-decoration: underline; }
```

- [ ] **Step 5: npm 스크립트 갱신**

`package.json` scripts를 다음으로 교체 (기존 rebuild/bench 유지):

```json
"scripts": {
  "build": "tsc -p tsconfig.json && vite build",
  "build:main": "tsc -p tsconfig.json",
  "build:renderer": "vite build",
  "dev:renderer": "vite",
  "dev": "VITE_DEV_SERVER_URL=http://localhost:5173 electron .",
  "start": "electron .",
  "test": "vitest run",
  "test:e2e": "npm run build && playwright test",
  "rebuild:electron": "CXXFLAGS=-std=c++20 electron-rebuild -f -w tree-sitter,tree-sitter-c,tree-sitter-cpp,tree-sitter-python,tree-sitter-typescript,tree-sitter-java,better-sqlite3",
  "rebuild:node": "npm rebuild tree-sitter tree-sitter-c tree-sitter-cpp tree-sitter-python tree-sitter-typescript tree-sitter-java better-sqlite3",
  "bench": "node dist/scripts/bench.js"
}
```

개발 흐름: 터미널 1 `npm run dev:renderer`, 터미널 2 `npm run build:main && npm run dev`. (HMR은 렌더러만 — main 변경 시 재실행.)

- [ ] **Step 6: 빌드/테스트 검증**

Run: `npm run build && npm test`
Expected: tsc 성공, `dist/renderer/index.html` 생성, vitest 39개 전부 PASS.

- [ ] **Step 7: 커밋**

```bash
git add -A && git commit -m "빌드 툴체인: Vite 렌더러 분리 빌드 + React 스캐폴드 + 다크 테마 CSS"
```

---

### Task 2: 공유 ignore 필터 — scanner/watcher/파일트리 제외 규칙 정합

**Files:**
- Create: `src/shared/ignore.ts`
- Modify: `src/indexer/scanner.ts` (필터 사용으로 리팩터)
- Modify: `src/indexer/watcher.ts` (gitignore 존중 — 인계 노트 M-A 해소)
- Test: `tests/ignore.test.ts`

**Interfaces:**
- Produces: `createIgnoreFilter(root: string): IgnoreFilter`, `IgnoreFilter.ignores(rel: string, isDir: boolean): boolean` (rel은 `/` 구분자, 루트 자신은 `''`→false). `ALWAYS_SKIP: Set<string>`. `watchProject(root, handlers)` 시그니처는 불변, 내부에서 gitignore 존중.
- Consumes: 기존 `languageForPath` (watcher의 확장자 필터 유지).

**시맨틱 (기존 scanner 동작 + 정합 규칙):**
- 경로의 어떤 세그먼트든 `.`으로 시작하거나 `ALWAYS_SKIP`(`.git`, `node_modules`, `dist`, `build`, `out`, `.cache`)에 있으면 무시. (기존 scanner는 ALWAYS_SKIP을 디렉터리에만 적용했으나, 세그먼트 전체 적용으로 단순화 — 확장자 없는 `out`이라는 파일이 숨는 정도의 무해한 변화.)
- 루트 `.gitignore` 규칙 적용. 디렉터리 규칙(`dist/`)이 하위 경로에도 미치도록 조상 prefix를 순서대로 검사.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/ignore.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createIgnoreFilter } from '../src/shared/ignore';
import { scanProject } from '../src/indexer/scanner';

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'si-ignore-'));
  fs.writeFileSync(path.join(root, '.gitignore'), 'generated/\n*.log\n');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1;');
  fs.mkdirSync(path.join(root, 'generated'));
  fs.writeFileSync(path.join(root, 'generated', 'gen.ts'), 'export const g = 1;');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'x.ts'), 'export const x = 1;');
  fs.writeFileSync(path.join(root, 'debug.log'), 'log');
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('createIgnoreFilter', () => {
  it('루트 자신은 무시하지 않는다', () => {
    expect(createIgnoreFilter(root).ignores('', true)).toBe(false);
  });
  it('숨김/ALWAYS_SKIP 세그먼트를 무시한다', () => {
    const f = createIgnoreFilter(root);
    expect(f.ignores('.git', true)).toBe(true);
    expect(f.ignores('node_modules/x.ts', false)).toBe(true);
    expect(f.ignores('src/.hidden.ts', false)).toBe(true);
    expect(f.ignores('src/a.ts', false)).toBe(false);
  });
  it('gitignore 디렉터리 규칙이 하위 경로에도 적용된다', () => {
    const f = createIgnoreFilter(root);
    expect(f.ignores('generated', true)).toBe(true);
    expect(f.ignores('generated/gen.ts', false)).toBe(true);
    expect(f.ignores('debug.log', false)).toBe(true);
  });
  it('scanner와 판정이 일치한다 (정합)', () => {
    const files = scanProject(root).map((a) => path.relative(root, a).split(path.sep).join('/'));
    expect(files).toEqual(['src/a.ts']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/ignore.test.ts`
Expected: FAIL — `src/shared/ignore` 모듈 없음.

- [ ] **Step 3: 구현** — `src/shared/ignore.ts`

```ts
import * as fs from 'fs';
import * as path from 'path';
import ignore from 'ignore';

export const ALWAYS_SKIP = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.cache']);

export interface IgnoreFilter {
  /** rel은 '/' 구분자 프로젝트 루트 기준 상대 경로. 루트 자신('')은 항상 false. */
  ignores(rel: string, isDir: boolean): boolean;
}

/** scanner/watcher/파일 트리가 공유하는 제외 규칙: 숨김·ALWAYS_SKIP 세그먼트 + 루트 .gitignore */
export function createIgnoreFilter(root: string): IgnoreFilter {
  const ig = ignore();
  const giPath = path.join(root, '.gitignore');
  if (fs.existsSync(giPath)) ig.add(fs.readFileSync(giPath, 'utf8'));
  return {
    ignores(rel: string, isDir: boolean): boolean {
      if (rel === '') return false;
      const parts = rel.split('/');
      if (parts.some((s) => s.startsWith('.') || ALWAYS_SKIP.has(s))) return true;
      // 디렉터리 규칙(`dist/`)이 하위 경로에 적용되도록 조상 prefix를 검사
      let prefix = '';
      for (let i = 0; i < parts.length - 1; i++) {
        prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
        if (ig.ignores(prefix + '/')) return true;
      }
      return ig.ignores(isDir ? rel + '/' : rel);
    },
  };
}
```

- [ ] **Step 4: scanner 리팩터** — `src/indexer/scanner.ts` 전체 교체

```ts
import * as fs from 'fs';
import * as path from 'path';
import { languageForPath } from './languages';
import { createIgnoreFilter } from '../shared/ignore';

export function scanProject(root: string): string[] {
  const filter = createIgnoreFilter(root);
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 권한 오류 등은 건너뜀
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (filter.ignores(rel, true)) continue;
        walk(abs);
      } else if (entry.isFile()) {
        if (filter.ignores(rel, false)) continue;
        if (languageForPath(abs)) out.push(abs);
      }
    }
  };
  walk(root);
  return out.sort();
}
```

- [ ] **Step 5: watcher에 gitignore 배선** — `src/indexer/watcher.ts` 전체 교체

```ts
import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as path from 'path';
import { languageForPath } from './languages';
import { createIgnoreFilter } from '../shared/ignore';

export interface WatchHandlers {
  onChangeOrAdd(absPath: string): void;
  onRemove(absPath: string): void;
}

export function watchProject(root: string, handlers: WatchHandlers): { close(): Promise<void> } {
  const filter = createIgnoreFilter(root);
  const toRel = (p: string) => path.relative(root, p).split(path.sep).join('/');
  const watcher = chokidar.watch(root, {
    ignored: (p: string, stats?: fs.Stats) => {
      const rel = toRel(p);
      if (rel === '' || rel.startsWith('..')) return false;
      return filter.ignores(rel, stats?.isDirectory() ?? false);
    },
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

- [ ] **Step 6: watcher gitignore 테스트 추가** — `tests/ignore.test.ts` 끝에 append

```ts
import { watchProject } from '../src/indexer/watcher';

describe('watchProject gitignore 정합 (M-A)', () => {
  it('gitignore된 디렉터리의 변경은 통지하지 않는다', async () => {
    const seen: string[] = [];
    const w = watchProject(root, {
      onChangeOrAdd: (p) => seen.push(path.relative(root, p).split(path.sep).join('/')),
      onRemove: () => {},
    });
    await new Promise((r) => setTimeout(r, 500)); // 워처 준비
    fs.writeFileSync(path.join(root, 'generated', 'gen2.ts'), 'export const g2 = 1;');
    fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'export const b = 1;');
    await new Promise((r) => setTimeout(r, 1500)); // awaitWriteFinish 300ms + 여유
    await w.close();
    expect(seen).toContain('src/b.ts');
    expect(seen).not.toContain('generated/gen2.ts');
  }, 15000);
});
```

- [ ] **Step 7: 전체 테스트 통과 확인**

Run: `npm test`
Expected: 기존 39개 + 신규 전부 PASS (scanner/watcher 기존 테스트 회귀 없음).

- [ ] **Step 8: 커밋**

```bash
git add -A && git commit -m "공유 ignore 필터 도입: scanner/watcher 제외 규칙 정합 (인계 M-A 해소)"
```

---

### Task 3: RPC 코어 — 버전 있는 프로토콜 + 클라이언트/서버

**Files:**
- Create: `src/shared/protocol.ts`
- Create: `src/shared/rpc.ts`
- Test: `tests/rpc.test.ts`

**Interfaces:**
- Produces:
  - `PROTOCOL_VERSION = 1`, 메시지 타입 `RpcRequest/RpcResponse/RpcEvent/RpcMessage`
  - 파라미터 타입 `OpenProjectParams {root, dbPath}`, `FileParams {path}`, `SearchParams {query, limit?}`, `NameParams {name}`, `SymbolIdParams {symbolId}`
  - 이벤트 페이로드 `ReadyPayload {protocolVersion}`, `IndexProgressPayload {done, total, file}`, `FileIndexedPayload {path}`
  - UI 상태 타입 `UiState { panelLayouts: Record<string,string>; openTabs: string[]; activeTab: string | null }`
  - `Transport { post(msg), onMessage(cb) }`
  - `createRpcClient(t): { request<T>(method, params?, opts?: {timeoutMs?}): Promise<T>; onEvent(cb) }`
  - `createRpcServer(t, handlers): { emit(event, payload?) }`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/rpc.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createRpcClient, createRpcServer, Transport } from '../src/shared/rpc';
import { RpcMessage } from '../src/shared/protocol';

function makePair(): { client: Transport; server: Transport } {
  const toServer: Array<(m: RpcMessage) => void> = [];
  const toClient: Array<(m: RpcMessage) => void> = [];
  return {
    client: {
      post: (m) => queueMicrotask(() => toServer.forEach((cb) => cb(m))),
      onMessage: (cb) => toClient.push(cb),
    },
    server: {
      post: (m) => queueMicrotask(() => toClient.forEach((cb) => cb(m))),
      onMessage: (cb) => toServer.push(cb),
    },
  };
}

describe('rpc', () => {
  it('요청/응답 왕복', async () => {
    const { client, server } = makePair();
    const rpc = createRpcClient(client);
    createRpcServer(server, { add: (p: { a: number; b: number }) => p.a + p.b });
    expect(await rpc.request<number>('add', { a: 2, b: 3 })).toBe(5);
  });

  it('핸들러 예외는 error 응답으로 전파', async () => {
    const { client, server } = makePair();
    const rpc = createRpcClient(client);
    createRpcServer(server, { boom: () => { throw new Error('폭발'); } });
    await expect(rpc.request('boom')).rejects.toThrow('폭발');
  });

  it('미지의 메서드는 거부', async () => {
    const { client, server } = makePair();
    const rpc = createRpcClient(client);
    createRpcServer(server, {});
    await expect(rpc.request('nope')).rejects.toThrow('unknown method');
  });

  it('동시 요청이 id로 올바르게 매칭된다', async () => {
    const { client, server } = makePair();
    const rpc = createRpcClient(client);
    createRpcServer(server, {
      slow: () => new Promise((r) => setTimeout(() => r('slow'), 50)),
      fast: () => 'fast',
    });
    const [a, b] = await Promise.all([rpc.request('slow'), rpc.request('fast')]);
    expect(a).toBe('slow');
    expect(b).toBe('fast');
  });

  it('타임아웃 시 해당 요청만 거부', async () => {
    const { client, server } = makePair();
    const rpc = createRpcClient(client);
    createRpcServer(server, { never: () => new Promise(() => {}) });
    await expect(rpc.request('never', undefined, { timeoutMs: 50 })).rejects.toThrow('RPC timeout');
  });

  it('서버 이벤트가 클라이언트로 전달된다', async () => {
    const { client, server } = makePair();
    const rpc = createRpcClient(client);
    const srv = createRpcServer(server, {});
    const got = new Promise((r) => rpc.onEvent((event, payload) => r({ event, payload })));
    srv.emit('progress', { done: 1 });
    expect(await got).toEqual({ event: 'progress', payload: { done: 1 } });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/rpc.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현** — `src/shared/protocol.ts`

```ts
export const PROTOCOL_VERSION = 1;

export interface RpcRequest {
  id: number;
  method: string;
  params?: unknown;
}
export type RpcResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { message: string } };
export interface RpcEvent {
  event: string;
  payload?: unknown;
}
export type RpcMessage = RpcRequest | RpcResponse | RpcEvent;

// ── 메서드 파라미터 (인덱서 host가 구현, main이 릴레이) ──
// 결과 타입은 indexer/api.ts(SymbolHit/TextHit/CallerHit), pipeline.ts(IndexStats)를 재사용한다.
export interface OpenProjectParams { root: string; dbPath: string }
export interface FileParams { path: string }        // 프로젝트 루트 기준 rel ('/' 구분자)
export interface SearchParams { query: string; limit?: number }
export interface NameParams { name: string }
export interface SymbolIdParams { symbolId: number }

// ── 이벤트 페이로드 (인덱서 → UI) ──
export interface ReadyPayload { protocolVersion: number }
export interface IndexProgressPayload { done: number; total: number; file: string }
export interface FileIndexedPayload { path: string }

// ── UI 지속 상태 (main persistence ↔ 렌더러) ──
export interface UiState {
  panelLayouts: Record<string, string>; // react-resizable-panels 직렬화 값 (불투명)
  openTabs: string[];
  activeTab: string | null;
}
```

- [ ] **Step 4: 구현** — `src/shared/rpc.ts`

```ts
import { RpcMessage } from './protocol';

export interface Transport {
  post(msg: RpcMessage): void;
  onMessage(cb: (msg: RpcMessage) => void): void;
}

export interface RpcClient {
  request<T>(method: string, params?: unknown, opts?: { timeoutMs?: number }): Promise<T>;
  onEvent(cb: (event: string, payload: unknown) => void): void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function createRpcClient(transport: Transport): RpcClient {
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  const eventCbs: Array<(event: string, payload: unknown) => void> = [];

  transport.onMessage((msg) => {
    if ('event' in msg) {
      for (const cb of eventCbs) cb(msg.event, msg.payload);
      return;
    }
    if ('ok' in msg) {
      const p = pending.get(msg.id);
      if (!p) return; // 타임아웃 후 늦게 도착한 응답
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error.message));
    }
  });

  return {
    request<T>(method: string, params?: unknown, opts?: { timeoutMs?: number }): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }, opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
        transport.post({ id, method, params });
      });
    },
    onEvent(cb) {
      eventCbs.push(cb);
    },
  };
}

export function createRpcServer(
  transport: Transport,
  handlers: Record<string, (params: any) => unknown | Promise<unknown>>,
): { emit(event: string, payload?: unknown): void } {
  transport.onMessage((msg) => {
    if (!('method' in msg)) return;
    const { id, method, params } = msg;
    const handler = handlers[method];
    if (!handler) {
      transport.post({ id, ok: false, error: { message: `unknown method: ${method}` } });
      return;
    }
    void (async () => {
      try {
        const result = await handler(params);
        transport.post({ id, ok: true, result });
      } catch (e) {
        transport.post({ id, ok: false, error: { message: e instanceof Error ? e.message : String(e) } });
      }
    })();
  });
  return { emit: (event, payload) => transport.post({ event, payload }) };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/rpc.test.ts && npm test`
Expected: 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
git add -A && git commit -m "RPC 코어: 버전 있는 프로토콜 타입 + 클라이언트/서버 (타임아웃·id 매칭·이벤트)"
```

---

### Task 4: 인덱서 호스트 — utilityProcess에서 Plan 1 인덱서 서빙

**Files:**
- Create: `src/indexer/host-core.ts` (transport 무관 — 테스트 가능)
- Create: `src/indexer/host.ts` (process.parentPort 바인딩, probe.ts와 같은 패턴)
- Test: `tests/host.test.ts`

**Interfaces:**
- Consumes: `openDb`(db.ts), `Indexer`(pipeline.ts), `watchProject`(watcher.ts), api.ts의 쿼리 함수들, Task 3의 `createRpcServer`/`Transport`.
- Produces: `startIndexerHost(transport: Transport): { close(): Promise<void> }`. RPC 메서드: `openProject(OpenProjectParams)→IndexStats`, `indexFile(FileParams)→{indexed:boolean}`, `getFileOutline(FileParams)→SymbolHit[]`, `searchSymbols(SearchParams)→SymbolHit[]`, `searchText(SearchParams)→TextHit[]`, `getDefinitions(NameParams)→SymbolHit[]`, `getCallers(NameParams)→CallerHit[]`, `getCallees(SymbolIdParams)→SymbolHit[]`. 이벤트: `ready`(기동 직후), `indexProgress`(50파일마다+완료 시), `fileIndexed`, `fileRemoved`. 산출물 `dist/indexer/host.js`는 main이 fork.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/host.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { startIndexerHost } from '../src/indexer/host-core';
import { createRpcClient, Transport } from '../src/shared/rpc';
import { PROTOCOL_VERSION, ReadyPayload } from '../src/shared/protocol';
import type { IndexStats } from '../src/indexer/pipeline';
import type { SymbolHit } from '../src/indexer/api';
import type { RpcMessage } from '../src/shared/protocol';

function makePair(): { client: Transport; server: Transport } {
  const toServer: Array<(m: RpcMessage) => void> = [];
  const toClient: Array<(m: RpcMessage) => void> = [];
  return {
    client: { post: (m) => queueMicrotask(() => toServer.forEach((cb) => cb(m))), onMessage: (cb) => toClient.push(cb) },
    server: { post: (m) => queueMicrotask(() => toClient.forEach((cb) => cb(m))), onMessage: (cb) => toServer.push(cb) },
  };
}

let root: string;
let work: string;

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-host-'));
  root = path.join(work, 'proj');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'a.ts'), 'export function alpha() { return 1; }\n');
});
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

describe('indexer host', () => {
  it('ready → openProject → 조회 → indexFile 이벤트 흐름', async () => {
    const { client, server } = makePair();
    const rpc = createRpcClient(client);
    const events: Array<{ event: string; payload: unknown }> = [];
    const readyP = new Promise<ReadyPayload>((r) =>
      rpc.onEvent((event, payload) => {
        events.push({ event, payload });
        if (event === 'ready') r(payload as ReadyPayload);
      }),
    );
    const host = startIndexerHost(server);

    const ready = await readyP;
    expect(ready.protocolVersion).toBe(PROTOCOL_VERSION);

    const stats = await rpc.request<IndexStats>('openProject', {
      root,
      dbPath: path.join(work, 'index', 'test.db'),
    }, { timeoutMs: 60_000 });
    expect(stats.files).toBe(1);

    const outline = await rpc.request<SymbolHit[]>('getFileOutline', { path: 'a.ts' });
    expect(outline.map((s) => s.name)).toContain('alpha');

    // 파일 갱신 → indexFile → fileIndexed 이벤트
    fs.writeFileSync(path.join(root, 'a.ts'), 'export function alpha() { return 1; }\nexport function beta() { return 2; }\n');
    const res = await rpc.request<{ indexed: boolean }>('indexFile', { path: 'a.ts' });
    expect(res.indexed).toBe(true);
    expect(events.some((e) => e.event === 'fileIndexed' && (e.payload as { path: string }).path === 'a.ts')).toBe(true);

    const outline2 = await rpc.request<SymbolHit[]>('getFileOutline', { path: 'a.ts' });
    expect(outline2.map((s) => s.name)).toContain('beta');

    // 프로젝트 미오픈 상태 보호는 별도 인스턴스로 확인
    const pair2 = makePair();
    const rpc2 = createRpcClient(pair2.client);
    const host2 = startIndexerHost(pair2.server);
    await expect(rpc2.request('getFileOutline', { path: 'a.ts' })).rejects.toThrow('project not open');
    await host2.close();

    await host.close();
  }, 60_000);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/host.test.ts`
Expected: FAIL — `host-core` 모듈 없음.

- [ ] **Step 3: 구현** — `src/indexer/host-core.ts`

```ts
import * as fs from 'fs';
import * as path from 'path';
import type { Database } from 'better-sqlite3';
import { openDb } from './db';
import { Indexer } from './pipeline';
import { watchProject } from './watcher';
import * as queries from './api';
import { createRpcServer, Transport } from '../shared/rpc';
import {
  PROTOCOL_VERSION,
  OpenProjectParams,
  FileParams,
  SearchParams,
  NameParams,
  SymbolIdParams,
} from '../shared/protocol';

export interface IndexerHostHandle {
  close(): Promise<void>;
}

export function startIndexerHost(transport: Transport): IndexerHostHandle {
  let db: Database | null = null;
  let indexer: Indexer | null = null;
  let watcher: { close(): Promise<void> } | null = null;
  let root = '';

  const rel = (abs: string) => path.relative(root, abs).split(path.sep).join('/');
  const opened = (): { db: Database; indexer: Indexer } => {
    if (!db || !indexer) throw new Error('project not open');
    return { db, indexer };
  };

  const server = createRpcServer(transport, {
    openProject(params: OpenProjectParams) {
      root = params.root;
      fs.mkdirSync(path.dirname(params.dbPath), { recursive: true });
      db = openDb(params.dbPath);
      indexer = new Indexer(db, root);
      const stats = indexer.indexProject((done, total, file) => {
        if (done % 50 === 0 || done === total) server.emit('indexProgress', { done, total, file });
      });
      watcher = watchProject(root, {
        onChangeOrAdd: (abs) => {
          if (opened().indexer.indexFile(abs)) server.emit('fileIndexed', { path: rel(abs) });
        },
        onRemove: (abs) => {
          opened().indexer.removeFile(abs);
          server.emit('fileRemoved', { path: rel(abs) });
        },
      });
      return stats;
    },
    indexFile(params: FileParams) {
      const changed = opened().indexer.indexFile(path.join(root, params.path));
      if (changed) server.emit('fileIndexed', { path: params.path });
      return { indexed: changed };
    },
    getFileOutline: (p: FileParams) => queries.getSymbolsForFile(opened().db, p.path),
    searchSymbols: (p: SearchParams) => queries.searchSymbols(opened().db, p.query, p.limit),
    searchText: (p: SearchParams) => queries.searchText(opened().db, p.query, p.limit),
    getDefinitions: (p: NameParams) => queries.getDefinitions(opened().db, p.name),
    getCallers: (p: NameParams) => queries.getCallers(opened().db, p.name),
    getCallees: (p: SymbolIdParams) => queries.getCallees(opened().db, p.symbolId),
  });

  server.emit('ready', { protocolVersion: PROTOCOL_VERSION });

  return {
    async close() {
      await watcher?.close();
      db?.close();
      watcher = null;
      db = null;
      indexer = null;
    },
  };
}
```

- [ ] **Step 4: 구현** — `src/indexer/host.ts` (utilityProcess 진입점)

```ts
// Electron utilityProcess에서 실행된다. probe.ts와 동일하게 process.parentPort로 통신.
import { startIndexerHost } from './host-core';
import type { RpcMessage } from '../shared/protocol';

const port = process.parentPort;
startIndexerHost({
  post: (msg) => port.postMessage(msg),
  onMessage: (cb) => port.on('message', (e: Electron.MessageEvent) => cb(e.data as RpcMessage)),
});
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/host.test.ts && npm test && npm run build:main`
Expected: 전부 PASS, tsc 성공 (`dist/indexer/host.js` 생성).

- [ ] **Step 6: 커밋**

```bash
git add -A && git commit -m "인덱서 호스트: utilityProcess에서 Plan 1 인덱서를 RPC로 서빙 (ready/진행률/파일 이벤트)"
```

---

### Task 5: Main 지원 모듈 — persistence + 프로젝트 파일 접근

**Files:**
- Create: `src/main/persistence.ts`
- Create: `src/main/files.ts`
- Test: `tests/main-support.test.ts`

**Interfaces:**
- Consumes: `UiState`(protocol.ts), `createIgnoreFilter`(shared/ignore.ts).
- Produces:
  - `Persistence` 클래스: `constructor(baseDir)`, `dbPathFor(root): string`, `loadRecent(): RecentEntry[]`, `addRecent(root): void`, `loadUiState(root): UiState | null`, `saveUiState(root, state): void`. `RecentEntry { root: string; openedAt: number }`.
  - `ProjectFiles` 클래스: `constructor(root)`, `listDir(relDir): DirEntry[]` (dir 우선 정렬, ignore 필터 적용), `readFile(rel): string`, `saveFile(rel, content): void`. `DirEntry { name: string; isDir: boolean }`. rel 경로가 루트를 벗어나면 예외.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/main-support.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Persistence } from '../src/main/persistence';
import { ProjectFiles } from '../src/main/files';

let work: string;
let proj: string;

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-main-'));
  proj = path.join(work, 'proj');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.gitignore'), 'secret/\n');
  fs.mkdirSync(path.join(proj, 'secret'));
  fs.writeFileSync(path.join(proj, 'secret', 'k.txt'), 'x');
  fs.writeFileSync(path.join(proj, 'README.md'), '# readme');
  fs.writeFileSync(path.join(proj, 'src', 'a.ts'), 'export const a = 1;');
});
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

describe('Persistence', () => {
  it('recent 목록: 추가·중복 제거·최신 우선', () => {
    const p = new Persistence(path.join(work, 'ud1'));
    p.addRecent('/x');
    p.addRecent('/y');
    p.addRecent('/x');
    const roots = p.loadRecent().map((r) => r.root);
    expect(roots).toEqual(['/x', '/y']);
  });
  it('UiState 저장/복원, 없으면 null', () => {
    const p = new Persistence(path.join(work, 'ud2'));
    expect(p.loadUiState('/proj')).toBeNull();
    const state = { panelLayouts: { main: '{}' }, openTabs: ['a.ts'], activeTab: 'a.ts' };
    p.saveUiState('/proj', state);
    expect(p.loadUiState('/proj')).toEqual(state);
  });
  it('dbPathFor는 baseDir/index 아래 프로젝트별 경로', () => {
    const p = new Persistence(path.join(work, 'ud3'));
    const dbPath = p.dbPathFor('/proj');
    expect(dbPath.startsWith(path.join(work, 'ud3', 'index'))).toBe(true);
    expect(p.dbPathFor('/proj')).toBe(dbPath); // 결정적
    expect(p.dbPathFor('/other')).not.toBe(dbPath);
  });
});

describe('ProjectFiles', () => {
  it('listDir: ignore 필터 + dir 우선 정렬, 비코드 파일 포함', () => {
    const f = new ProjectFiles(proj);
    const names = f.listDir('').map((e) => `${e.isDir ? 'd' : 'f'}:${e.name}`);
    expect(names).toEqual(['d:src', 'f:README.md']); // .gitignore(숨김)·secret(gitignore) 제외
  });
  it('read/save 왕복', () => {
    const f = new ProjectFiles(proj);
    f.saveFile('src/a.ts', 'export const a = 2;');
    expect(f.readFile('src/a.ts')).toBe('export const a = 2;');
  });
  it('루트 탈출 경로는 거부', () => {
    const f = new ProjectFiles(proj);
    expect(() => f.readFile('../outside.txt')).toThrow('escapes');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/main-support.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현** — `src/main/persistence.ts`

```ts
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { UiState } from '../shared/protocol';

export interface RecentEntry {
  root: string;
  openedAt: number;
}

const MAX_RECENT = 10;

export class Persistence {
  constructor(private baseDir: string) {}

  private projectHash(root: string): string {
    return crypto.createHash('sha1').update(root).digest('hex').slice(0, 16);
  }

  dbPathFor(root: string): string {
    return path.join(this.baseDir, 'index', `${this.projectHash(root)}.db`);
  }

  loadRecent(): RecentEntry[] {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.baseDir, 'recent.json'), 'utf8')) as RecentEntry[];
    } catch {
      return [];
    }
  }

  addRecent(root: string): void {
    const list = [{ root, openedAt: Date.now() }, ...this.loadRecent().filter((r) => r.root !== root)].slice(0, MAX_RECENT);
    fs.mkdirSync(this.baseDir, { recursive: true });
    fs.writeFileSync(path.join(this.baseDir, 'recent.json'), JSON.stringify(list, null, 2));
  }

  private uiStatePath(root: string): string {
    return path.join(this.baseDir, 'projects', `${this.projectHash(root)}.json`);
  }

  loadUiState(root: string): UiState | null {
    try {
      return JSON.parse(fs.readFileSync(this.uiStatePath(root), 'utf8')) as UiState;
    } catch {
      return null;
    }
  }

  saveUiState(root: string, state: UiState): void {
    fs.mkdirSync(path.join(this.baseDir, 'projects'), { recursive: true });
    fs.writeFileSync(this.uiStatePath(root), JSON.stringify(state, null, 2));
  }
}
```

- [ ] **Step 4: 구현** — `src/main/files.ts`

```ts
import * as fs from 'fs';
import * as path from 'path';
import { createIgnoreFilter, IgnoreFilter } from '../shared/ignore';

export interface DirEntry {
  name: string;
  isDir: boolean;
}

export class ProjectFiles {
  private filter: IgnoreFilter;
  private root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.filter = createIgnoreFilter(this.root);
  }

  /** rel이 루트를 벗어나면 예외 (경로 탈출 방지) */
  private absOf(rel: string): string {
    const abs = path.resolve(this.root, rel);
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) {
      throw new Error(`path escapes project root: ${rel}`);
    }
    return abs;
  }

  listDir(relDir: string): DirEntry[] {
    const entries = fs.readdirSync(this.absOf(relDir), { withFileTypes: true });
    const out: DirEntry[] = [];
    for (const e of entries) {
      if (!e.isDirectory() && !e.isFile()) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (this.filter.ignores(rel, e.isDirectory())) continue;
      out.push({ name: e.name, isDir: e.isDirectory() });
    }
    return out.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
  }

  readFile(rel: string): string {
    return fs.readFileSync(this.absOf(rel), 'utf8');
  }

  saveFile(rel: string, content: string): void {
    fs.writeFileSync(this.absOf(rel), content, 'utf8');
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/main-support.test.ts && npm test`
Expected: 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
git add -A && git commit -m "main 지원 모듈: 프로젝트별 지속성(recent/UiState/db경로) + ignore 적용 파일 접근"
```

---

### Task 6: Main 프로세스 배선 — 창/메뉴/preload/인덱서 매니저

**Files:**
- Create: `src/main/indexer-manager.ts`
- Create: `src/main/menu.ts`
- Create: `src/preload/preload.ts`
- Modify: `src/main/main.ts` (전면 교체 — 기존 probe 스모크는 SI_OPEN_PROJECT/SI_SMOKE 훅으로 대체. `src/indexer/probe.ts`는 네이티브 로드 검증 유틸로 유지하되 main에서 fork하지 않음)

**Interfaces:**
- Consumes: Task 3~5의 산출물 전부.
- Produces:
  - `spawnIndexer(): IndexerManager` — `{ rpc: RpcClient; whenReady: Promise<void>; onExit(cb: (code: number) => void): void; kill(): void }`. whenReady는 ready 이벤트 수신+버전 일치 시 resolve, 불일치 시 reject.
  - `buildMenu(recent: RecentEntry[], send: (action: MenuAction) => void): void`
  - preload가 `window.si`로 노출하는 API (`SiApi` 타입 export):
    - `openFolderDialog(): Promise<string|null>`, `openProject(root): Promise<{root: string; uiState: UiState|null}>`, `getRecent(): Promise<RecentEntry[]>`
    - `listDir(relDir): Promise<DirEntry[]>`, `readFile(rel): Promise<string>`, `saveFile(rel, content): Promise<void>`
    - `getFileOutline(rel): Promise<SymbolHit[]>`, `saveUiState(state: UiState): Promise<void>`
    - `onIndexerEvent(cb: (event: string, payload: unknown) => void): void`, `onMenu(cb: (action: MenuAction) => void): void`
    - `MenuAction = {type:'open-folder'} | {type:'save'} | {type:'open-recent'; root: string}`
  - main이 렌더러로 보내는 인덱서 이벤트에 추가로 `indexDone`(성공 시 IndexStats), `indexError`({message}) 합성 이벤트.
  - 테스트 훅: env `SI_USER_DATA`(userData 경로 재지정), `SI_OPEN_PROJECT`(기동 시 자동 오픈), `SI_SMOKE=1`(indexDone 시 stats 출력 후 종료).

- [ ] **Step 1: indexer-manager 구현** — `src/main/indexer-manager.ts`

```ts
import { utilityProcess, UtilityProcess } from 'electron';
import * as path from 'path';
import { createRpcClient, RpcClient } from '../shared/rpc';
import { PROTOCOL_VERSION, ReadyPayload, RpcMessage } from '../shared/protocol';

export interface IndexerManager {
  rpc: RpcClient;
  whenReady: Promise<void>;
  onExit(cb: (code: number) => void): void;
  kill(): void;
}

export function spawnIndexer(): IndexerManager {
  const proc: UtilityProcess = utilityProcess.fork(path.join(__dirname, '..', 'indexer', 'host.js'));
  const rpc = createRpcClient({
    post: (m) => proc.postMessage(m),
    onMessage: (cb) => proc.on('message', (m) => cb(m as RpcMessage)),
  });
  const whenReady = new Promise<void>((resolve, reject) => {
    rpc.onEvent((event, payload) => {
      if (event !== 'ready') return;
      const v = (payload as ReadyPayload).protocolVersion;
      if (v === PROTOCOL_VERSION) resolve();
      else reject(new Error(`인덱서 프로토콜 버전 불일치: UI=${PROTOCOL_VERSION}, indexer=${v}`));
    });
  });
  const exitCbs: Array<(code: number) => void> = [];
  proc.on('exit', (code) => exitCbs.forEach((cb) => cb(code)));
  return {
    rpc,
    whenReady,
    onExit: (cb) => exitCbs.push(cb),
    kill: () => void proc.kill(),
  };
}
```

- [ ] **Step 2: 메뉴 구현** — `src/main/menu.ts`

```ts
import { Menu } from 'electron';
import type { RecentEntry } from './persistence';

export type MenuAction = { type: 'open-folder' } | { type: 'save' } | { type: 'open-recent'; root: string };

export function buildMenu(recent: RecentEntry[], send: (action: MenuAction) => void): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => send({ type: 'open-folder' }) },
        {
          label: 'Open Recent',
          submenu: recent.length
            ? recent.map((r) => ({ label: r.root, click: () => send({ type: 'open-recent', root: r.root }) }))
            : [{ label: '(없음)', enabled: false }],
        },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send({ type: 'save' }) },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
```

- [ ] **Step 3: preload 구현** — `src/preload/preload.ts`

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { UiState } from '../shared/protocol';
import type { SymbolHit } from '../indexer/api';
import type { DirEntry } from '../main/files';
import type { RecentEntry } from '../main/persistence';
import type { MenuAction } from '../main/menu';

const api = {
  openFolderDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  openProject: (root: string): Promise<{ root: string; uiState: UiState | null }> =>
    ipcRenderer.invoke('project:open', root),
  getRecent: (): Promise<RecentEntry[]> => ipcRenderer.invoke('project:recent'),
  listDir: (relDir: string): Promise<DirEntry[]> => ipcRenderer.invoke('file:list', relDir),
  readFile: (rel: string): Promise<string> => ipcRenderer.invoke('file:read', rel),
  saveFile: (rel: string, content: string): Promise<void> => ipcRenderer.invoke('file:save', rel, content),
  getFileOutline: (rel: string): Promise<SymbolHit[]> => ipcRenderer.invoke('indexer:getFileOutline', rel),
  saveUiState: (state: UiState): Promise<void> => ipcRenderer.invoke('ui:saveState', state),
  onIndexerEvent: (cb: (event: string, payload: unknown) => void): void => {
    ipcRenderer.on('indexer:event', (_e, msg: { event: string; payload: unknown }) => cb(msg.event, msg.payload));
  },
  onMenu: (cb: (action: MenuAction) => void): void => {
    ipcRenderer.on('menu', (_e, action: MenuAction) => cb(action));
  },
};

contextBridge.exposeInMainWorld('si', api);

export type SiApi = typeof api;
export type { MenuAction };
```

- [ ] **Step 4: main.ts 전면 교체** — `src/main/main.ts`

```ts
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as path from 'path';
import { spawnIndexer, IndexerManager } from './indexer-manager';
import { ProjectFiles } from './files';
import { Persistence } from './persistence';
import { buildMenu, MenuAction } from './menu';
import type { UiState } from '../shared/protocol';

if (process.env.SI_USER_DATA) app.setPath('userData', process.env.SI_USER_DATA);

let win: BrowserWindow | null = null;
let indexer: IndexerManager | null = null;
let files: ProjectFiles | null = null;
let currentRoot: string | null = null;
let quitting = false;
let persistence: Persistence;

const sendMenu = (action: MenuAction) => win?.webContents.send('menu', action);
const sendIndexerEvent = (event: string, payload: unknown) =>
  win?.webContents.send('indexer:event', { event, payload });

async function openProjectInMain(root: string): Promise<{ root: string; uiState: UiState | null }> {
  indexer?.kill();
  const mgr = spawnIndexer();
  indexer = mgr;
  mgr.onExit((code) => {
    if (quitting || mgr !== indexer || !win) return; // 교체/종료 중이면 무시
    void dialog
      .showMessageBox(win, {
        type: 'error',
        message: `인덱서 프로세스가 비정상 종료되었습니다 (code ${code}).`,
        buttons: ['재시작', '무시'],
      })
      .then((r) => {
        if (r.response === 0 && currentRoot) void openProjectInMain(currentRoot);
      });
  });
  mgr.rpc.onEvent(sendIndexerEvent);
  await mgr.whenReady;

  files = new ProjectFiles(root);
  currentRoot = root;
  persistence.addRecent(root);
  buildMenu(persistence.loadRecent(), sendMenu);

  // 인덱싱은 백그라운드로 — 파일 열람/편집은 즉시 가능 (스펙 §5)
  mgr.rpc
    .request('openProject', { root, dbPath: persistence.dbPathFor(root) }, { timeoutMs: 180_000 })
    .then((stats) => {
      sendIndexerEvent('indexDone', stats);
      if (process.env.SI_SMOKE === '1') {
        console.log('[smoke]', JSON.stringify(stats));
        app.quit();
      }
    })
    .catch((err: Error) => sendIndexerEvent('indexError', { message: err.message }));

  return { root, uiState: persistence.loadUiState(root) };
}

function requireFiles(): ProjectFiles {
  if (!files) throw new Error('프로젝트가 열려 있지 않습니다');
  return files;
}

function registerIpc(): void {
  ipcMain.handle('dialog:openFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('project:open', async (_e, root: string) => {
    try {
      return await openProjectInMain(root);
    } catch (err) {
      // 프로토콜 버전 불일치 등 — 명시적 다이얼로그 (스펙 §6)
      dialog.showErrorBox('프로젝트 열기 실패', err instanceof Error ? err.message : String(err));
      throw err;
    }
  });
  ipcMain.handle('project:recent', () => persistence.loadRecent());
  ipcMain.handle('file:list', (_e, relDir: string) => requireFiles().listDir(relDir));
  ipcMain.handle('file:read', (_e, rel: string) => requireFiles().readFile(rel));
  ipcMain.handle('file:save', (_e, rel: string, content: string) => {
    try {
      requireFiles().saveFile(rel, content);
    } catch (err) {
      // 저장 실패(권한 등) → 다이얼로그, 렌더러는 dirty 유지 (스펙 §6)
      dialog.showErrorBox('저장 실패', err instanceof Error ? err.message : String(err));
      throw err;
    }
    // 저장 후 재인덱싱 — 실패해도 저장 자체는 성공이므로 로그만
    indexer?.rpc.request('indexFile', { path: rel }, { timeoutMs: 180_000 }).catch((err: Error) => {
      console.error('[indexFile]', rel, err.message);
    });
  });
  ipcMain.handle('indexer:getFileOutline', (_e, rel: string) => {
    if (!indexer) throw new Error('인덱서가 실행 중이 아닙니다');
    return indexer.rpc.request('getFileOutline', { path: rel });
  });
  ipcMain.handle('ui:saveState', (_e, state: UiState) => {
    if (currentRoot) persistence.saveUiState(currentRoot, state);
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#1e1f22',
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'preload.js') },
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(() => {
  persistence = new Persistence(app.getPath('userData'));
  createWindow();
  buildMenu(persistence.loadRecent(), sendMenu);
  registerIpc();
  if (process.env.SI_OPEN_PROJECT) {
    win!.webContents.once('did-finish-load', () => {
      sendMenu({ type: 'open-recent', root: process.env.SI_OPEN_PROJECT! });
    });
  }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true;
  indexer?.kill();
});
```

- [ ] **Step 5: 빌드 + 기존 테스트 확인**

Run: `npm run build && npm test`
Expected: tsc/vite 성공, vitest 전부 PASS. (main.ts 교체로 기존 `tests/smoke.test.ts`가 probe 기반이면 실패할 수 있음 — 그 경우 smoke.test.ts가 무엇을 검증하는지 확인하고, probe를 직접 fork하는 방식으로 테스트를 수정한다. probe.ts 자체는 유지.)

- [ ] **Step 6: 헤드리스 스모크 검증**

Run:
```bash
mkdir -p /tmp/si-task6/proj && printf 'int main() { return 0; }\n' > /tmp/si-task6/proj/main.c
SI_SMOKE=1 SI_OPEN_PROJECT=/tmp/si-task6/proj SI_USER_DATA=/tmp/si-task6/ud npx electron . ; echo "exit=$?"
```
Expected: `[smoke] {"files":1,...}` 출력 후 exit=0. (이 시점 렌더러는 플레이스홀더 App이지만, 렌더러가 openProject를 아직 호출하지 않으므로 SI_OPEN_PROJECT 메뉴 이벤트는 무시된다 — **이 스모크는 Task 7 완료 후에야 통과한다.** Task 6에서는 창이 뜨고 콘솔 오류가 없는 것까지만 확인하고 Ctrl+C로 종료해도 된다. Task 7 Step 7에서 이 명령을 다시 실행해 exit=0을 확인한다.)

- [ ] **Step 7: 커밋**

```bash
git add -A && git commit -m "main 프로세스 배선: 창/네이티브 메뉴/preload/인덱서 매니저 + 테스트 훅(SI_SMOKE 등)"
```

---

### Task 7: 렌더러 셸 — 스토어, 레이아웃, 프로젝트 열기 흐름

**Files:**
- Create: `src/renderer/src/store.ts`
- Create: `src/renderer/src/global.d.ts`
- Create: `src/renderer/src/persistence-bridge.ts`
- Create: `src/renderer/src/components/EmptyState.tsx`
- Create: `src/renderer/src/components/StatusBar.tsx`
- Create: `src/renderer/src/components/RelationPanel.tsx`
- Create: `src/renderer/src/components/ContextPanel.tsx`
- Modify: `src/renderer/src/App.tsx` (전면 교체)
- Test: `tests/renderer-store.test.ts`

**Interfaces:**
- Consumes: `window.si`(Task 6 preload), react-resizable-panels의 `PanelGroup/Panel/PanelResizeHandle` + `autoSaveId`/`storage` props (**설치된 v4의 실제 export/props 이름을 `node_modules/react-resizable-panels/README.md`에서 확인하고 다르면 맞춰 적용**).
- Produces:
  - zustand 스토어 `useAppStore`: 상태 `{ root, indexing, stats, error, tabs: Tab[], activePath, outlineVersion }`, `Tab { path, dirty, diskChanged }`, 액션 `setProject(root)`, `setIndexing(p|null)`, `setStats(s)`, `setError(msg|null)`, `openTab(path)`, `closeTab(path)`, `setActive(path)`, `setDirty(path, dirty)`, `markDiskChanged(path)`, `bumpOutline()`.
  - `persistence-bridge`: `initLayouts(saved)`, `layoutStorage {getItem, setItem}`, `scheduleSave()` (500ms 디바운스로 `si.saveUiState`).
  - App은 커스텀 이벤트 `si:save`(에디터의 Ctrl/Cmd+S)와 메뉴 액션, 인덱서 이벤트를 구독. Task 8/9의 컴포넌트(`ProjectWindow/SymbolWindow/FileTabs/EditorPane`)가 끼워질 자리를 임시 placeholder div로 마련.

- [ ] **Step 1: 실패하는 스토어 테스트 작성** — `tests/renderer-store.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../src/renderer/src/store';

beforeEach(() => {
  useAppStore.setState({
    root: null, indexing: null, stats: null, error: null,
    tabs: [], activePath: null, outlineVersion: 0,
  });
});

describe('useAppStore', () => {
  it('openTab: 새 탭 추가 + 활성화, 중복이면 활성화만', () => {
    const s = useAppStore.getState();
    s.openTab('a.ts');
    s.openTab('b.ts');
    s.openTab('a.ts');
    const st = useAppStore.getState();
    expect(st.tabs.map((t) => t.path)).toEqual(['a.ts', 'b.ts']);
    expect(st.activePath).toBe('a.ts');
  });
  it('closeTab: 활성 탭을 닫으면 마지막 탭으로 이동, 마지막이면 null', () => {
    const s = useAppStore.getState();
    s.openTab('a.ts');
    s.openTab('b.ts');
    s.closeTab('b.ts');
    expect(useAppStore.getState().activePath).toBe('a.ts');
    s.closeTab('a.ts');
    expect(useAppStore.getState().activePath).toBeNull();
    expect(useAppStore.getState().tabs).toEqual([]);
  });
  it('setDirty(false)는 diskChanged도 해제한다 (저장하면 디스크와 일치)', () => {
    const s = useAppStore.getState();
    s.openTab('a.ts');
    s.setDirty('a.ts', true);
    s.markDiskChanged('a.ts');
    s.setDirty('a.ts', false);
    const tab = useAppStore.getState().tabs[0];
    expect(tab.dirty).toBe(false);
    expect(tab.diskChanged).toBe(false);
  });
  it('setProject는 탭/상태를 초기화한다', () => {
    const s = useAppStore.getState();
    s.openTab('a.ts');
    s.setProject('/p');
    const st = useAppStore.getState();
    expect(st.root).toBe('/p');
    expect(st.tabs).toEqual([]);
    expect(st.activePath).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/renderer-store.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 스토어 구현** — `src/renderer/src/store.ts`

```ts
import { create } from 'zustand';
import type { IndexStats } from '../../indexer/pipeline';

export interface Tab {
  path: string;
  dirty: boolean;
  diskChanged: boolean;
}

interface AppState {
  root: string | null;
  indexing: { done: number; total: number } | null;
  stats: IndexStats | null;
  error: string | null;
  tabs: Tab[];
  activePath: string | null;
  outlineVersion: number;
  setProject(root: string): void;
  setIndexing(p: { done: number; total: number } | null): void;
  setStats(s: IndexStats): void;
  setError(msg: string | null): void;
  openTab(path: string): void;
  closeTab(path: string): void;
  setActive(path: string): void;
  setDirty(path: string, dirty: boolean): void;
  markDiskChanged(path: string): void;
  bumpOutline(): void;
}

export const useAppStore = create<AppState>((set) => ({
  root: null,
  indexing: null,
  stats: null,
  error: null,
  tabs: [],
  activePath: null,
  outlineVersion: 0,
  setProject: (root) => set({ root, tabs: [], activePath: null, indexing: null, stats: null, error: null }),
  setIndexing: (indexing) => set({ indexing }),
  setStats: (stats) => set({ stats }),
  setError: (error) => set({ error }),
  openTab: (path) =>
    set((s) =>
      s.tabs.some((t) => t.path === path)
        ? { activePath: path }
        : { tabs: [...s.tabs, { path, dirty: false, diskChanged: false }], activePath: path },
    ),
  closeTab: (path) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.path !== path);
      const activePath = s.activePath === path ? (tabs[tabs.length - 1]?.path ?? null) : s.activePath;
      return { tabs, activePath };
    }),
  setActive: (path) => set({ activePath: path }),
  setDirty: (path, dirty) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, dirty, diskChanged: dirty ? t.diskChanged : false } : t)),
    })),
  markDiskChanged: (path) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, diskChanged: true } : t)) })),
  bumpOutline: () => set((s) => ({ outlineVersion: s.outlineVersion + 1 })),
}));
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/renderer-store.test.ts`
Expected: PASS.

- [ ] **Step 5: 타입/브리지/패널 구현**

`src/renderer/src/global.d.ts`:

```ts
import type { SiApi } from '../../preload/preload';

declare global {
  interface Window {
    si: SiApi;
  }
}
export {};
```

`src/renderer/src/persistence-bridge.ts`:

```ts
import { useAppStore } from './store';

let panelLayouts: Record<string, string> = {};
let timer: ReturnType<typeof setTimeout> | null = null;

export function initLayouts(saved: Record<string, string> | undefined | null): void {
  panelLayouts = { ...(saved ?? {}) };
}

export const layoutStorage = {
  getItem: (name: string): string | null => panelLayouts[name] ?? null,
  setItem: (name: string, value: string): void => {
    panelLayouts[name] = value;
    scheduleSave();
  },
};

export function scheduleSave(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const s = useAppStore.getState();
    if (!s.root) return;
    void window.si.saveUiState({
      panelLayouts,
      openTabs: s.tabs.map((t) => t.path),
      activeTab: s.activePath,
    });
  }, 500);
}
```

`src/renderer/src/components/EmptyState.tsx`:

```tsx
import { useEffect, useState } from 'react';

export function EmptyState({ onOpen }: { onOpen: (root: string) => void }) {
  const [recent, setRecent] = useState<Array<{ root: string }>>([]);
  useEffect(() => {
    void window.si.getRecent().then(setRecent);
  }, []);
  const pick = async () => {
    const root = await window.si.openFolderDialog();
    if (root) onOpen(root);
  };
  return (
    <div className="empty-state">
      <h2>SourceInSight</h2>
      <button onClick={() => void pick()}>폴더 열기</button>
      {recent.length > 0 && (
        <div className="recent-list">
          {recent.map((r) => (
            <div key={r.root} className="recent-item" onClick={() => onOpen(r.root)}>
              {r.root}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

`src/renderer/src/components/StatusBar.tsx`:

```tsx
import { useAppStore } from '../store';

export function StatusBar() {
  const indexing = useAppStore((s) => s.indexing);
  const stats = useAppStore((s) => s.stats);
  const error = useAppStore((s) => s.error);
  const activePath = useAppStore((s) => s.activePath);
  return (
    <div className="statusbar">
      <span>
        {error ? <span className="error">{error}</span>
          : indexing ? `인덱싱 ${indexing.done}/${indexing.total}`
          : stats ? `파일 ${stats.files + stats.skipped} · 심볼 ${stats.symbols}`
          : ''}
      </span>
      <span>{activePath ?? ''}</span>
    </div>
  );
}
```

`src/renderer/src/components/RelationPanel.tsx`:

```tsx
export function RelationPanel() {
  return (
    <div className="panel">
      <div className="panel-title">Relation</div>
      <div className="panel-body">
        <div className="hint">Plan 3에서 제공</div>
      </div>
    </div>
  );
}
```

`src/renderer/src/components/ContextPanel.tsx`:

```tsx
export function ContextPanel() {
  return (
    <div className="panel">
      <div className="panel-title">Context</div>
      <div className="panel-body">
        <div className="hint">Plan 3에서 제공</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: App 전면 교체** — `src/renderer/src/App.tsx`

레이아웃은 스펙 §6 그림: 세로 그룹(위 = 가로 그룹 [Side | Editor | Relation], 아래 = Context 전체 폭) + StatusBar. Side는 세로로 Project/Symbol 분할. `key={root}`로 프로젝트 전환 시 저장된 레이아웃 재적용. Task 8/9 전까지 ProjectWindow/SymbolWindow/EditorArea 자리는 placeholder.

```tsx
import { useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useAppStore } from './store';
import { initLayouts, layoutStorage, scheduleSave } from './persistence-bridge';
import { EmptyState } from './components/EmptyState';
import { StatusBar } from './components/StatusBar';
import { RelationPanel } from './components/RelationPanel';
import { ContextPanel } from './components/ContextPanel';
import type { UiState, IndexProgressPayload, FileIndexedPayload } from '../../shared/protocol';
import type { IndexStats } from '../../indexer/pipeline';

// Task 8/9에서 실제 컴포넌트로 교체된다
const ProjectWindow = () => (
  <div className="panel"><div className="panel-title">Project</div><div className="panel-body" /></div>
);
const SymbolWindow = () => (
  <div className="panel"><div className="panel-title">Symbols</div><div className="panel-body" /></div>
);
const EditorArea = () => <div className="editor-area" />;

async function openProject(root: string): Promise<void> {
  const st = useAppStore.getState();
  try {
    const res = await window.si.openProject(root);
    initLayouts(res.uiState?.panelLayouts);
    st.setProject(res.root);
    applyUiState(res.uiState);
  } catch (e) {
    st.setError(e instanceof Error ? e.message : String(e));
  }
}

function applyUiState(ui: UiState | null): void {
  if (!ui) return;
  const st = useAppStore.getState();
  for (const p of ui.openTabs) st.openTab(p);
  if (ui.activeTab) st.setActive(ui.activeTab);
}

function handleIndexerEvent(event: string, payload: unknown): void {
  const st = useAppStore.getState();
  if (event === 'indexProgress') st.setIndexing(payload as IndexProgressPayload);
  if (event === 'indexDone') {
    st.setIndexing(null);
    st.setStats(payload as IndexStats);
    st.bumpOutline();
  }
  if (event === 'indexError') st.setError((payload as { message: string }).message);
  if (event === 'fileIndexed' || event === 'fileRemoved') {
    const p = (payload as FileIndexedPayload).path;
    if (p === st.activePath) st.bumpOutline();
    // 열린 파일의 외부 변경 처리는 Task 9에서 확장
  }
}

export function App() {
  const root = useAppStore((s) => s.root);

  useEffect(() => {
    window.si.onIndexerEvent(handleIndexerEvent);
    window.si.onMenu((action) => {
      if (action.type === 'open-folder') {
        void window.si.openFolderDialog().then((r) => r && openProject(r));
      }
      if (action.type === 'open-recent') void openProject(action.root);
      if (action.type === 'save') window.dispatchEvent(new CustomEvent('si:save'));
    });
    const unsub = useAppStore.subscribe(scheduleSave);
    return unsub;
  }, []);

  if (!root) return <EmptyState onOpen={(r) => void openProject(r)} />;

  return (
    <div className="app" key={root}>
      <div className="app-main">
        <PanelGroup direction="vertical" autoSaveId="root-v" storage={layoutStorage}>
          <Panel defaultSize={78} minSize={40}>
            <PanelGroup direction="horizontal" autoSaveId="main-h" storage={layoutStorage}>
              <Panel defaultSize={20} minSize={12} collapsible>
                <PanelGroup direction="vertical" autoSaveId="side-v" storage={layoutStorage}>
                  <Panel defaultSize={55} minSize={20}><ProjectWindow /></Panel>
                  <PanelResizeHandle className="resize-handle" />
                  <Panel minSize={20}><SymbolWindow /></Panel>
                </PanelGroup>
              </Panel>
              <PanelResizeHandle className="resize-handle" />
              <Panel minSize={30}><EditorArea /></Panel>
              <PanelResizeHandle className="resize-handle" />
              <Panel defaultSize={18} minSize={10} collapsible><RelationPanel /></Panel>
            </PanelGroup>
          </Panel>
          <PanelResizeHandle className="resize-handle" />
          <Panel defaultSize={22} minSize={8} collapsible><ContextPanel /></Panel>
        </PanelGroup>
      </div>
      <StatusBar />
    </div>
  );
}
```

- [ ] **Step 7: 빌드 + 스모크 검증**

Run: `npm run build && npm test`
Expected: 전부 성공.

Run (Task 6 Step 6의 스모크 재실행):
```bash
SI_SMOKE=1 SI_OPEN_PROJECT=/tmp/si-task6/proj SI_USER_DATA=/tmp/si-task6/ud npx electron . ; echo "exit=$?"
```
Expected: `[smoke] {...}` 출력 후 exit=0 (이제 렌더러가 open-recent 메뉴 액션을 받아 openProject를 호출한다).

- [ ] **Step 8: 커밋**

```bash
git add -A && git commit -m "렌더러 셸: zustand 스토어 + SI 패널 레이아웃 + 프로젝트 열기 흐름 + 상태바"
```

---

### Task 8: 에디터 — Monaco, 파일 트리, 탭, 저장

**Files:**
- Create: `src/renderer/src/monaco-setup.ts`
- Create: `src/renderer/src/components/EditorPane.tsx`
- Create: `src/renderer/src/components/FileTabs.tsx`
- Create: `src/renderer/src/components/ProjectWindow.tsx`
- Modify: `src/renderer/src/App.tsx` (placeholder 3개 중 ProjectWindow/EditorArea 교체, 저장 핸들러 추가)

**Interfaces:**
- Consumes: `window.si.listDir/readFile/saveFile`, `useAppStore`.
- Produces (EditorPane 모듈 export — Task 9의 SymbolWindow/이벤트 배선이 사용):
  - `revealLine(line: number): void` — 활성 에디터에서 해당 줄로 이동·포커스
  - `getContent(path: string): string | null` — 해당 파일 모델의 현재 내용 (없으면 null)
  - `setDiskContent(path: string, content: string): void` — 모델 내용 교체 (외부 변경 리로드용)
  - `disposeModel(path: string): void` — 탭 닫기 시 모델 폐기
  - 모델 URI 규약: `monaco.Uri.file('/' + relPath)`
  - 에디터에서 Ctrl/Cmd+S → `window.dispatchEvent(new CustomEvent('si:save'))`

- [ ] **Step 1: Monaco 셋업** — `src/renderer/src/monaco-setup.ts`

vite 공식 레시피: 워커를 `?worker`로 명시 임포트.

```ts
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    return new editorWorker();
  },
};

export { monaco };
```

- [ ] **Step 2: EditorPane 구현** — `src/renderer/src/components/EditorPane.tsx`

```tsx
import { useEffect, useRef } from 'react';
import { monaco } from '../monaco-setup';
import { useAppStore } from '../store';

let editorInstance: import('monaco-editor').editor.IStandaloneCodeEditor | null = null;

const uriOf = (relPath: string) => monaco.Uri.file('/' + relPath);

export function revealLine(line: number): void {
  editorInstance?.revealLineInCenter(line);
  editorInstance?.setPosition({ lineNumber: line, column: 1 });
  editorInstance?.focus();
}

export function getContent(relPath: string): string | null {
  return monaco.editor.getModel(uriOf(relPath))?.getValue() ?? null;
}

export function setDiskContent(relPath: string, content: string): void {
  const model = monaco.editor.getModel(uriOf(relPath));
  if (model && model.getValue() !== content) model.setValue(content);
}

export function disposeModel(relPath: string): void {
  monaco.editor.getModel(uriOf(relPath))?.dispose();
}

export function EditorPane() {
  const activePath = useAppStore((s) => s.activePath);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    editorInstance = monaco.editor.create(hostRef.current!, {
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: true },
      model: null,
    });
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      window.dispatchEvent(new CustomEvent('si:save')),
    );
    return () => {
      editorInstance?.dispose();
      editorInstance = null;
    };
  }, []);

  useEffect(() => {
    if (!activePath) {
      editorInstance?.setModel(null);
      return;
    }
    const uri = uriOf(activePath);
    const existing = monaco.editor.getModel(uri);
    if (existing) {
      editorInstance?.setModel(existing);
      return;
    }
    let cancelled = false;
    void window.si
      .readFile(activePath)
      .then((content) => {
        if (cancelled) return;
        const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, undefined, uri);
        model.onDidChangeContent(() => useAppStore.getState().setDirty(activePath, true));
        editorInstance?.setModel(model);
      })
      .catch(() => useAppStore.getState().closeTab(activePath)); // 읽기 실패(삭제된 파일 등) → 탭 닫기
    return () => {
      cancelled = true;
    };
  }, [activePath]);

  return <div ref={hostRef} className="editor-host" />;
}
```

- [ ] **Step 3: FileTabs 구현** — `src/renderer/src/components/FileTabs.tsx`

```tsx
import { useAppStore } from '../store';
import { disposeModel } from './EditorPane';

export function FileTabs() {
  const tabs = useAppStore((s) => s.tabs);
  const activePath = useAppStore((s) => s.activePath);
  const setActive = useAppStore((s) => s.setActive);
  const closeTab = useAppStore((s) => s.closeTab);
  if (tabs.length === 0) return null;
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <div key={t.path} className={`tab${t.path === activePath ? ' active' : ''}`} onClick={() => setActive(t.path)}>
          <span>{t.path.split('/').pop()}</span>
          {t.dirty && <span className="dirty-dot">●</span>}
          {t.diskChanged && <span className="disk-changed" title="디스크에서 변경됨">⚠</span>}
          <span
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              disposeModel(t.path);
              closeTab(t.path);
            }}
          >
            ×
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: ProjectWindow 구현** — `src/renderer/src/components/ProjectWindow.tsx`

```tsx
import { useEffect, useState } from 'react';
import { useAppStore } from '../store';

interface DirEntry {
  name: string;
  isDir: boolean;
}

export function ProjectWindow() {
  const root = useAppStore((s) => s.root);
  const openTab = useAppStore((s) => s.openTab);
  const [dirs, setDirs] = useState<Record<string, DirEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    setDirs({});
    setExpanded(new Set());
    if (root) void window.si.listDir('').then((es) => setDirs({ '': es }));
  }, [root]);

  const toggle = (rel: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
    if (!dirs[rel]) void window.si.listDir(rel).then((es) => setDirs((d) => ({ ...d, [rel]: es })));
  };

  const renderDir = (rel: string, depth: number): React.ReactNode =>
    (dirs[rel] ?? []).map((e) => {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      return (
        <div key={childRel}>
          <div
            className="tree-item"
            style={{ paddingLeft: depth * 14 + 8 }}
            onClick={() => (e.isDir ? toggle(childRel) : openTab(childRel))}
          >
            <span className="tree-icon">{e.isDir ? (expanded.has(childRel) ? '▾' : '▸') : '·'}</span>
            {e.name}
          </div>
          {e.isDir && expanded.has(childRel) && renderDir(childRel, depth + 1)}
        </div>
      );
    });

  return (
    <div className="panel">
      <div className="panel-title">Project</div>
      <div className="panel-body">{renderDir('', 0)}</div>
    </div>
  );
}
```

- [ ] **Step 5: App에 배선** — `src/renderer/src/App.tsx` 수정

placeholder 중 `ProjectWindow`/`EditorArea` 정의를 삭제하고 임포트로 교체:

```tsx
import { ProjectWindow } from './components/ProjectWindow';
import { FileTabs } from './components/FileTabs';
import { EditorPane, getContent } from './components/EditorPane';
```

`EditorArea` placeholder를 실제 구성으로 교체:

```tsx
const EditorArea = () => (
  <div className="editor-area">
    <FileTabs />
    <EditorPane />
  </div>
);
```

App의 useEffect에 저장 핸들러 추가 (`si:save` 커스텀 이벤트 + window 키다운 폴백):

```tsx
useEffect(() => {
  const save = async () => {
    const st = useAppStore.getState();
    if (!st.activePath) return;
    const tab = st.tabs.find((t) => t.path === st.activePath);
    if (!tab?.dirty) return;
    const content = getContent(st.activePath);
    if (content == null) return;
    try {
      await window.si.saveFile(st.activePath, content);
      st.setDirty(st.activePath, false);
      st.setError(null);
    } catch (e) {
      st.setError(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const onSave = () => void save();
  const onKey = (ev: KeyboardEvent) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') {
      ev.preventDefault();
      void save();
    }
  };
  window.addEventListener('si:save', onSave);
  window.addEventListener('keydown', onKey, true);
  return () => {
    window.removeEventListener('si:save', onSave);
    window.removeEventListener('keydown', onKey, true);
  };
}, []);
```

- [ ] **Step 6: 빌드 + 수동 검증**

Run: `npm run build && npm test`
Expected: 성공.

수동 검증 (또는 `npm run dev:renderer` + `npm run dev` 두 터미널):
```bash
SI_OPEN_PROJECT=/tmp/si-task6/proj SI_USER_DATA=/tmp/si-task6/ud npx electron .
```
확인: 파일 트리에 `main.c` 표시 → 클릭 → 탭 + Monaco에 내용(vs-dark) → 타이핑 시 ● 표시 → Cmd/Ctrl+S 저장 시 ● 해제, 디스크 파일 갱신됨.

- [ ] **Step 7: 커밋**

```bash
git add -A && git commit -m "에디터: Monaco 통합(워커 번들) + 파일 트리 + 탭/dirty + 저장 흐름"
```

---

### Task 9: Symbol Window + 인덱서 이벤트 배선 + 지속성 마감

**Files:**
- Create: `src/renderer/src/components/SymbolWindow.tsx`
- Modify: `src/renderer/src/App.tsx` (SymbolWindow placeholder 교체, fileIndexed 리로드 처리)

**Interfaces:**
- Consumes: `window.si.getFileOutline`, `revealLine/getContent/setDiskContent`(EditorPane), 스토어의 `outlineVersion/indexing`.
- Produces: 활성 파일 아웃라인 (심볼 클릭 → `revealLine`). 외부 변경 시: dirty 아니면 조용히 리로드, dirty면 ⚠ 표시.

- [ ] **Step 1: SymbolWindow 구현** — `src/renderer/src/components/SymbolWindow.tsx`

```tsx
import { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { revealLine } from './EditorPane';
import type { SymbolHit } from '../../../indexer/api';

const KIND_BADGE: Record<string, string> = {
  function: 'ƒ', method: 'ƒ', class: 'C', struct: 'S', interface: 'I',
  enum: 'E', type: 'T', variable: 'v', field: '·', macro: '#', namespace: 'N',
};

export function SymbolWindow() {
  const activePath = useAppStore((s) => s.activePath);
  const outlineVersion = useAppStore((s) => s.outlineVersion);
  const indexing = useAppStore((s) => s.indexing);
  const [symbols, setSymbols] = useState<SymbolHit[]>([]);

  useEffect(() => {
    if (!activePath || indexing) {
      setSymbols([]);
      return;
    }
    let cancelled = false;
    void window.si
      .getFileOutline(activePath)
      .then((hits) => {
        if (!cancelled) setSymbols(hits);
      })
      .catch(() => {
        if (!cancelled) setSymbols([]); // 인덱서 미기동/비지원 파일 등
      });
    return () => {
      cancelled = true;
    };
  }, [activePath, outlineVersion, indexing]);

  return (
    <div className="panel">
      <div className="panel-title">Symbols</div>
      <div className="panel-body">
        {indexing && <div className="hint">인덱싱 중…</div>}
        {!indexing &&
          symbols.map((s) => (
            <div key={s.id} className="symbol-item" onClick={() => revealLine(s.line)}>
              <span className="symbol-kind">{KIND_BADGE[s.kind] ?? '?'}</span>
              {s.name}
              <span className="symbol-line">:{s.line}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: App 배선 마감** — `src/renderer/src/App.tsx` 수정

SymbolWindow placeholder 정의 삭제, 임포트 교체:

```tsx
import { SymbolWindow } from './components/SymbolWindow';
import { EditorPane, getContent, setDiskContent } from './components/EditorPane';
```

`handleIndexerEvent`의 fileIndexed/fileRemoved 분기를 다음으로 교체 (외부 변경 리로드 — 스펙 §5):

```tsx
if (event === 'fileIndexed' || event === 'fileRemoved') {
  const p = (payload as FileIndexedPayload).path;
  if (p === st.activePath) st.bumpOutline();
  const tab = st.tabs.find((t) => t.path === p);
  if (tab) {
    if (event === 'fileRemoved' || tab.dirty) {
      if (getContent(p) !== null) st.markDiskChanged(p);
    } else {
      // dirty 아님 → 디스크 내용으로 조용히 리로드 (자기 저장으로 인한 이벤트면 내용 동일 → no-op)
      void window.si.readFile(p).then((content) => setDiskContent(p, content)).catch(() => {});
    }
  }
}
```

주의: 자기 저장 직후의 fileIndexed에서 dirty는 이미 false이고 `setDiskContent`는 내용이 같으면 no-op이므로 커서/undo가 유지된다.

- [ ] **Step 3: 빌드 + 수동 검증**

Run: `npm run build && npm test`
Expected: 성공.

수동 검증:
```bash
SI_OPEN_PROJECT=/tmp/si-task6/proj SI_USER_DATA=/tmp/si-task6/ud npx electron .
```
확인:
1. `main.c` 열기 → 인덱싱 완료 후 Symbols에 `main` 표시, 클릭 시 해당 줄 이동
2. 편집·저장 → 아웃라인 갱신
3. 별도 터미널에서 `echo 'int extern_added() { return 3; }' >> /tmp/si-task6/proj/main.c` → (dirty 아닐 때) 에디터 내용 자동 리로드 + 아웃라인에 `extern_added`
4. 앱 재시작 → 열려 있던 탭·패널 크기 복원

- [ ] **Step 4: 커밋**

```bash
git add -A && git commit -m "Symbol Window + 워처 이벤트 배선(외부 변경 리로드/⚠ 표시) + 탭·레이아웃 복원 마감"
```

---

### Task 10: Playwright E2E 스모크 + 문서 마감

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/smoke.spec.ts`
- Modify: `todo.md` (Plan 2 완료 표기)

**Interfaces:**
- Consumes: Task 6의 env 훅(SI_OPEN_PROJECT/SI_USER_DATA), Task 7~9의 UI 셀렉터(`.tree-item`, `.symbol-item`, `.tab.active .dirty-dot`, `.editor-host`).

- [ ] **Step 1: Playwright 설정** — `playwright.config.ts`

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts', // vitest는 *.test.ts만 수집 — 상호 간섭 없음
  timeout: 120_000,
  workers: 1,
});
```

- [ ] **Step 2: 스모크 테스트 작성** — `tests/e2e/smoke.spec.ts`

```ts
import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

test('열기 → 트리 → 편집 → 저장 → 아웃라인 갱신', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'main.c'), 'int main() {\n  return 0;\n}\n');

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: path.join(work, 'ud') },
  });
  const page = await app.firstWindow();

  // 파일 트리 → 열기
  const item = page.locator('.tree-item', { hasText: 'main.c' });
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.click();
  await expect(page.locator('.editor-host')).toContainText('return 0', { timeout: 15_000 });

  // 인덱싱 완료 → 아웃라인
  await expect(page.locator('.symbol-item', { hasText: 'main' })).toBeVisible({ timeout: 30_000 });

  // 편집: 문서 맨 앞에 전역 변수 선언 (괄호/따옴표 없는 텍스트 — 자동닫기 간섭 회피)
  await page.locator('.editor-host').click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type('int global_marker;\n');
  await expect(page.locator('.tab.active .dirty-dot')).toBeVisible();

  // 저장 (Monaco addCommand가 si:save 디스패치)
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.tab.active .dirty-dot')).toBeHidden({ timeout: 10_000 });
  expect(fs.readFileSync(path.join(proj, 'main.c'), 'utf8')).toContain('global_marker');

  // 재인덱싱 → 아웃라인 갱신
  await expect(page.locator('.symbol-item', { hasText: 'global_marker' })).toBeVisible({ timeout: 15_000 });

  await app.close();
  fs.rmSync(work, { recursive: true, force: true });
});
```

- [ ] **Step 3: E2E 실행**

Run: `npm run test:e2e`
Expected: 1 passed. 실패 시 Playwright 트레이스/스크린샷으로 원인 파악 (`npx playwright show-report`).

- [ ] **Step 4: 전체 검증**

Run: `npm test && npm run test:e2e`
Expected: vitest 전부 PASS + e2e 1 passed.

- [ ] **Step 5: todo.md 갱신**

`todo.md`의 "Plan 2: UI 셸" 섹션 체크박스를 완료로 갱신하고, Plan 1 인계 노트 중 해소된 항목(M-A 워처 gitignore 정합)에 완료 표시. Plan 3 인계 사항이 생겼으면 "Plan 3 인계 노트" 섹션 추가 (예: 초기 인덱싱 중 RPC 큐잉, 비코드 파일 외부 변경 미통지, dirty 탭 닫기 확인 없음).

- [ ] **Step 6: 커밋**

```bash
git add -A && git commit -m "Playwright E2E 스모크(열기→편집→저장→아웃라인 갱신) + todo.md Plan 2 완료 표기"
```
