# Plan 9: 내장 터미널 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 하단 "Context | Terminal" 탭에 다중 터미널(xterm.js + node-pty, 로그인 셸)을 내장해 Claude Code CLI/codex 같은 TUI를 앱 안에서 직접 실행한다.

**Architecture:** main이 TerminalManager로 PTY 프로세스들을 id별 소유(`terminal:spawn/input/resize/kill` invoke + `terminal:event` push), 렌더러는 @xterm/xterm 표면만. 하단 탭과 터미널 탭 전환은 전부 CSS 숨김(언마운트 금지 — 버퍼/TUI 상태 유지, Plan 8 P1 교훈). 프로젝트 전환 시 전부 kill 후 새 cwd 기준.

**Tech Stack:** node-pty 1.1.0(네이티브 — ABI 이중 관리 대상), @xterm/xterm 6.0.0 + @xterm/addon-fit 0.11.0 (DOM 렌더러 유지 — canvas/webgl addon 사용 금지: 테스트 가능성)

**스펙**: `docs/superpowers/specs/2026-07-17-plan9-terminal-design.md`

## Global Constraints

- 로그인 셸: `process.env.SHELL || '/bin/zsh'` + `['-l']`, cwd=프로젝트 루트, env에 `TERM=xterm-256color`, `COLORTERM=truecolor` 추가
- **CSS 숨김 원칙**: 하단 Context|Terminal 전환과 터미널 탭 간 전환 모두 `display:none` — 컴포넌트/xterm 언마운트 금지
- 프로젝트 전환: main killAll + 렌더러 store 리셋(setProject) — 이후 터미널 탭 활성 시 지연 재스폰
- node-pty 실패(로드/스폰)는 `{error}` 반환으로 그침 — 편집/인덱서/LSP/채팅 무영향
- **node-pty는 네이티브 모듈**: package.json의 `rebuild:electron`/`rebuild:node` 모듈 목록에 추가 필수. `npm test`=node ABI, Electron/E2E/패키징=electron ABI (기존 절차)
- xterm에 canvas/webgl 렌더러 addon을 추가하지 않는다 (DOM 렌더러 — E2E에서 텍스트 어서션 가능)
- 커밋 메시지 한국어 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 트레일러. `git add`는 명시적 파일 나열만(-A 금지)
- E2E/패키징 태스크 종료 시 `npm run rebuild:node` + `npm test` 복원·보고

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/main/terminal/spawn-spec.ts` (신규) | 스폰 스펙 순수 구성 |
| `src/main/terminal/manager.ts` (신규) | TerminalManager — pty 소유/라우팅 (spawnFn 주입 가능) |
| `src/main/main.ts` (수정) | ipc 4종 + terminal:event push + 프로젝트 전환/종료 훅 |
| `src/preload/preload.ts` (수정) | terminalSpawn/Input/Resize/Kill + onTerminalEvent |
| `src/renderer/src/terminal-view.ts` (신규) | xterm 인스턴스 생성/테마/리사이즈/dispose |
| `src/renderer/src/components/TerminalPanel.tsx` (신규) | 터미널 탭 바 + 뷰 컨테이너 |
| `src/renderer/src/components/BottomPanel.tsx` (신규) | Context\|Terminal 탭 (CSS 숨김) |
| `src/renderer/src/store.ts` (수정) | terminals/activeTerminalId/bottomTab |
| `src/renderer/src/App.tsx` (수정) | ContextPanel 자리 → BottomPanel, Ctrl+` |
| `src/renderer/src/theming/apply.ts` (수정) | 테마 적용 후 `si:theme-changed` 이벤트 |
| `src/renderer/src/theme.css` (수정) | 하단 탭/터미널 스타일 |
| `package.json` (수정) | 의존성 + rebuild 목록 |
| `electron-builder.yml` (수정, Task 7) | node-pty asarUnpack |

---

### Task 1: 의존성 + rebuild 목록 + 스폰 스펙 순수 함수 (TDD)

**Files:**
- Modify: `package.json`
- Create: `src/main/terminal/spawn-spec.ts`
- Test: `tests/terminal-spawn-spec.test.ts`

**Interfaces (Produces):**

```ts
export interface SpawnSpec { file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }
export function buildSpawnSpec(env: NodeJS.ProcessEnv, cwd: string): SpawnSpec;
```

- [ ] **Step 1: 의존성 설치 + rebuild 목록 추가**

```bash
npm i node-pty @xterm/xterm @xterm/addon-fit
```

`package.json` scripts 수정 — 두 목록에 `node-pty` 추가:
- `rebuild:electron`: `-w tree-sitter,...,better-sqlite3,node-pty`
- `rebuild:node`: `npm rebuild tree-sitter ... better-sqlite3 node-pty`

설치 직후 `npm run rebuild:node && npm test`로 기존 스위트가 여전히 그린인지 확인 (node-pty가 node ABI로 빌드됨).

- [ ] **Step 2: 실패하는 테스트 작성** — `tests/terminal-spawn-spec.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildSpawnSpec } from '../src/main/terminal/spawn-spec';

describe('buildSpawnSpec', () => {
  it('SHELL 환경변수 사용 + 로그인 플래그 + TERM 주입', () => {
    const spec = buildSpawnSpec({ SHELL: '/bin/bash', PATH: '/usr/bin' }, '/proj');
    expect(spec.file).toBe('/bin/bash');
    expect(spec.args).toEqual(['-l']);
    expect(spec.cwd).toBe('/proj');
    expect(spec.env.TERM).toBe('xterm-256color');
    expect(spec.env.COLORTERM).toBe('truecolor');
    expect(spec.env.PATH).toBe('/usr/bin'); // 기존 env 보존
  });

  it('SHELL 없으면 /bin/zsh 폴백', () => {
    expect(buildSpawnSpec({}, '/p').file).toBe('/bin/zsh');
  });
});
```

- [ ] **Step 3: 실패 확인** — `npx vitest run tests/terminal-spawn-spec.test.ts` → 모듈 없음 FAIL

- [ ] **Step 4: spawn-spec.ts 구현**

```ts
// PTY 스폰 스펙 — 순수 함수. 로그인 셸(-l)로 패키지 앱(GUI PATH 미상속)에서도 CLI가 PATH에 잡힌다.
export interface SpawnSpec {
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export function buildSpawnSpec(env: NodeJS.ProcessEnv, cwd: string): SpawnSpec {
  return {
    file: env.SHELL || '/bin/zsh',
    args: ['-l'],
    cwd,
    env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  };
}
```

- [ ] **Step 5: 통과 확인 + 커밋**

Run: `npx vitest run tests/terminal-spawn-spec.test.ts` → PASS

```bash
git add package.json package-lock.json src/main/terminal/spawn-spec.ts tests/terminal-spawn-spec.test.ts
git commit -m "터미널 기반: node-pty/xterm 의존성 + ABI rebuild 목록 + 스폰 스펙 (로그인 셸)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: TerminalManager (TDD, fake pty 주입)

**Files:**
- Create: `src/main/terminal/manager.ts`
- Test: `tests/terminal-manager.test.ts`

**Interfaces:**
- Consumes: `buildSpawnSpec/SpawnSpec`(Task 1)
- Produces:

```ts
export interface PtyLike {
  onData(cb: (data: string) => void): void;
  onExit(cb: () => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}
export interface TerminalManagerDeps {
  cwd: string;
  onData(id: number, data: string): void;
  onExit(id: number): void;
  spawnFn?: (spec: SpawnSpec) => PtyLike; // 기본: node-pty 지연 require
}
export class TerminalManager {
  constructor(deps: TerminalManagerDeps);
  spawn(): { id: number } | { error: string };
  input(id: number, data: string): void;   // 없는 id는 무시
  resize(id: number, cols: number, rows: number): void;
  kill(id: number): void;                  // 없는 id는 무시
  killAll(): void;
}
```

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/terminal-manager.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TerminalManager, PtyLike } from '../src/main/terminal/manager';
import type { SpawnSpec } from '../src/main/terminal/spawn-spec';

interface FakePty extends PtyLike {
  written: string[];
  resized: [number, number][];
  killed: boolean;
  emitData(d: string): void;
  emitExit(): void;
}

function makeFakePty(): FakePty {
  let dataCb: (d: string) => void = () => {};
  let exitCb: () => void = () => {};
  const fake: FakePty = {
    written: [],
    resized: [],
    killed: false,
    onData: (cb) => (dataCb = cb),
    onExit: (cb) => (exitCb = cb),
    write: (d) => fake.written.push(d),
    resize: (c, r) => fake.resized.push([c, r]),
    kill: () => (fake.killed = true),
    emitData: (d) => dataCb(d),
    emitExit: () => exitCb(),
  };
  return fake;
}

let ptys: FakePty[];
let specs: SpawnSpec[];
let events: { type: string; id: number; data?: string }[];
let mgr: TerminalManager;

beforeEach(() => {
  ptys = [];
  specs = [];
  events = [];
  mgr = new TerminalManager({
    cwd: '/proj',
    onData: (id, data) => events.push({ type: 'data', id, data }),
    onExit: (id) => events.push({ type: 'exit', id }),
    spawnFn: (spec) => {
      specs.push(spec);
      const p = makeFakePty();
      ptys.push(p);
      return p;
    },
  });
});

describe('TerminalManager', () => {
  it('spawn: 증가하는 id 발급 + 스폰 스펙(cwd/-l/TERM)', () => {
    const a = mgr.spawn();
    const b = mgr.spawn();
    expect(a).toEqual({ id: 1 });
    expect(b).toEqual({ id: 2 });
    expect(specs[0].cwd).toBe('/proj');
    expect(specs[0].args).toEqual(['-l']);
    expect(specs[0].env.TERM).toBe('xterm-256color');
  });

  it('input/resize/data가 id별로 라우팅', () => {
    mgr.spawn();
    mgr.spawn();
    mgr.input(2, 'ls\r');
    mgr.resize(1, 80, 24);
    expect(ptys[1].written).toEqual(['ls\r']);
    expect(ptys[0].resized).toEqual([[80, 24]]);
    ptys[0].emitData('out0');
    expect(events).toContainEqual({ type: 'data', id: 1, data: 'out0' });
  });

  it('kill: 해당 pty만 종료, 없는 id는 무시', () => {
    mgr.spawn();
    mgr.spawn();
    mgr.kill(1);
    expect(ptys[0].killed).toBe(true);
    expect(ptys[1].killed).toBe(false);
    mgr.kill(99); // no-op
    mgr.input(1, 'x'); // 제거된 id 무시
    expect(ptys[0].written).toEqual([]);
  });

  it('셸 자연 종료: onExit 콜백 + 엔트리 제거 (이후 input 무시)', () => {
    mgr.spawn();
    ptys[0].emitExit();
    expect(events).toContainEqual({ type: 'exit', id: 1 });
    mgr.input(1, 'x');
    expect(ptys[0].written).toEqual([]);
  });

  it('killAll: 전부 종료', () => {
    mgr.spawn();
    mgr.spawn();
    mgr.killAll();
    expect(ptys.every((p) => p.killed)).toBe(true);
  });

  it('spawnFn throw → {error} 반환 (앱 무영향)', () => {
    const failing = new TerminalManager({
      cwd: '/p',
      onData: () => {},
      onExit: () => {},
      spawnFn: () => {
        throw new Error('pty 로드 실패');
      },
    });
    const r = failing.spawn();
    expect('error' in r && r.error).toContain('pty 로드 실패');
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/terminal-manager.test.ts` → FAIL

- [ ] **Step 3: manager.ts 구현**

```ts
// PTY 수명/라우팅 — node-pty는 지연 require (로드 실패가 앱 기동에 영향 주지 않도록).
import { buildSpawnSpec, SpawnSpec } from './spawn-spec';

export interface PtyLike {
  onData(cb: (data: string) => void): void;
  onExit(cb: () => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface TerminalManagerDeps {
  cwd: string;
  onData(id: number, data: string): void;
  onExit(id: number): void;
  spawnFn?: (spec: SpawnSpec) => PtyLike;
}

function defaultSpawn(spec: SpawnSpec): PtyLike {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pty = require('node-pty') as {
    spawn(file: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; name: string; cols: number; rows: number }): {
      onData(cb: (d: string) => void): void;
      onExit(cb: () => void): void;
      write(d: string): void;
      resize(c: number, r: number): void;
      kill(): void;
    };
  };
  return pty.spawn(spec.file, spec.args, { cwd: spec.cwd, env: spec.env, name: 'xterm-256color', cols: 80, rows: 24 });
}

export class TerminalManager {
  private ptys = new Map<number, PtyLike>();
  private nextId = 1;
  private readonly spawnFn: (spec: SpawnSpec) => PtyLike;

  constructor(private deps: TerminalManagerDeps) {
    this.spawnFn = deps.spawnFn ?? defaultSpawn;
  }

  spawn(): { id: number } | { error: string } {
    let proc: PtyLike;
    try {
      proc = this.spawnFn(buildSpawnSpec(process.env, this.deps.cwd));
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    const id = this.nextId++;
    this.ptys.set(id, proc);
    proc.onData((data) => this.deps.onData(id, data));
    proc.onExit(() => {
      this.ptys.delete(id);
      this.deps.onExit(id);
    });
    return { id };
  }

  input(id: number, data: string): void {
    this.ptys.get(id)?.write(data);
  }

  resize(id: number, cols: number, rows: number): void {
    this.ptys.get(id)?.resize(cols, rows);
  }

  kill(id: number): void {
    const p = this.ptys.get(id);
    if (!p) return;
    this.ptys.delete(id);
    try {
      p.kill();
    } catch {
      // 이미 종료
    }
  }

  killAll(): void {
    for (const id of [...this.ptys.keys()]) this.kill(id);
  }
}
```

- [ ] **Step 4: 통과 확인 + 커밋** — `npx vitest run tests/terminal-manager.test.ts` PASS

```bash
git add src/main/terminal/manager.ts tests/terminal-manager.test.ts
git commit -m "TerminalManager: PTY id 라우팅/kill/killAll/스폰 실패 오류 반환 (fake 주입 TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: main ipc + preload

**Files:**
- Modify: `src/main/main.ts`, `src/preload/preload.ts`

**Interfaces (Produces, preload):**
- `terminalSpawn(): Promise<{ id: number } | { error: string }>`
- `terminalInput(id: number, data: string): Promise<void>`
- `terminalResize(id: number, cols: number, rows: number): Promise<void>`
- `terminalKill(id: number): Promise<void>`
- `onTerminalEvent(cb: (e: { type: 'data'; id: number; data: string } | { type: 'exit'; id: number }) => void): () => void`

- [ ] **Step 1: main.ts 배선**

import `import { TerminalManager } from './terminal/manager';`, 상태 `let terminals: TerminalManager | null = null;`.

`openProjectInMain`의 lsp 교체 지점 옆에:

```ts
    terminals?.killAll();
    terminals = new TerminalManager({
      cwd: root,
      onData: (id, data) => win?.webContents.send('terminal:event', { type: 'data', id, data }),
      onExit: (id) => win?.webContents.send('terminal:event', { type: 'exit', id }),
    });
```

registerIpc()에:

```ts
  ipcMain.handle('terminal:spawn', () =>
    terminals ? terminals.spawn() : { error: '프로젝트가 열려 있지 않습니다' },
  );
  ipcMain.handle('terminal:input', (_e, id: number, data: string) => terminals?.input(id, data));
  ipcMain.handle('terminal:resize', (_e, id: number, cols: number, rows: number) =>
    terminals?.resize(id, cols, rows),
  );
  ipcMain.handle('terminal:kill', (_e, id: number) => terminals?.kill(id));
```

앱 종료 경로(lsp?.shutdownAll() 옆)에 `terminals?.killAll();`.

- [ ] **Step 2: preload 추가** (Interfaces 그대로 — 이벤트 타입은 인라인 유니언, 기존 onLspEvent/onChatEvent 패턴과 동일하게 해제 함수 반환)

- [ ] **Step 3: 빌드+회귀+커밋** — `npm run build && npm test` 그린.

```bash
git add src/main/main.ts src/preload/preload.ts
git commit -m "터미널 ipc: spawn/input/resize/kill + terminal:event push + 프로젝트 전환/종료 훅

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 렌더러 — terminal-view + TerminalPanel + BottomPanel + store + Ctrl+`

**Files:**
- Create: `src/renderer/src/terminal-view.ts`, `src/renderer/src/components/TerminalPanel.tsx`, `src/renderer/src/components/BottomPanel.tsx`
- Modify: `src/renderer/src/store.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/theming/apply.ts`, `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: preload(Task 3)
- Produces: `<BottomPanel />` — App.tsx:162의 `<ContextPanel />` 자리를 교체

- [ ] **Step 1: store 확장**

```ts
  terminals: { id: number; title: string; exited: boolean }[];
  activeTerminalId: number | null;
  bottomTab: 'context' | 'terminal';
  addTerminal(id: number, title: string): void;
  removeTerminal(id: number): void;  // active면 남은 것 중 마지막으로 전환
  markTerminalExited(id: number): void;
  setActiveTerminalId(id: number | null): void;
  setBottomTab(v: 'context' | 'terminal'): void;
```

구현:

```ts
  terminals: [],
  activeTerminalId: null,
  bottomTab: 'context',
  addTerminal: (id, title) =>
    set((s) => ({ terminals: [...s.terminals, { id, title, exited: false }], activeTerminalId: id })),
  removeTerminal: (id) =>
    set((s) => {
      const terminals = s.terminals.filter((t) => t.id !== id);
      const activeTerminalId =
        s.activeTerminalId === id ? (terminals.at(-1)?.id ?? null) : s.activeTerminalId;
      return { terminals, activeTerminalId };
    }),
  markTerminalExited: (id) =>
    set((s) => ({ terminals: s.terminals.map((t) => (t.id === id ? { ...t, exited: true } : t)) })),
  setActiveTerminalId: (activeTerminalId) => set({ activeTerminalId }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
```

`setProject` 리셋에 `terminals: [], activeTerminalId: null` 추가 (bottomTab 유지).

- [ ] **Step 2: terminal-view.ts 구현**

```ts
// xterm 인스턴스 관리 — id별 생성/데이터/테마/리사이즈/정리. DOM 렌더러 유지 (addon 금지).
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export interface TerminalView {
  write(data: string): void;
  fit(): void;
  focus(): void;
  dispose(): void;
}

const views = new Map<number, TerminalView>();

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function themeOptions() {
  return {
    background: cssVar('--bg', '#1e1f22'),
    foreground: cssVar('--fg', '#d4d6da'),
    cursor: cssVar('--accent', '#4a9eff'),
  };
}

export function createTerminalView(id: number, container: HTMLElement): TerminalView {
  const term = new Terminal({
    theme: themeOptions(),
    fontSize: 12,
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
    cursorBlink: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(container);
  fit.fit();
  void window.si.terminalResize(id, term.cols, term.rows);

  term.onData((data) => void window.si.terminalInput(id, data));

  const ro = new ResizeObserver(() => {
    // 숨김(display:none) 상태에선 크기가 0 — fit 생략 (표시될 때 다시 관측됨)
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      fit.fit();
      void window.si.terminalResize(id, term.cols, term.rows);
    }
  });
  ro.observe(container);

  const onTheme = () => term.options && (term.options.theme = themeOptions());
  window.addEventListener('si:theme-changed', onTheme);

  const view: TerminalView = {
    write: (data) => term.write(data),
    fit: () => {
      if (container.clientWidth > 0) {
        fit.fit();
        void window.si.terminalResize(id, term.cols, term.rows);
      }
    },
    focus: () => term.focus(),
    dispose: () => {
      ro.disconnect();
      window.removeEventListener('si:theme-changed', onTheme);
      term.dispose();
      views.delete(id);
    },
  };
  views.set(id, view);
  return view;
}

export function getTerminalView(id: number): TerminalView | undefined {
  return views.get(id);
}

export function disposeAllTerminalViews(): void {
  for (const v of [...views.values()]) v.dispose();
}
```

- [ ] **Step 3: apply.ts에 테마 이벤트 추가** — `applyThemeById` 끝(dataset.themeKind 설정 뒤)에:

```ts
  window.dispatchEvent(new CustomEvent('si:theme-changed'));
```

- [ ] **Step 4: TerminalPanel.tsx 구현**

```tsx
import { useEffect, useRef } from 'react';
import { useAppStore } from '../store';
import { createTerminalView, getTerminalView, disposeAllTerminalViews } from '../terminal-view';

export function TerminalPanel({ visible }: { visible: boolean }) {
  const terminals = useAppStore((s) => s.terminals);
  const activeId = useAppStore((s) => s.activeTerminalId);
  const hostRef = useRef<HTMLDivElement>(null);

  // 이벤트 구독 — TerminalPanel은 CSS 숨김으로만 가려지고 언마운트되지 않는다 (BottomPanel 계약)
  useEffect(() => {
    const off = window.si.onTerminalEvent((e) => {
      if (e.type === 'data') getTerminalView(e.id)?.write(e.data);
      else useAppStore.getState().markTerminalExited(e.id);
    });
    return () => {
      off();
      disposeAllTerminalViews(); // 프로젝트 전환(Workspace 재마운트) 시 정리
    };
  }, []);

  const spawn = async () => {
    const r = await window.si.terminalSpawn();
    if ('error' in r) {
      useAppStore.getState().setError(`터미널 시작 실패: ${r.error}`);
      return;
    }
    const st = useAppStore.getState();
    st.addTerminal(r.id, `터미널 ${r.id}`);
    // 컨테이너가 렌더된 다음 프레임에 뷰 생성
    requestAnimationFrame(() => {
      const el = hostRef.current?.querySelector<HTMLElement>(`[data-term-id="${r.id}"]`);
      if (el) createTerminalView(r.id, el).focus();
    });
  };

  // 터미널 탭 첫 표시 시 지연 기동
  useEffect(() => {
    if (visible && useAppStore.getState().terminals.length === 0) void spawn();
    if (visible && activeId != null) requestAnimationFrame(() => getTerminalView(activeId)?.fit());
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = (id: number) => {
    void window.si.terminalKill(id);
    getTerminalView(id)?.dispose();
    useAppStore.getState().removeTerminal(id);
  };

  return (
    <div className="terminal-panel">
      <div className="terminal-tabs">
        {terminals.map((t) => (
          <span
            key={t.id}
            className={`terminal-tab${t.id === activeId ? ' active' : ''}`}
            onClick={() => {
              useAppStore.getState().setActiveTerminalId(t.id);
              requestAnimationFrame(() => getTerminalView(t.id)?.fit());
            }}
          >
            {t.title}{t.exited ? ' (종료됨)' : ''}
            <button className="terminal-close" onClick={(e) => { e.stopPropagation(); close(t.id); }}>×</button>
          </span>
        ))}
        <button className="terminal-add" onClick={() => void spawn()}>+</button>
      </div>
      <div className="terminal-hosts" ref={hostRef}>
        {terminals.length === 0 && (
          <div className="hint">터미널이 없습니다. + 로 새 터미널을 여세요.</div>
        )}
        {terminals.map((t) => (
          <div
            key={t.id}
            data-term-id={t.id}
            className="terminal-host"
            style={{ display: t.id === activeId ? 'block' : 'none' }}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: BottomPanel.tsx 구현** — **양쪽 다 항상 마운트, CSS 숨김**:

```tsx
import { useAppStore } from '../store';
import { ContextPanel } from './ContextPanel';
import { TerminalPanel } from './TerminalPanel';

export function BottomPanel() {
  const tab = useAppStore((s) => s.bottomTab);
  const setTab = useAppStore((s) => s.setBottomTab);
  return (
    <div className="panel">
      <div className="panel-title right-tabs">
        <button className={tab === 'context' ? 'active' : ''} onClick={() => setTab('context')}>Context</button>
        <button className={tab === 'terminal' ? 'active' : ''} onClick={() => setTab('terminal')}>Terminal</button>
      </div>
      <div className="panel-body" style={{ display: tab === 'context' ? undefined : 'none' }}>
        <ContextPanel />
      </div>
      <div className="panel-body" style={{ display: tab === 'terminal' ? undefined : 'none' }}>
        <TerminalPanel visible={tab === 'terminal'} />
      </div>
    </div>
  );
}
```

(ContextPanel이 자체 `.panel` 래퍼를 갖고 있으면 RightPanel 때와 같은 판단으로 중첩 유지/조정 — 기존 E2E 셀렉터가 깨지지 않는 쪽 선택 후 보고서 기록.)

- [ ] **Step 6: App.tsx 수정**

- `App.tsx:162`의 `<ContextPanel />`을 `<BottomPanel />`로 교체 (import 교체).
- 전역 keydown에 Ctrl+` 추가 (기존 단축키 블록에):

```ts
      if (ev.ctrlKey && ev.key === '`') {
        ev.preventDefault();
        useAppStore.getState().setBottomTab('terminal');
        return;
      }
```

- [ ] **Step 7: theme.css 추가**

```css
/* ── 내장 터미널 (Plan 9) ── */
.terminal-panel { display: flex; flex-direction: column; height: 100%; }
.terminal-tabs {
  flex: none; display: flex; align-items: center; gap: 2px;
  padding: 2px 4px; border-bottom: 1px solid var(--border); overflow-x: auto;
}
.terminal-tab {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px;
  font-size: 11px; color: var(--fg-dim); cursor: pointer; border-radius: 3px; white-space: nowrap;
}
.terminal-tab.active { color: var(--fg); background: var(--bg-active); }
.terminal-close, .terminal-add {
  background: none; border: none; color: var(--fg-dim); cursor: pointer; font-size: 12px; padding: 0 2px;
}
.terminal-close:hover, .terminal-add:hover { color: var(--fg); }
.terminal-hosts { flex: 1; min-height: 0; position: relative; }
.terminal-host { height: 100%; width: 100%; padding: 2px; }
```

- [ ] **Step 8: 빌드+회귀+커밋** — `npm run build && npm test` 그린.

```bash
git add src/renderer/src/terminal-view.ts src/renderer/src/components/TerminalPanel.tsx src/renderer/src/components/BottomPanel.tsx src/renderer/src/store.ts src/renderer/src/App.tsx src/renderer/src/theming/apply.ts src/renderer/src/theme.css
git commit -m "터미널 UI: 하단 Context|Terminal 탭(CSS 숨김), 다중 탭, xterm 뷰/테마 연동, Ctrl+\` 토글

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 통합 테스트 — 실제 node-pty 왕복

**Files:**
- Create: `tests/terminal-integration.test.ts`

- [ ] **Step 1: 테스트 작성**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TerminalManager } from '../src/main/terminal/manager';

let mgr: TerminalManager | null = null;

afterEach(() => {
  mgr?.killAll();
  mgr = null;
});

const waitFor = async (cond: () => boolean, ms: number): Promise<void> => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  if (!cond()) throw new Error('waitFor 타임아웃');
};

describe('TerminalManager 실 PTY 왕복', () => {
  it('로그인 셸 스폰 → echo 왕복 → resize → kill', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'si-term-'));
    let output = '';
    const exits: number[] = [];
    mgr = new TerminalManager({
      cwd,
      onData: (_id, data) => (output += data),
      onExit: (id) => exits.push(id),
    });
    const r = mgr.spawn();
    expect('id' in r).toBe(true);
    const id = (r as { id: number }).id;

    // 프롬프트가 뜰 시간을 기다린 뒤 echo — 마커 문자열로 프롬프트 노이즈와 구분
    await waitFor(() => output.length > 0, 15_000);
    mgr.input(id, 'echo SI_PTY_$((1+1))\r');
    await waitFor(() => output.includes('SI_PTY_2'), 15_000);

    mgr.resize(id, 120, 40); // 예외 없이 수행되면 OK
    mgr.input(id, 'exit\r');
    await waitFor(() => exits.includes(id), 15_000);
    fs.rmSync(cwd, { recursive: true, force: true });
  }, 60_000);

  it('cwd가 프로젝트 루트를 향한다 (pwd 확인)', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'si-term-cwd-'));
    const real = fs.realpathSync(cwd); // macOS /tmp 심링크 보정
    let output = '';
    mgr = new TerminalManager({ cwd, onData: (_i, d) => (output += d), onExit: () => {} });
    const { id } = mgr.spawn() as { id: number };
    await waitFor(() => output.length > 0, 15_000);
    mgr.input(id, 'pwd\r');
    await waitFor(() => output.includes(real) || output.includes(cwd), 15_000);
    mgr.kill(id);
    fs.rmSync(cwd, { recursive: true, force: true });
  }, 60_000);
});
```

- [ ] **Step 2: 실행/통과** — `npx vitest run tests/terminal-integration.test.ts` → PASS (셸 출력 형태 차이로 어긋나면 마커/대기 로직을 보강하되 "실 PTY 왕복" 의도 유지, 조정 기록). `npm test` 전체 그린.

- [ ] **Step 3: 커밋**

```bash
git add tests/terminal-integration.test.ts
git commit -m "터미널 통합 테스트: 실 PTY 로그인 셸 echo/pwd 왕복 + resize + kill/exit

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: E2E — 터미널 탭에서 echo + 다중 탭

**Files:**
- Create: `tests/e2e/terminal.spec.ts`

- [ ] **Step 1: 스펙 작성** (기존 하니스 관례)

```ts
import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

test('내장 터미널: echo 출력 + 두 번째 터미널 탭', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-term-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'a.ts'), 'const x = 1;\n');

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: path.join(work, 'ud') },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.tree-item', { hasText: 'a.ts' })).toBeVisible({ timeout: 15_000 });

    // Terminal 탭 → 첫 터미널 지연 기동
    await page.locator('.panel-title button', { hasText: 'Terminal' }).click();
    await expect(page.locator('.terminal-tab')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });

    // 셸 프롬프트 대기 후 echo (마커로 확인 — DOM 렌더러라 텍스트 어서션 가능)
    await page.locator('.terminal-host >> visible=true').click();
    await page.waitForTimeout(1500); // 로그인 셸 초기화
    await page.keyboard.type('echo SI_E2E_$((2+3))');
    await page.keyboard.press('Enter');
    await expect(page.locator('.xterm')).toContainText('SI_E2E_5', { timeout: 15_000 });

    // + 로 두 번째 터미널 → 탭 2개 + 전환
    await page.locator('.terminal-add').click();
    await expect(page.locator('.terminal-tab')).toHaveCount(2, { timeout: 15_000 });
    await page.locator('.terminal-tab').first().click();
    await expect(page.locator('.terminal-tab').first()).toHaveClass(/active/);
  } finally {
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실행** — `npm run test:e2e` → 전체(기존 6 + 신규 1) PASS. `waitForTimeout(1500)`이 하니스 규칙(임의 sleep 지양)과 어긋나면 프롬프트 출현을 `.xterm` 텍스트 폴링으로 대기하는 방식으로 바꾸고 기록.

- [ ] **Step 3: 휴지 복원 + 커밋** — `npm run rebuild:node && npm test` 통과.

```bash
git add tests/e2e/terminal.spec.ts
git commit -m "E2E: 내장 터미널 echo 왕복 + 다중 탭 전환

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 패키징 — node-pty asarUnpack + 패키지 앱 PATH 실증

**Files:**
- Modify: `electron-builder.yml`

- [ ] **Step 1: asarUnpack 추가**

```yaml
  - "node_modules/node-pty/**"    # 네이티브 .node + helper 바이너리 — asar 안에서 실행 불가
```

- [ ] **Step 2: 패키징 + 실증** — `npm run package` → exit 0. Playwright(executablePath, 이전 플랜들의 .superpowers 임시 스크립트 방식)로 패키지 앱 구동:
1. Terminal 탭 → 터미널 스폰 확인 (.xterm 표시).
2. `echo PATH_CHECK_$PATH` 입력 → 출력에 `PATH_CHECK_`와 함께 **로그인 셸 PATH**(예: `/usr/local/bin` 또는 `/opt/homebrew/bin` 포함)가 나오는지 확인 — GUI 기본 PATH(`/usr/bin:/bin:...`만)와 구분되면 로그인 셸 실증 성공.
3. `which claude` 시도 결과도 기록 (설치돼 있으면 경로, 없으면 미설치 기록 — 실패 아님).

- [ ] **Step 3: 휴지 복원 + 커밋** — `npm run rebuild:node && npm test` 통과.

```bash
git add electron-builder.yml
git commit -m "패키징: node-pty asarUnpack + 패키지 앱 로그인 셸 PATH 실증

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review (작성 후 점검 결과)

1. **스펙 커버리지**: §1 하단 탭/Ctrl+`(Task 4)·다중 탭(Task 4)·main PTY/ipc(Task 2·3)·수명(Task 3 전환 훅 + Task 4 지연 기동/닫기)·테마 연동(Task 4)·네이티브 절차(Task 1·7) / §3 구조 전 파일 / §4 흐름 1~7 (5번 전환: main killAll(Task 3) + Workspace 재마운트 시 TerminalPanel cleanup의 disposeAllTerminalViews + store 리셋(Task 4); 재스폰은 visible 시 지연 기동으로 충족) / §5 단위(1·2)·통합(5)·E2E(6)·패키징(7). 전 항목 매핑.
2. **Placeholder**: 없음. 조정 허용 지시(통합 마커/E2E 대기)는 조건·의도·기록 요구 명시.
3. **타입 일관성**: `SpawnSpec`(1↔2), `PtyLike/TerminalManager`(2↔3·5), preload 함수명(3↔4), store 세터(4 내부), `TerminalView`(4 내부) 일치. BottomPanel의 `visible` prop ↔ TerminalPanel 시그니처 일치.
