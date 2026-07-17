# Plan 10: 에이전트 모드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI가 도구 호출(파일 읽기/쓰기/검색/셸)로 프로젝트 파일을 직접 생성·수정하는 에이전트 모드를 기존 AI 채팅 패널에 추가한다.

**Architecture:** main의 AgentService가 tool-use 루프(모델 호출 → tool call 실행 → 결과 반환 → 재호출)를 소유하고, 렌더러는 기존 채팅 UI에 에이전트 토글과 도구 카드만 얹는다. Anthropic tool use와 OpenAI 호환 tool calling을 어댑터로 추상화해 기존 프로파일을 그대로 쓴다. run_command는 macOS sandbox-exec로 쓰기를 프로젝트 이하로 강제한다.

**Tech Stack:** Electron main(Node), @anthropic-ai/sdk, openai, sandbox-exec(macOS), React+zustand(렌더러), vitest/Playwright.

## Global Constraints

- 보안: API 키·오류 상세는 IPC를 넘지 않는다(오류는 kind 고정 문자열만). 도구 실행 결과 텍스트(절단됨)는 전달 가능
- 파일 도구 경로: 프로젝트 루트 + 설정 `agent.allowedDirs` 안만 (밖은 throw). `run_command` 쓰기는 sandbox-exec로 프로젝트 루트 + `$TMPDIR` + `/dev/null`만 허용
- 한도: 응답당 도구 호출 최대 **25회**, run_command 타임아웃 기본 **30초**(주입 가능), 출력 **20KB** 절단, read_file **100KB** 절단
- 이벤트 구독(onAgentEvent)은 **App.tsx**에서 — 탭 전환 언마운트로 리스너가 유실되는 Plan 8 P1 재발 방지
- 에이전트 모드 꺼짐 = 기존 채팅 경로 그대로 (무회귀). ChatService는 수정하지 않는다
- sandbox-exec 실사용 테스트는 `process.platform === 'darwin'`일 때만 실행 (아니면 skip)
- 커밋 메시지는 한국어 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. `git add`는 명시한 파일만 (`-A` 금지)
- 단위/통합 테스트는 node ABI 전제 (`npx vitest run <파일>`)

---

## 파일 구조

```
src/shared/protocol.ts            AgentEvent/AgentToolCall 등 타입 추가 (Task 2)
src/main/agent/tools.ts           도구 스키마+실행기+경로 검증+샌드박스 프로파일 (Task 1)
src/main/agent/prompt.ts          에이전트 시스템 프롬프트 (Task 3)
src/main/agent/adapters.ts        AnthropicAgentAdapter / OpenAIAgentAdapter (Task 3)
src/main/agent/service.ts         AgentService 루프 (Task 4)
src/main/settings.ts              agent.allowedDirs 저장 (Task 2)
src/main/main.ts                  ipc 배선 (Task 2, 5)
src/preload/preload.ts            agentSend 등 (Task 2, 5)
src/renderer/src/store.ts         agentMode/autoApprove/도구 카드 상태 (Task 6)
src/renderer/src/App.tsx          onAgentEvent 구독 (Task 6)
src/renderer/src/components/ChatPanel.tsx   토글+도구 카드 (Task 6)
src/renderer/src/components/SettingsOverlay.tsx  허용 디렉터리 편집 (Task 2)
src/renderer/src/components/ProjectWindow.tsx    외부 새로고침 트리거 (Task 6)
tests/agent-tools.test.ts / agent-adapters.test.ts / agent-service.test.ts
tests/agent-openai-integration.test.ts / tests/e2e/agent.spec.ts
```

---

### Task 1: 에이전트 도구 — 스키마·실행기·경로 검증·샌드박스

**Files:**
- Create: `src/main/agent/tools.ts`
- Test: `tests/agent-tools.test.ts`

**Interfaces:**
- Consumes: 없음 (fs/child_process만)
- Produces (후속 태스크가 사용):
  - `interface ToolSpec { name: string; description: string; parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] } }`
  - `const AGENT_TOOLS: ToolSpec[]` (5종)
  - `interface AgentToolDeps { projectRoot: string; allowedDirs: string[]; searchText(query: string): Promise<{ path: string; snippet: string }[]>; commandTimeoutMs?: number }`
  - `function executeTool(name: string, args: Record<string, unknown>, deps: AgentToolDeps): Promise<string>` — 결과/오류 텍스트 반환(throw는 경로 위반 등 거부 사유 포함해 문자열화되어 호출측에서 tool result로 사용)
  - `function toolSummary(name: string, args: Record<string, unknown>): string` — 카드 표시용 요약("src/a.py" / "python3 x.py")
  - `function resolveToolPath(deps: AgentToolDeps, p: string): string`
  - `function sandboxProfile(root: string): string`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/agent-tools.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AGENT_TOOLS, executeTool, resolveToolPath, toolSummary, sandboxProfile, type AgentToolDeps } from '../src/main/agent/tools';

let root: string;
let extra: string;

const deps = (over: Partial<AgentToolDeps> = {}): AgentToolDeps => ({
  projectRoot: root,
  allowedDirs: [extra],
  searchText: async (q) => [{ path: 'a.ts', snippet: `hit:${q}` }],
  ...over,
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'si-agent-root-'));
  extra = fs.mkdtempSync(path.join(os.tmpdir(), 'si-agent-extra-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(extra, { recursive: true, force: true });
});

describe('AGENT_TOOLS 스키마', () => {
  it('5종 도구가 이름/설명/파라미터를 갖는다', () => {
    expect(AGENT_TOOLS.map((t) => t.name).sort()).toEqual(
      ['list_dir', 'read_file', 'run_command', 'search_text', 'write_file'],
    );
    for (const t of AGENT_TOOLS) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.parameters.type).toBe('object');
    }
  });
});

describe('resolveToolPath', () => {
  it('상대 경로는 프로젝트 루트 기준, 탈출은 거부', () => {
    expect(resolveToolPath(deps(), 'src/a.py')).toBe(path.join(root, 'src/a.py'));
    expect(() => resolveToolPath(deps(), '../evil')).toThrow('허용된 디렉터리 밖');
  });
  it('절대 경로는 루트/추가 허용 디렉터리 안만 허용', () => {
    expect(resolveToolPath(deps(), path.join(extra, 'doc.md'))).toBe(path.join(extra, 'doc.md'));
    expect(() => resolveToolPath(deps(), '/etc/passwd')).toThrow('허용된 디렉터리 밖');
  });
});

describe('executeTool', () => {
  it('write_file: 중간 폴더 자동 생성 + read_file 줄번호 라운드트립', async () => {
    const r = await executeTool('write_file', { path: 'src/gugudan.py', content: 'print(1)\nprint(2)' }, deps());
    expect(r).toContain('작성 완료');
    expect(fs.readFileSync(path.join(root, 'src/gugudan.py'), 'utf8')).toBe('print(1)\nprint(2)');
    const read = await executeTool('read_file', { path: 'src/gugudan.py' }, deps());
    expect(read).toContain('1\tprint(1)');
    expect(read).toContain('2\tprint(2)');
  });
  it('list_dir: [dir]/[file] 표기, .git·node_modules 숨김', async () => {
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, '.git'));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'a.ts'), 'x');
    const r = await executeTool('list_dir', { path: '' }, deps());
    expect(r).toContain('[dir] src');
    expect(r).toContain('[file] a.ts');
    expect(r).not.toContain('.git');
    expect(r).not.toContain('node_modules');
  });
  it('search_text: 주입된 검색기로 위임', async () => {
    const r = await executeTool('search_text', { query: 'foo' }, deps());
    expect(r).toContain('a.ts');
    expect(r).toContain('hit:foo');
  });
  it('read_file: 없는 파일은 오류 텍스트 (throw 아님)', async () => {
    const r = await executeTool('read_file', { path: 'none.txt' }, deps());
    expect(r).toContain('오류');
  });
  it('알 수 없는 도구 이름은 오류 텍스트', async () => {
    const r = await executeTool('nope', {}, deps());
    expect(r).toContain('알 수 없는 도구');
  });
});

describe('toolSummary', () => {
  it('도구별 대상 요약', () => {
    expect(toolSummary('write_file', { path: 'a.py', content: 'x' })).toBe('a.py');
    expect(toolSummary('run_command', { command: 'python3 a.py' })).toBe('python3 a.py');
    expect(toolSummary('search_text', { query: 'foo' })).toBe('foo');
  });
});

// darwin 전용 — 실제 sandbox-exec 실행 검증 (스펙 §1 실측 항목)
describe.skipIf(process.platform !== 'darwin')('run_command 샌드박스', () => {
  it('프로젝트 안 쓰기·실행·출력 캡처 OK', async () => {
    const r = await executeTool('run_command', { command: 'echo hello > f.txt && cat f.txt' }, deps());
    expect(r).toContain('hello');
    expect(r).toContain('exit 0');
    expect(fs.existsSync(path.join(root, 'f.txt'))).toBe(true);
  });
  it('프로젝트 밖 삭제/편집은 차단된다', async () => {
    const victim = path.join(os.tmpdir(), `si-victim-${Date.now()}.txt`);
    fs.writeFileSync(victim, 'keep');
    try {
      // 참고: $TMPDIR은 쓰기 허용이지만 os.tmpdir() 밖의 상위 실경로를 노린다
      const r = await executeTool('run_command', { command: `rm /etc/hosts 2>&1 || echo BLOCKED` }, deps());
      expect(r).toContain('BLOCKED');
      expect(fs.readFileSync(victim, 'utf8')).toBe('keep');
    } finally {
      fs.rmSync(victim, { force: true });
    }
  });
  it('출력 20KB 절단 + 타임아웃 kill', async () => {
    const big = await executeTool('run_command', { command: 'yes x | head -c 100000' }, deps());
    expect(big.length).toBeLessThan(25_000);
    expect(big).toContain('잘림');
    const to = await executeTool('run_command', { command: 'sleep 5' }, deps({ commandTimeoutMs: 300 }));
    expect(to).toContain('타임아웃');
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/agent-tools.test.ts` → FAIL (모듈 없음)

- [ ] **Step 3: 구현**

```ts
// src/main/agent/tools.ts
// 에이전트 도구 — 스키마와 실행기를 한 곳에. electron 임포트 금지 (테스트는 node ABI).
// 파일 도구는 projectRoot+allowedDirs 안만, run_command 쓰기는 sandbox-exec로 루트 이하 강제 (스펙 §1/§3).
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ToolSpec {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] };
}

export interface AgentToolDeps {
  projectRoot: string;
  allowedDirs: string[];
  searchText(query: string): Promise<{ path: string; snippet: string }[]>;
  commandTimeoutMs?: number; // 기본 30초 — 테스트 주입용
}

const OUTPUT_CAP = 20 * 1024; // run_command 출력 절단 (스펙 §3)
const READ_CAP = 100 * 1024; // read_file 절단
const HIDDEN_DIRS = new Set(['.git', 'node_modules']);

export const AGENT_TOOLS: ToolSpec[] = [
  {
    name: 'list_dir',
    description: '디렉터리의 파일/폴더 목록을 본다. path는 프로젝트 루트 상대 경로 (빈 문자열 = 루트).',
    parameters: { type: 'object', properties: { path: { type: 'string', description: '디렉터리 경로' } }, required: [] },
  },
  {
    name: 'read_file',
    description: '파일 내용을 줄번호와 함께 읽는다.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: '파일 경로' } }, required: ['path'] },
  },
  {
    name: 'write_file',
    description: '파일을 생성하거나 전체 내용을 덮어쓴다. 중간 폴더는 자동 생성된다.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '파일 경로' },
        content: { type: 'string', description: '파일 전체 내용' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'search_text',
    description: '프로젝트 전체에서 텍스트를 검색한다 (전문 검색).',
    parameters: { type: 'object', properties: { query: { type: 'string', description: '검색어' } }, required: ['query'] },
  },
  {
    name: 'run_command',
    description:
      '셸 명령을 실행한다 (cwd=프로젝트 루트, 30초 제한). 파일 쓰기/삭제는 프로젝트 안에서만 가능하다.',
    parameters: { type: 'object', properties: { command: { type: 'string', description: '셸 명령' } }, required: ['command'] },
  },
];

/** 상대 경로는 루트 기준, 절대 경로는 루트/allowedDirs 안만 허용. 탈출은 throw. */
export function resolveToolPath(deps: AgentToolDeps, p: string): string {
  const roots = [path.resolve(deps.projectRoot), ...deps.allowedDirs.map((d) => path.resolve(d))];
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(deps.projectRoot, p);
  for (const r of roots) {
    if (abs === r || abs.startsWith(r + path.sep)) return abs;
  }
  throw new Error(`허용된 디렉터리 밖 경로: ${p}`);
}

/** 카드 표시용 대상 요약 */
export function toolSummary(name: string, args: Record<string, unknown>): string {
  if (name === 'run_command') return String(args.command ?? '');
  if (name === 'search_text') return String(args.query ?? '');
  return String(args.path ?? '');
}

/** sandbox-exec 프로파일 — 쓰기는 루트+$TMPDIR+/dev/null만 (스펙 §1 실측 검증 형태) */
export function sandboxProfile(root: string): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const tmp = fs.realpathSync(os.tmpdir());
  return (
    '(version 1)(allow default)(deny file-write*)' +
    `(allow file-write* (subpath "${esc(fs.realpathSync(path.resolve(root)))}"))` +
    `(allow file-write* (subpath "${esc(tmp)}"))` +
    '(allow file-write-data (literal "/dev/null"))'
  );
}

function runCommand(command: string, deps: AgentToolDeps): Promise<string> {
  const timeout = deps.commandTimeoutMs ?? 30_000;
  return new Promise((resolve) => {
    const child = spawn('sandbox-exec', ['-p', sandboxProfile(deps.projectRoot), '/bin/zsh', '-c', command], {
      cwd: deps.projectRoot,
    });
    let out = '';
    let truncated = false;
    let timedOut = false;
    const cap = (d: Buffer) => {
      if (out.length < OUTPUT_CAP) out += d.toString();
      if (out.length >= OUTPUT_CAP) {
        out = out.slice(0, OUTPUT_CAP);
        truncated = true;
      }
    };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve(`오류: 명령 실행 실패 (${e.message})`);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const parts = [out.trimEnd()];
      if (truncated) parts.push('…(출력 잘림)');
      if (timedOut) parts.push(`(타임아웃 ${timeout}ms — 강제 종료)`);
      else parts.push(`exit ${code ?? -1}`);
      resolve(parts.filter(Boolean).join('\n'));
    });
  });
}

/** 도구 실행 — 실패도 오류 텍스트로 반환 (모델이 tool result로 받아 스스로 복구, 스펙 §4) */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  deps: AgentToolDeps,
): Promise<string> {
  try {
    switch (name) {
      case 'list_dir': {
        const abs = resolveToolPath(deps, String(args.path ?? ''));
        const entries = fs
          .readdirSync(abs, { withFileTypes: true })
          .filter((e) => !HIDDEN_DIRS.has(e.name))
          .sort((a, b) => (a.isDirectory() !== b.isDirectory() ? (a.isDirectory() ? -1 : 1) : a.name.localeCompare(b.name)));
        return entries.map((e) => `${e.isDirectory() ? '[dir]' : '[file]'} ${e.name}`).join('\n') || '(빈 디렉터리)';
      }
      case 'read_file': {
        const abs = resolveToolPath(deps, String(args.path ?? ''));
        let text = fs.readFileSync(abs, 'utf8');
        let note = '';
        if (text.length > READ_CAP) {
          text = text.slice(0, READ_CAP);
          note = '\n…(잘림)';
        }
        return text.split('\n').map((l, i) => `${i + 1}\t${l}`).join('\n') + note;
      }
      case 'write_file': {
        const abs = resolveToolPath(deps, String(args.path ?? ''));
        const content = String(args.content ?? '');
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
        return `작성 완료: ${args.path} (${Buffer.byteLength(content)} bytes)`;
      }
      case 'search_text': {
        const hits = await deps.searchText(String(args.query ?? ''));
        if (hits.length === 0) return '(검색 결과 없음)';
        return hits.map((h) => `${h.path}: ${h.snippet}`).join('\n');
      }
      case 'run_command':
        return await runCommand(String(args.command ?? ''), deps);
      default:
        return `오류: 알 수 없는 도구 '${name}'`;
    }
  } catch (e) {
    return `오류: ${e instanceof Error ? e.message : String(e)}`;
  }
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/agent-tools.test.ts` → PASS (darwin 밖에서는 샌드박스 describe skip)

- [ ] **Step 5: 커밋**

```bash
git add src/main/agent/tools.ts tests/agent-tools.test.ts
git commit -m "에이전트 도구 5종: 스키마+실행기, 경로 검증(루트+허용목록), run_command sandbox-exec 쓰기 제한

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 프로토콜 타입 + agent.allowedDirs 설정 + 설정 UI

**Files:**
- Modify: `src/shared/protocol.ts` (Chat 타입 근처에 추가)
- Modify: `src/main/settings.ts`
- Modify: `src/main/main.ts` (settings:appearance 핸들러 근처)
- Modify: `src/preload/preload.ts`
- Modify: `src/renderer/src/components/SettingsOverlay.tsx`
- Test: `tests/settings-store.test.ts` (케이스 추가)

**Interfaces:**
- Consumes: SettingsStore 기존 read/write 패턴 (appearance와 동일)
- Produces:
  - protocol: `interface AgentToolUi { id: string; name: string; summary: string; state: 'awaiting' | 'running' | 'done' | 'error'; detail?: string; path?: string }`
  - protocol: `type AgentEvent = { type: 'chunk'; text: string } | ({ type: 'tool' } & AgentToolUi) | { type: 'done' } | { type: 'error'; kind: 'auth' | 'transient' | 'other' }`
  - settings: `getAgent(): { allowedDirs: string[] }` / `setAgent(a: { allowedDirs: string[] }): void`
  - preload: `getAgentSettings(): Promise<{ allowedDirs: string[] }>` / `setAgentSettings(a): Promise<void>` (ipc `settings:agent:get`/`settings:agent:set`)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/settings-store.test.ts`의 appearance describe 아래에 추가:

```ts
describe('agent 설정', () => {
  it('기본 allowedDirs [] , set→get 라운드트립, 프로파일과 독립', () => {
    const store = new SettingsStore(baseDir);
    expect(store.getAgent()).toEqual({ allowedDirs: [] });
    store.setAgent({ allowedDirs: ['/Users/x/docs', '/tmp/ref'] });
    expect(store.getAgent()).toEqual({ allowedDirs: ['/Users/x/docs', '/tmp/ref'] });
    store.setProfiles([{ name: 'a', provider: 'openai', model: 'm' }], 0);
    expect(store.getAgent().allowedDirs).toHaveLength(2); // 프로파일 저장이 agent 보존
    expect(new SettingsStore(baseDir).getAgent().allowedDirs).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/settings-store.test.ts` → FAIL (`getAgent` 없음)

- [ ] **Step 3: settings.ts 구현** — `SettingsFile`/`Normalized`에 `agent?: { allowedDirs: string[] }` 추가:

```ts
// SettingsFile/Normalized 인터페이스에 각각 추가:
//   agent?: { allowedDirs: string[] };
// read()의 return에 agent: raw.agent 전달 (구버전/새버전 공통 — profiles 분기 밖에서):
//   return { profiles, activeProfileId, appearance: raw.appearance, agent: raw.agent };
//   (레거시 분기와 기본 분기 모두 raw가 있으면 agent를 실어 나른다)
// write()에 추가:
//   if (n.agent) file.agent = n.agent;
// 공개 메서드 추가 (getAppearance 아래):
  getAgent(): { allowedDirs: string[] } {
    return this.read().agent ?? { allowedDirs: [] };
  }

  setAgent(a: { allowedDirs: string[] }): void {
    const prev = this.read();
    this.write({ ...prev, agent: { allowedDirs: a.allowedDirs.filter((d) => typeof d === 'string' && d) } });
  }
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/settings-store.test.ts` → PASS (기존 11 + 신규 1)

- [ ] **Step 5: protocol.ts 타입 추가** — ChatEvent 정의 근처에:

```ts
// ── 에이전트 모드 (Plan 10) ──
export interface AgentToolUi {
  id: string;
  name: string;
  summary: string;
  state: 'awaiting' | 'running' | 'done' | 'error';
  detail?: string; // run_command 출력(절단) 등
  path?: string; // write_file 대상 — 카드 클릭 시 열기
}
export type AgentEvent =
  | { type: 'chunk'; text: string }
  | ({ type: 'tool' } & AgentToolUi)
  | { type: 'done' }
  | { type: 'error'; kind: 'auth' | 'transient' | 'other' };
```

- [ ] **Step 6: main.ts ipc + preload** — `settings:appearance:set` 핸들러 아래에:

```ts
  ipcMain.handle('settings:agent:get', () => settingsStore.getAgent());
  ipcMain.handle('settings:agent:set', (_e, a: { allowedDirs: string[] }) => settingsStore.setAgent(a));
```

preload의 `setAppearance` 아래에:

```ts
  getAgentSettings: (): Promise<{ allowedDirs: string[] }> => ipcRenderer.invoke('settings:agent:get'),
  setAgentSettings: (a: { allowedDirs: string[] }): Promise<void> => ipcRenderer.invoke('settings:agent:set', a),
```

- [ ] **Step 7: SettingsOverlay에 허용 디렉터리 편집 UI** — 상태와 로드(`open` effect 안):

```ts
const [allowedDirs, setAllowedDirs] = useState<string[]>([]);
// open effect 안 (테마 로드 옆):
void window.si.getAgentSettings().then((a) => {
  if (!cancelled) setAllowedDirs(a.allowedDirs);
});
// save() 안 (setAppearance 옆):
await window.si.setAgentSettings({ allowedDirs });
```

테마 필드 아래에 렌더 추가:

```tsx
<div className="settings-field">
  <span className="settings-label">에이전트 추가 허용 디렉터리 (파일 도구가 접근 가능한 프로젝트 밖 경로)</span>
  {allowedDirs.map((d, i) => (
    <div key={i} className="allowed-dir-row">
      <span className="allowed-dir-path" title={d}>{d}</span>
      <button className="profile-remove" title="삭제" onClick={() => setAllowedDirs((prev) => prev.filter((_, j) => j !== i))}><VscTrash /></button>
    </div>
  ))}
  <div>
    <button
      className="rename-btn icon-btn"
      onClick={() => {
        void window.si.openFolderDialog().then((dir) => {
          if (dir) setAllowedDirs((prev) => (prev.includes(dir) ? prev : [...prev, dir]));
        });
      }}
    ><VscAdd /> 폴더 추가…</button>
  </div>
</div>
```

theme.css의 `.profile-remove` 규칙 아래에:

```css
.allowed-dir-row { display: flex; align-items: center; gap: 6px; }
.allowed-dir-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--fg); }
```

- [ ] **Step 8: 빌드 확인** — Run: `npm run build 2>&1 | grep -iE "error" | grep -v ".svg" ; echo OK` → OK만 출력

- [ ] **Step 9: 커밋**

```bash
git add src/shared/protocol.ts src/main/settings.ts src/main/main.ts src/preload/preload.ts src/renderer/src/components/SettingsOverlay.tsx src/renderer/src/theme.css tests/settings-store.test.ts
git commit -m "에이전트 설정: allowedDirs 저장/IPC/설정 UI + AgentEvent 프로토콜 타입

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 에이전트 어댑터 2종 + 시스템 프롬프트

**Files:**
- Create: `src/main/agent/prompt.ts`
- Create: `src/main/agent/adapters.ts`
- Test: `tests/agent-adapters.test.ts`

**Interfaces:**
- Consumes: Task 1의 `ToolSpec`, 기존 `buildChatSystemPrompt`(src/main/chat/prompt.ts), `ChatContext`(protocol)
- Produces:
  - `interface AgentToolCall { id: string; name: string; args: Record<string, unknown> }`
  - `type AgentMsg = { role: 'user'; content: string } | { role: 'assistant'; content: string; toolCalls?: AgentToolCall[] } | { role: 'tool'; toolCallId: string; name: string; content: string }`
  - `interface AgentTurnResult { text: string; toolCalls: AgentToolCall[] }`
  - `interface AgentAdapter { runTurn(messages: AgentMsg[], system: string, tools: ToolSpec[], onChunk: (t: string) => void, signal: AbortSignal): Promise<AgentTurnResult> }`
  - `class AnthropicAgentAdapter implements AgentAdapter` / `class OpenAIAgentAdapter implements AgentAdapter` — 생성자 `(cfg: { model: string; apiKey?: string; baseURL?: string }, client?)` (client 주입 가능, chat 어댑터 패턴)
  - `function buildAgentSystemPrompt(context: ChatContext | null): string`
  - `const AGENT_MAX_TOKENS = 4096`

- [ ] **Step 1: prompt.ts 작성**

```ts
// src/main/agent/prompt.ts — 순수 모듈 (electron/SDK 임포트 금지)
import { buildChatSystemPrompt } from '../chat/prompt';
import type { ChatContext } from '../../shared/protocol';

export const AGENT_MAX_TOKENS = 4096;

export function buildAgentSystemPrompt(context: ChatContext | null): string {
  return [
    buildChatSystemPrompt(context),
    '',
    '너는 도구를 사용해 프로젝트 파일을 직접 만들고 수정하는 에이전트다.',
    '코드를 만들어 달라는 요청이면 코드를 채팅에 보여주는 대신 write_file로 실제 파일을 생성하라.',
    '기존 파일을 고칠 때는 먼저 read_file로 내용을 확인한 뒤 전체 내용을 write_file로 다시 쓴다.',
    '필요하면 run_command로 실행·검증한다. 작업이 끝나면 무엇을 했는지 짧게 요약한다.',
  ].join('\n');
}
```

- [ ] **Step 2: 실패하는 어댑터 테스트 작성**

```ts
// tests/agent-adapters.test.ts
import { describe, it, expect } from 'vitest';
import { AnthropicAgentAdapter, OpenAIAgentAdapter, type AgentMsg } from '../src/main/agent/adapters';
import { AGENT_TOOLS } from '../src/main/agent/tools';

const noAbort = new AbortController().signal;

describe('OpenAIAgentAdapter', () => {
  it('tool_calls 스트리밍 델타를 조립하고 tool 메시지를 직렬화한다', async () => {
    let captured: any;
    const fake = {
      chat: {
        completions: {
          async create(params: any) {
            captured = params;
            async function* gen() {
              yield { choices: [{ delta: { content: '만들게요' } }] };
              yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'write_file', arguments: '{"path":"a.py",' } }] } }] };
              yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"content":"print(1)"}' } }] } }] };
            }
            return gen();
          },
        },
      },
    };
    const adapter = new OpenAIAgentAdapter({ model: 'm' }, fake as any);
    const msgs: AgentMsg[] = [
      { role: 'user', content: '구구단 만들어' },
      { role: 'assistant', content: '이전 응답', toolCalls: [{ id: 'c0', name: 'list_dir', args: {} }] },
      { role: 'tool', toolCallId: 'c0', name: 'list_dir', content: '[file] x' },
    ];
    const chunks: string[] = [];
    const res = await adapter.runTurn(msgs, 'SYS', AGENT_TOOLS, (t) => chunks.push(t), noAbort);
    expect(chunks.join('')).toBe('만들게요');
    expect(res.toolCalls).toEqual([{ id: 'c1', name: 'write_file', args: { path: 'a.py', content: 'print(1)' } }]);
    // 직렬화 검증
    expect(captured.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(captured.messages[2].tool_calls[0].function.name).toBe('list_dir');
    expect(captured.messages[3]).toEqual({ role: 'tool', tool_call_id: 'c0', content: '[file] x' });
    expect(captured.tools[0].function.name).toBe('list_dir');
    expect(captured.tools.map((t: any) => t.function.name)).toContain('write_file');
  });

  it('arguments JSON 파싱 실패 시 args {}로 반환한다', async () => {
    const fake = {
      chat: {
        completions: {
          async create() {
            async function* gen() {
              yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: '{broken' } }] } }] };
            }
            return gen();
          },
        },
      },
    };
    const adapter = new OpenAIAgentAdapter({ model: 'm' }, fake as any);
    const res = await adapter.runTurn([{ role: 'user', content: 'x' }], 'S', AGENT_TOOLS, () => {}, noAbort);
    expect(res.toolCalls).toEqual([{ id: 'c1', name: 'read_file', args: {} }]);
  });
});

describe('AnthropicAgentAdapter', () => {
  it('tool_use 블록을 조립하고 tool_result를 user 턴으로 직렬화한다', async () => {
    let captured: any;
    const fake = {
      messages: {
        async create(params: any) {
          captured = params;
          async function* gen() {
            yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '네' } };
            yield { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'write_file' } };
            yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":"a.py","content":' } };
            yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"print(1)"}' } };
            yield { type: 'content_block_stop', index: 1 };
          }
          return gen();
        },
      },
    };
    const adapter = new AnthropicAgentAdapter({ model: 'm', apiKey: 'k' }, fake as any);
    const msgs: AgentMsg[] = [
      { role: 'user', content: '만들어' },
      { role: 'assistant', content: '이전', toolCalls: [{ id: 't0', name: 'list_dir', args: {} }] },
      { role: 'tool', toolCallId: 't0', name: 'list_dir', content: '[file] x' },
    ];
    const chunks: string[] = [];
    const res = await adapter.runTurn(msgs, 'SYS', AGENT_TOOLS, (t) => chunks.push(t), noAbort);
    expect(chunks.join('')).toBe('네');
    expect(res.toolCalls).toEqual([{ id: 't1', name: 'write_file', args: { path: 'a.py', content: 'print(1)' } }]);
    expect(captured.system).toBe('SYS');
    expect(captured.tools[0].input_schema.type).toBe('object');
    // assistant 턴: text + tool_use 블록, tool 결과는 다음 user 턴의 tool_result 블록
    const asst = captured.messages[1];
    expect(asst.role).toBe('assistant');
    expect(asst.content.some((b: any) => b.type === 'tool_use' && b.id === 't0')).toBe(true);
    const toolTurn = captured.messages[2];
    expect(toolTurn.role).toBe('user');
    expect(toolTurn.content[0]).toEqual({ type: 'tool_result', tool_use_id: 't0', content: '[file] x' });
  });
});
```

- [ ] **Step 3: 실패 확인** — Run: `npx vitest run tests/agent-adapters.test.ts` → FAIL

- [ ] **Step 4: adapters.ts 구현**

```ts
// src/main/agent/adapters.ts — 에이전트 턴 어댑터 (클라이언트 주입 가능, chat 어댑터 패턴)
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { AGENT_MAX_TOKENS } from './prompt';
import type { ToolSpec } from './tools';

export interface AgentToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
export type AgentMsg =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: AgentToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };
export interface AgentTurnResult {
  text: string;
  toolCalls: AgentToolCall[];
}
export interface AgentAdapter {
  runTurn(
    messages: AgentMsg[],
    system: string,
    tools: ToolSpec[],
    onChunk: (t: string) => void,
    signal: AbortSignal,
  ): Promise<AgentTurnResult>;
}

function parseArgs(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json || '{}');
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {}; // 파싱 실패 — 실행기가 인자 부족 오류를 tool result로 돌려준다
  }
}

// ── OpenAI 호환 (LM Studio 등) ──
interface OpenAIAgentClient {
  chat: {
    completions: {
      create(
        params: Record<string, unknown>,
        opts?: { signal?: AbortSignal },
      ): Promise<AsyncIterable<{ choices: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> } }> }>>;
    };
  };
}

export class OpenAIAgentAdapter implements AgentAdapter {
  private client: OpenAIAgentClient;
  constructor(
    private cfg: { model: string; apiKey?: string; baseURL?: string },
    client?: OpenAIAgentClient,
  ) {
    this.client =
      client ?? (new OpenAI({ apiKey: cfg.apiKey ?? 'local', baseURL: cfg.baseURL, maxRetries: 0 }) as unknown as OpenAIAgentClient);
  }

  async runTurn(
    messages: AgentMsg[],
    system: string,
    tools: ToolSpec[],
    onChunk: (t: string) => void,
    signal: AbortSignal,
  ): Promise<AgentTurnResult> {
    const wire: Array<Record<string, unknown>> = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (m.role === 'user') wire.push({ role: 'user', content: m.content });
      else if (m.role === 'assistant') {
        const msg: Record<string, unknown> = { role: 'assistant', content: m.content || null };
        if (m.toolCalls?.length) {
          msg.tool_calls = m.toolCalls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.args) },
          }));
        }
        wire.push(msg);
      } else wire.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    }
    const stream = await this.client.chat.completions.create(
      {
        model: this.cfg.model,
        max_tokens: AGENT_MAX_TOKENS,
        stream: true,
        messages: wire,
        tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
      },
      { signal },
    );
    let text = '';
    const acc = new Map<number, { id: string; name: string; args: string }>();
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        text += delta.content;
        onChunk(delta.content);
      }
      for (const tc of delta?.tool_calls ?? []) {
        const cur = acc.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name && !cur.name) cur.name = tc.function.name; // name은 첫 델타에 한 번만 온다
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        acc.set(tc.index, cur);
      }
    }
    const toolCalls: AgentToolCall[] = [...acc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, c], i) => ({ id: c.id || `call_${i}`, name: c.name, args: parseArgs(c.args) }))
      .filter((c) => c.name);
    return { text, toolCalls };
  }
}

// ── Anthropic ──
interface AnthropicAgentClient {
  messages: {
    create(
      params: Record<string, unknown>,
      opts?: { signal?: AbortSignal },
    ): Promise<AsyncIterable<{ type: string; index?: number; content_block?: { type: string; id?: string; name?: string }; delta?: { type?: string; text?: string; partial_json?: string } }>>;
  };
}

export class AnthropicAgentAdapter implements AgentAdapter {
  private client: AnthropicAgentClient;
  constructor(
    private cfg: { model: string; apiKey?: string },
    client?: AnthropicAgentClient,
  ) {
    this.client = client ?? (new Anthropic({ apiKey: cfg.apiKey ?? '', maxRetries: 0 }) as unknown as AnthropicAgentClient);
  }

  async runTurn(
    messages: AgentMsg[],
    system: string,
    tools: ToolSpec[],
    onChunk: (t: string) => void,
    signal: AbortSignal,
  ): Promise<AgentTurnResult> {
    // 중립 표현 → Anthropic content blocks. 연속 tool 메시지는 하나의 user 턴으로 병합.
    const wire: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
    for (const m of messages) {
      if (m.role === 'user') wire.push({ role: 'user', content: m.content });
      else if (m.role === 'assistant') {
        const blocks: unknown[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
        wire.push({ role: 'assistant', content: blocks.length ? blocks : m.content });
      } else {
        const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
        const last = wire[wire.length - 1];
        if (last && last.role === 'user' && Array.isArray(last.content)) (last.content as unknown[]).push(block);
        else wire.push({ role: 'user', content: [block] });
      }
    }
    const stream = await this.client.messages.create(
      {
        model: this.cfg.model,
        max_tokens: AGENT_MAX_TOKENS,
        stream: true,
        system,
        messages: wire,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      },
      { signal },
    );
    let text = '';
    const blocks = new Map<number, { id: string; name: string; json: string }>();
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
        text += ev.delta.text;
        onChunk(ev.delta.text);
      } else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
        blocks.set(ev.index ?? 0, { id: ev.content_block.id ?? '', name: ev.content_block.name ?? '', json: '' });
      } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta') {
        const b = blocks.get(ev.index ?? 0);
        if (b) b.json += ev.delta.partial_json ?? '';
      }
    }
    const toolCalls: AgentToolCall[] = [...blocks.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, b], i) => ({ id: b.id || `tool_${i}`, name: b.name, args: parseArgs(b.json) }));
    return { text, toolCalls };
  }
}
```

- [ ] **Step 5: 통과 확인** — Run: `npx vitest run tests/agent-adapters.test.ts` → PASS

- [ ] **Step 6: 커밋**

```bash
git add src/main/agent/prompt.ts src/main/agent/adapters.ts tests/agent-adapters.test.ts
git commit -m "에이전트 어댑터: Anthropic tool use / OpenAI tool calling 스트리밍 조립 + 시스템 프롬프트

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: AgentService — tool-use 루프

**Files:**
- Create: `src/main/agent/service.ts`
- Test: `tests/agent-service.test.ts`

**Interfaces:**
- Consumes: Task 1 `executeTool/AGENT_TOOLS/AgentToolDeps/toolSummary`, Task 3 `AgentAdapter/AgentMsg/buildAgentSystemPrompt`, Task 2 `AgentEvent`, 기존 `classifyError`(src/main/completion/errors.ts — kind 분류), `ChatMessage/ChatContext`(protocol)
- Produces:
  - `interface AgentDeps { getSettings(): { provider: 'none' | 'anthropic' | 'openai'; model: string; baseURL?: string }; getApiKey(): string | null; getToolDeps(): AgentToolDeps | null; adapterFactory?: (provider: 'anthropic' | 'openai', cfg: { model: string; apiKey: string | null; baseURL?: string }) => AgentAdapter }`
  - `class AgentService { constructor(deps); isStreaming(): boolean; send(messages: ChatMessage[], context: ChatContext | null, autoApprove: boolean, onEvent: (e: AgentEvent) => void): Promise<void>; approve(id: string, ok: boolean): void; cancel(): void }`
  - `const MAX_TOOL_CALLS = 25`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/agent-service.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentService, MAX_TOOL_CALLS } from '../src/main/agent/service';
import type { AgentAdapter, AgentMsg, AgentTurnResult } from '../src/main/agent/adapters';
import type { AgentEvent } from '../src/shared/protocol';

// 각 호출마다 미리 정의된 턴을 돌려주는 fake 어댑터
function fakeAdapter(turns: AgentTurnResult[]): { adapter: AgentAdapter; seen: AgentMsg[][] } {
  const seen: AgentMsg[][] = [];
  let i = 0;
  return {
    seen,
    adapter: {
      async runTurn(messages, _s, _t, onChunk, signal) {
        if (signal.aborted) throw new Error('aborted');
        seen.push(JSON.parse(JSON.stringify(messages)));
        const turn = turns[Math.min(i++, turns.length - 1)];
        if (turn.text) onChunk(turn.text);
        return turn;
      },
    },
  };
}

const baseDeps = (adapter: AgentAdapter, toolResult = 'OK') => ({
  getSettings: () => ({ provider: 'openai' as const, model: 'm' }),
  getApiKey: () => 'k',
  getToolDeps: () => ({
    projectRoot: '/tmp/x',
    allowedDirs: [],
    searchText: async () => [],
  }),
  adapterFactory: () => adapter,
  // 테스트에서는 실제 파일 도구 대신 실행기를 대체한다
  executeToolOverride: async () => toolResult,
});

function collect(): { events: AgentEvent[]; on: (e: AgentEvent) => void } {
  const events: AgentEvent[] = [];
  return { events, on: (e) => events.push(e) };
}

describe('AgentService 루프', () => {
  it('tool call → 실행 → tool result 추가 → 재호출 → 텍스트로 종료', async () => {
    const { adapter, seen } = fakeAdapter([
      { text: '만들게요', toolCalls: [{ id: 'c1', name: 'write_file', args: { path: 'a.py', content: 'x' } }] },
      { text: '완료', toolCalls: [] },
    ]);
    const svc = new AgentService(baseDeps(adapter, '작성 완료: a.py'));
    const { events, on } = collect();
    await svc.send([{ role: 'user', content: '만들어' }], null, true, on);
    // 2턴째 입력에 assistant(toolCalls)와 tool result가 들어있다
    const second = seen[1];
    expect(second.some((m) => m.role === 'assistant' && m.toolCalls?.length === 1)).toBe(true);
    expect(second.some((m) => m.role === 'tool' && m.content === '작성 완료: a.py')).toBe(true);
    // 이벤트 순서: chunk → tool(running) → tool(done, path 포함) → chunk → done
    const kinds = events.map((e) => (e.type === 'tool' ? `tool:${e.state}` : e.type));
    expect(kinds).toEqual(['chunk', 'tool:running', 'tool:done', 'chunk', 'done']);
    const doneTool = events.find((e) => e.type === 'tool' && e.state === 'done') as any;
    expect(doneTool.path).toBe('a.py');
    expect(doneTool.summary).toBe('a.py');
  });

  it('도구 한도 초과 시 한도 안내 후 종료', async () => {
    const { adapter } = fakeAdapter([
      { text: '', toolCalls: [{ id: 'c', name: 'list_dir', args: {} }] }, // 매 턴 1회 → 25턴
    ]);
    const svc = new AgentService(baseDeps(adapter));
    const { events, on } = collect();
    await svc.send([{ role: 'user', content: 'x' }], null, true, on);
    const toolEvents = events.filter((e) => e.type === 'tool' && e.state === 'done');
    expect(toolEvents.length).toBe(MAX_TOOL_CALLS);
    expect(events.some((e) => e.type === 'chunk' && e.text.includes('한도'))).toBe(true);
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });

  it('자동승인 꺼짐: write_file은 awaiting 후 approve(true)로 진행', async () => {
    const { adapter } = fakeAdapter([
      { text: '', toolCalls: [{ id: 'c1', name: 'write_file', args: { path: 'a.py', content: 'x' } }] },
      { text: '끝', toolCalls: [] },
    ]);
    const svc = new AgentService(baseDeps(adapter));
    const { events, on } = collect();
    const p = svc.send([{ role: 'user', content: 'x' }], null, false, on);
    await new Promise((r) => setTimeout(r, 20)); // awaiting 도달 대기
    expect(events.some((e) => e.type === 'tool' && e.state === 'awaiting')).toBe(true);
    svc.approve('c1', true);
    await p;
    expect(events.some((e) => e.type === 'tool' && e.state === 'done')).toBe(true);
  });

  it('거부하면 "사용자가 거부함"이 tool result로 전달된다', async () => {
    const { adapter, seen } = fakeAdapter([
      { text: '', toolCalls: [{ id: 'c1', name: 'run_command', args: { command: 'rm -rf /' } }] },
      { text: '알겠습니다', toolCalls: [] },
    ]);
    const svc = new AgentService(baseDeps(adapter));
    const { events, on } = collect();
    const p = svc.send([{ role: 'user', content: 'x' }], null, false, on);
    await new Promise((r) => setTimeout(r, 20));
    svc.approve('c1', false);
    await p;
    expect(seen[1].some((m) => m.role === 'tool' && m.content.includes('거부'))).toBe(true);
    expect(events.some((e) => e.type === 'tool' && e.state === 'error')).toBe(true);
  });

  it('읽기 도구(list_dir 등)는 자동승인 꺼져도 대기 없이 실행', async () => {
    const { adapter } = fakeAdapter([
      { text: '', toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'a' } }] },
      { text: '끝', toolCalls: [] },
    ]);
    const svc = new AgentService(baseDeps(adapter));
    const { events, on } = collect();
    await svc.send([{ role: 'user', content: 'x' }], null, false, on);
    expect(events.some((e) => e.type === 'tool' && e.state === 'awaiting')).toBe(false);
  });

  it('동시 1개 가드 + provider none 오류', async () => {
    const { adapter } = fakeAdapter([{ text: 'x', toolCalls: [] }]);
    const svc = new AgentService({ ...baseDeps(adapter), getSettings: () => ({ provider: 'none' as const, model: '' }) });
    const { events, on } = collect();
    await svc.send([], null, true, on);
    expect(events[0]).toEqual({ type: 'error', kind: 'other' });
  });

  it('취소: awaiting 대기 중 cancel → 조용히 done', async () => {
    const { adapter } = fakeAdapter([
      { text: '', toolCalls: [{ id: 'c1', name: 'write_file', args: { path: 'a', content: 'b' } }] },
    ]);
    const svc = new AgentService(baseDeps(adapter));
    const { events, on } = collect();
    const p = svc.send([{ role: 'user', content: 'x' }], null, false, on);
    await new Promise((r) => setTimeout(r, 20));
    svc.cancel();
    await p;
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/agent-service.test.ts` → FAIL

- [ ] **Step 3: service.ts 구현**

```ts
// src/main/agent/service.ts — 에이전트 tool-use 루프. electron 임포트 금지, 동시 1개.
import { AnthropicAgentAdapter, OpenAIAgentAdapter, type AgentAdapter, type AgentMsg } from './adapters';
import { AGENT_TOOLS, executeTool, toolSummary, type AgentToolDeps } from './tools';
import { buildAgentSystemPrompt } from './prompt';
import { classifyError } from '../completion/errors';
import type { AgentEvent, ChatContext, ChatMessage } from '../../shared/protocol';

export const MAX_TOOL_CALLS = 25;
const APPROVAL_REQUIRED = new Set(['write_file', 'run_command']);

export interface AgentDeps {
  getSettings(): { provider: 'none' | 'anthropic' | 'openai'; model: string; baseURL?: string };
  getApiKey(): string | null;
  getToolDeps(): AgentToolDeps | null;
  adapterFactory?: (
    provider: 'anthropic' | 'openai',
    cfg: { model: string; apiKey: string | null; baseURL?: string },
  ) => AgentAdapter;
  executeToolOverride?: (name: string, args: Record<string, unknown>, deps: AgentToolDeps) => Promise<string>; // 테스트용
}

const defaultFactory: NonNullable<AgentDeps['adapterFactory']> = (provider, cfg) =>
  provider === 'anthropic'
    ? new AnthropicAgentAdapter({ model: cfg.model, apiKey: cfg.apiKey ?? '' })
    : new OpenAIAgentAdapter({ model: cfg.model, apiKey: cfg.apiKey ?? undefined, baseURL: cfg.baseURL });

export class AgentService {
  private controller: AbortController | null = null;
  private approvals = new Map<string, (ok: boolean) => void>();
  private readonly factory: NonNullable<AgentDeps['adapterFactory']>;
  private readonly exec: NonNullable<AgentDeps['executeToolOverride']>;

  constructor(private deps: AgentDeps) {
    this.factory = deps.adapterFactory ?? defaultFactory;
    this.exec = deps.executeToolOverride ?? executeTool;
  }

  isStreaming(): boolean {
    return this.controller !== null;
  }

  approve(id: string, ok: boolean): void {
    this.approvals.get(id)?.(ok);
    this.approvals.delete(id);
  }

  cancel(): void {
    this.controller?.abort();
    for (const resolve of this.approvals.values()) resolve(false);
    this.approvals.clear();
  }

  private waitApproval(id: string, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve(false);
      this.approvals.set(id, resolve);
      signal.addEventListener('abort', () => resolve(false), { once: true });
    });
  }

  async send(
    messages: ChatMessage[],
    context: ChatContext | null,
    autoApprove: boolean,
    onEvent: (e: AgentEvent) => void,
  ): Promise<void> {
    if (this.controller) {
      onEvent({ type: 'error', kind: 'other' }); // 동시 1개
      return;
    }
    const settings = this.deps.getSettings();
    const toolDeps = this.deps.getToolDeps();
    if (settings.provider === 'none' || !toolDeps) {
      onEvent({ type: 'error', kind: 'other' });
      return;
    }
    const apiKey = this.deps.getApiKey();
    if (settings.provider === 'anthropic' && !apiKey) {
      onEvent({ type: 'error', kind: 'auth' });
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    try {
      const adapter = this.factory(settings.provider, { model: settings.model, apiKey, baseURL: settings.baseURL });
      const system = buildAgentSystemPrompt(context);
      const msgs: AgentMsg[] = messages.map((m) => ({ role: m.role, content: m.content }));
      let toolCount = 0;
      for (;;) {
        const res = await adapter.runTurn(msgs, system, AGENT_TOOLS, (t) => onEvent({ type: 'chunk', text: t }), controller.signal);
        msgs.push({ role: 'assistant', content: res.text, toolCalls: res.toolCalls.length ? res.toolCalls : undefined });
        if (res.toolCalls.length === 0) break;
        for (const call of res.toolCalls) {
          if (controller.signal.aborted) break;
          toolCount++;
          const summary = toolSummary(call.name, call.args);
          const path = call.name === 'write_file' ? String(call.args.path ?? '') : undefined;
          let result: string;
          if (!autoApprove && APPROVAL_REQUIRED.has(call.name)) {
            onEvent({ type: 'tool', id: call.id, name: call.name, summary, state: 'awaiting', path });
            const ok = await this.waitApproval(call.id, controller.signal);
            if (controller.signal.aborted) break;
            if (!ok) {
              result = '사용자가 거부함';
              onEvent({ type: 'tool', id: call.id, name: call.name, summary, state: 'error', detail: result, path });
              msgs.push({ role: 'tool', toolCallId: call.id, name: call.name, content: result });
              continue;
            }
          }
          onEvent({ type: 'tool', id: call.id, name: call.name, summary, state: 'running', path });
          result = await this.exec(call.name, call.args, toolDeps);
          const failed = result.startsWith('오류');
          onEvent({
            type: 'tool',
            id: call.id,
            name: call.name,
            summary,
            state: failed ? 'error' : 'done',
            detail: call.name === 'run_command' || failed ? result : undefined,
            path,
          });
          msgs.push({ role: 'tool', toolCallId: call.id, name: call.name, content: result });
        }
        if (controller.signal.aborted) break;
        if (toolCount >= MAX_TOOL_CALLS) {
          onEvent({ type: 'chunk', text: '\n(도구 호출 한도 도달 — 중단)' });
          break;
        }
      }
      onEvent({ type: 'done' });
    } catch (e) {
      if (controller.signal.aborted) {
        onEvent({ type: 'done' }); // 취소는 오류가 아님 — 부분 응답 유지
      } else {
        console.error('[agent] error:', e instanceof Error ? e.message : e);
        onEvent({ type: 'error', kind: classifyError(e) });
      }
    } finally {
      this.controller = null;
      this.approvals.clear();
    }
  }
}
```

주의: `classifyError`의 실제 시그니처를 `src/main/completion/errors.ts`에서 확인하고 반환값이 `'auth' | 'transient' | 'other'`와 다르면 매핑 함수를 한 줄 추가할 것 ('unsuitable'은 'other'로).

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/agent-service.test.ts` → PASS

- [ ] **Step 5: 커밋**

```bash
git add src/main/agent/service.ts tests/agent-service.test.ts
git commit -m "AgentService: tool-use 루프 — 25회 한도, 승인 대기/거부, 취소, 동시 1개 가드

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: main IPC 배선 + preload

**Files:**
- Modify: `src/main/main.ts` (chat:send 핸들러 근처 + chatService 생성부 근처)
- Modify: `src/preload/preload.ts`

**Interfaces:**
- Consumes: Task 4 `AgentService`, Task 1 `AgentToolDeps`, 기존 `settingsStore`/`indexer`/`currentRoot`/`win`
- Produces: ipc `agent:send(messages, context, autoApprove)` / `agent:cancel` / `agent:approve(id, ok)` / push `agent:event`; preload `agentSend/agentCancel/agentApprove/onAgentEvent`

- [ ] **Step 1: main.ts 배선** — import 추가 (`AgentService`는 `./agent/service`, `AgentEvent`는 protocol 타입 임포트에 추가). `let agentService: AgentService;`를 `let chatService` 선언 옆에. chatService 생성부(약 363행) 아래에:

```ts
  agentService = new AgentService({
    getSettings: () => settingsStore.getCompletion(),
    getApiKey: () => settingsStore.getApiKey(),
    getToolDeps: () =>
      currentRoot
        ? {
            projectRoot: currentRoot,
            allowedDirs: settingsStore.getAgent().allowedDirs,
            searchText: async (query: string) =>
              indexer
                ? ((await indexer.rpc.request('searchText', { query }, { timeoutMs: 30_000 })) as { path: string; snippet: string }[])
                : [],
          }
        : null,
  });
```

`chat:cancel` 핸들러 아래에:

```ts
  ipcMain.handle('agent:send', (_e, messages: ChatMessage[], context: ChatContext | null, autoApprove: boolean) => {
    void agentService.send(messages, context, autoApprove, (event) => win?.webContents.send('agent:event', event));
  });
  ipcMain.handle('agent:cancel', () => agentService.cancel());
  ipcMain.handle('agent:approve', (_e, id: string, ok: boolean) => agentService.approve(id, ok));
```

주의: `currentRoot`(프로젝트 루트 상태)와 `indexer` 변수의 실제 이름을 main.ts에서 확인해 맞출 것 (openProjectInMain 근처에서 대입되는 변수).

**프로젝트 전환/종료 시 루프 취소 (스펙 §4-6)** — openProjectInMain에서 `chatService`를 리셋/취소하는 지점(터미널 killAll 근처)에 다음을 추가하고, before-quit 정리부에도 동일하게 추가:

```ts
  agentService?.cancel(); // 진행 중 에이전트 루프 중단 — 이전 프로젝트에 쓰기 방지
```

(chatService에 대한 기존 취소/리셋 처리가 없다면 agentService.cancel()만 추가하면 된다 — 렌더러 store는 setProject에서 이미 대화를 리셋한다.)

- [ ] **Step 2: preload** — `onChatEvent` 근처에 (AgentEvent를 타입 임포트에 추가):

```ts
  agentSend: (messages: ChatMessage[], context: ChatContext | null, autoApprove: boolean): Promise<void> =>
    ipcRenderer.invoke('agent:send', messages, context, autoApprove),
  agentCancel: (): Promise<void> => ipcRenderer.invoke('agent:cancel'),
  agentApprove: (id: string, ok: boolean): Promise<void> => ipcRenderer.invoke('agent:approve', id, ok),
  onAgentEvent: (cb: (e: AgentEvent) => void): void => {
    ipcRenderer.on('agent:event', (_e, ev: AgentEvent) => cb(ev));
  },
```

- [ ] **Step 3: 빌드 확인** — Run: `npm run build 2>&1 | grep -iE "\berror\b" | grep -v ".svg"; echo OK` → OK만

- [ ] **Step 4: 커밋**

```bash
git add src/main/main.ts src/preload/preload.ts
git commit -m "에이전트 IPC 배선: agent:send/cancel/approve + agent:event push, 인덱서 검색 주입

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 렌더러 — 스토어·App 구독·ChatPanel 토글/도구 카드·트리 새로고침

**Files:**
- Modify: `src/renderer/src/store.ts`
- Modify: `src/renderer/src/App.tsx` (기존 onChatEvent 구독 근처)
- Modify: `src/renderer/src/components/ChatPanel.tsx`
- Modify: `src/renderer/src/components/ProjectWindow.tsx`
- Modify: `src/renderer/src/theme.css`
- Test: `tests/renderer-store.test.ts` (케이스 추가)

**Interfaces:**
- Consumes: Task 2 `AgentToolUi/AgentEvent`, preload `agentSend/agentCancel/agentApprove/onAgentEvent`
- Produces (store):
  - `agentMode: boolean` / `setAgentMode(v)` , `autoApprove: boolean`(기본 true) / `setAutoApprove(v)`
  - `chatMessages` 항목에 `tools?: AgentToolUi[]` 추가
  - `upsertChatTool(tool: AgentToolUi): void` — 마지막 assistant 메시지의 tools에 id로 upsert
  - `treeRefreshNonce: number` / `bumpTreeRefresh(): void` — ProjectWindow 외부 새로고침 트리거

- [ ] **Step 1: 실패하는 스토어 테스트 추가** — `tests/renderer-store.test.ts`에:

```ts
it('upsertChatTool: 마지막 어시스턴트 메시지에 id로 upsert', () => {
  const s = useAppStore.getState();
  s.appendChatUser('만들어');
  s.appendChatAssistant();
  s.upsertChatTool({ id: 'c1', name: 'write_file', summary: 'a.py', state: 'running' });
  s.upsertChatTool({ id: 'c1', name: 'write_file', summary: 'a.py', state: 'done', path: 'a.py' });
  const last = useAppStore.getState().chatMessages.at(-1)!;
  expect(last.tools).toHaveLength(1);
  expect(last.tools![0].state).toBe('done');
});
```

(파일 상단 기존 테스트들의 스토어 리셋 패턴을 그대로 따를 것.)

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/renderer-store.test.ts` → FAIL

- [ ] **Step 3: store.ts 구현** — 타입 임포트에 `AgentToolUi` 추가:

```ts
// 상태 인터페이스에 추가:
  agentMode: boolean;
  autoApprove: boolean;
  treeRefreshNonce: number;
  setAgentMode(v: boolean): void;
  setAutoApprove(v: boolean): void;
  upsertChatTool(tool: AgentToolUi): void;
  bumpTreeRefresh(): void;
// chatMessages 항목 타입에 tools?: AgentToolUi[] 추가
// 초기값: agentMode: false, autoApprove: true, treeRefreshNonce: 0
// 구현:
  setAgentMode: (v) => set({ agentMode: v }),
  setAutoApprove: (v) => set({ autoApprove: v }),
  bumpTreeRefresh: () => set((s) => ({ treeRefreshNonce: s.treeRefreshNonce + 1 })),
  upsertChatTool: (tool) =>
    set((s) => {
      const msgs = s.chatMessages.slice();
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== 'assistant') return {};
      const tools = (last.tools ?? []).slice();
      const idx = tools.findIndex((t) => t.id === tool.id);
      if (idx >= 0) tools[idx] = tool;
      else tools.push(tool);
      msgs[msgs.length - 1] = { ...last, tools };
      return { chatMessages: msgs };
    }),
```

`setProject` 리셋 객체에 `agentMode`는 유지(사용자 선호), `treeRefreshNonce: 0` 포함 여부는 무관 — 추가하지 않는다.

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/renderer-store.test.ts` → PASS

- [ ] **Step 5: App.tsx 구독** — 기존 `window.si.onChatEvent(...)` 구독 코드 바로 아래에 (같은 effect 안, 임포트에 `AgentEvent` 타입 불요 — preload 시그니처로 추론):

```ts
    // 에이전트 이벤트 — 채팅과 동일하게 App에서 구독 (탭 전환 언마운트 유실 방지, Plan 8 P1)
    window.si.onAgentEvent((ev) => {
      const st = useAppStore.getState();
      if (ev.type === 'chunk') st.appendChatChunk(ev.text);
      else if (ev.type === 'tool') {
        st.upsertChatTool({ id: ev.id, name: ev.name, summary: ev.summary, state: ev.state, detail: ev.detail, path: ev.path });
        if (ev.name === 'write_file' && ev.state === 'done') st.bumpTreeRefresh();
      } else if (ev.type === 'done') st.setChatStreaming(false);
      else {
        st.setChatError(ev.kind); // 기존 chat:event error 처리와 동일한 함수 사용 — 실제 함수명을 onChatEvent 처리부에서 확인해 맞출 것
        st.setChatStreaming(false);
      }
    });
```

주의: 기존 onChatEvent 처리부가 error kind를 어떻게 메시지에 반영하는지(예: `CHAT_ERROR_TEXT` 매핑 후 마지막 메시지에 error 설정) 그대로 복사해 동일하게 처리한다.

- [ ] **Step 6: ChatPanel 토글+도구 카드+전송 분기**

툴바(컨텍스트 토글 옆)에:

```tsx
<label className="chat-context-toggle" title="AI가 도구로 파일을 직접 생성/수정">
  <input type="checkbox" checked={agentMode} onChange={(e) => useAppStore.getState().setAgentMode(e.target.checked)} />
  <span className="chat-context-label">에이전트</span>
</label>
{agentMode && (
  <label className="chat-context-toggle" title="끄면 파일 쓰기/셸 실행 전에 승인 버튼이 표시됩니다">
    <input type="checkbox" checked={autoApprove} onChange={(e) => useAppStore.getState().setAutoApprove(e.target.checked)} />
    <span className="chat-context-label">자동 승인</span>
  </label>
)}
```

(`agentMode`/`autoApprove`는 `useAppStore((s) => s.agentMode)` 등으로 구독.)

send()의 `window.si.chatSend(history, context)` 부분을:

```ts
    if (useAppStore.getState().agentMode) void window.si.agentSend(history, context, useAppStore.getState().autoApprove);
    else void window.si.chatSend(history, context);
```

cancel()도 분기: `agentMode ? window.si.agentCancel() : window.si.chatCancel()`.

메시지 렌더에서 assistant 콘텐츠 위에 도구 카드:

```tsx
{m.role === 'assistant' && m.tools && m.tools.length > 0 && (
  <div className="tool-cards">
    {m.tools.map((t) => (
      <div
        key={t.id}
        className={`tool-card tool-${t.state}${t.path && t.state === 'done' ? ' clickable' : ''}`}
        onClick={() => {
          if (t.path && t.state === 'done') useAppStore.getState().openTab(t.path);
        }}
      >
        <span className="tool-card-head">
          <span className="tool-name">{t.name}</span>
          <span className="tool-summary" title={t.summary}>{t.summary}</span>
          <span className="tool-state">
            {t.state === 'running' ? '실행 중…' : t.state === 'done' ? '완료' : t.state === 'error' ? '실패' : '승인 대기'}
          </span>
        </span>
        {t.state === 'awaiting' && (
          <span className="tool-actions">
            <button className="rename-btn primary" onClick={(e) => { e.stopPropagation(); void window.si.agentApprove(t.id, true); }}>실행</button>
            <button className="rename-btn" onClick={(e) => { e.stopPropagation(); void window.si.agentApprove(t.id, false); }}>건너뛰기</button>
          </span>
        )}
        {t.detail && t.state !== 'awaiting' && (
          <details className="tool-detail" onClick={(e) => e.stopPropagation()}>
            <summary>출력 보기</summary>
            <pre>{t.detail}</pre>
          </details>
        )}
      </div>
    ))}
  </div>
)}
```

theme.css 채팅 섹션에:

```css
.tool-cards { display: flex; flex-direction: column; gap: 4px; margin: 6px 0; }
.tool-card { border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-size: 12px; background: var(--bg-panel); }
.tool-card.clickable { cursor: pointer; }
.tool-card.clickable:hover { background: var(--bg-hover); }
.tool-card-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.tool-name { color: var(--accent); font-weight: 600; flex: none; }
.tool-summary { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, Menlo, monospace; }
.tool-state { flex: none; color: var(--fg-dim); font-size: 11px; }
.tool-card.tool-error .tool-state { color: var(--warn); }
.tool-actions { display: flex; gap: 6px; margin-top: 6px; }
.tool-detail pre { margin: 4px 0 0; padding: 6px; background: var(--bg); border-radius: 4px; overflow-x: auto; font-size: 11px; max-height: 200px; overflow-y: auto; }
.tool-detail summary { cursor: pointer; color: var(--fg-dim); font-size: 11px; }
```

- [ ] **Step 7: ProjectWindow 외부 새로고침** — 컴포넌트에 구독과 effect 추가:

```ts
const treeRefreshNonce = useAppStore((s) => s.treeRefreshNonce);
// 기존 refresh 함수 아래에:
useEffect(() => {
  if (treeRefreshNonce > 0) void refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [treeRefreshNonce]);
```

- [ ] **Step 8: 빌드 확인** — Run: `npm run build 2>&1 | grep -iE "\berror\b" | grep -v ".svg"; echo OK` → OK만

- [ ] **Step 9: 커밋**

```bash
git add src/renderer/src/store.ts src/renderer/src/App.tsx src/renderer/src/components/ChatPanel.tsx src/renderer/src/components/ProjectWindow.tsx src/renderer/src/theme.css tests/renderer-store.test.ts
git commit -m "에이전트 UI: 채팅 토글/자동승인, 도구 카드(승인·출력·클릭 열기), 트리 자동 새로고침

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 통합 테스트 + E2E

**Files:**
- Create: `tests/agent-openai-integration.test.ts`
- Create: `tests/e2e/agent.spec.ts`

**Interfaces:**
- Consumes: Task 3 `OpenAIAgentAdapter`, Task 4 `AgentService`, 전체 배선
- Produces: 검증만

- [ ] **Step 1: 통합 테스트 작성** — fake HTTP SSE tool calling 서버로 어댑터 실왕복 (기존 `tests/chat-openai-integration.test.ts`의 서버 패턴 참고):

```ts
// tests/agent-openai-integration.test.ts
import { describe, it, expect } from 'vitest';
import * as http from 'http';
import { OpenAIAgentAdapter } from '../src/main/agent/adapters';
import { AGENT_TOOLS } from '../src/main/agent/tools';

function sse(res: http.ServerResponse, obj: unknown): void {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

describe('OpenAI 에이전트 어댑터 통합 (fake SSE tool calling 서버)', () => {
  it('1턴 tool_calls 수신 → tool 메시지 포함 2턴 요청 → 텍스트 수신', async () => {
    const bodies: any[] = [];
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        const body = JSON.parse(raw);
        bodies.push(body);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const hasToolMsg = body.messages.some((m: any) => m.role === 'tool');
        if (!hasToolMsg) {
          sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'write_file', arguments: '' } }] } }] });
          sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"gugudan.py","content":"print(2*1)"}' } }] } }] });
          sse(res, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
        } else {
          sse(res, { choices: [{ delta: { content: '생성 완료' } }] });
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const adapter = new OpenAIAgentAdapter({ model: 'm', baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'k' });
      const signal = new AbortController().signal;
      const t1 = await adapter.runTurn([{ role: 'user', content: '만들어' }], 'S', AGENT_TOOLS, () => {}, signal);
      expect(t1.toolCalls[0]).toEqual({ id: 'c1', name: 'write_file', args: { path: 'gugudan.py', content: 'print(2*1)' } });
      const chunks: string[] = [];
      const t2 = await adapter.runTurn(
        [
          { role: 'user', content: '만들어' },
          { role: 'assistant', content: '', toolCalls: t1.toolCalls },
          { role: 'tool', toolCallId: 'c1', name: 'write_file', content: '작성 완료' },
        ],
        'S', AGENT_TOOLS, (t) => chunks.push(t), signal,
      );
      expect(chunks.join('')).toBe('생성 완료');
      expect(t2.toolCalls).toHaveLength(0);
      expect(bodies[1].messages.some((m: any) => m.role === 'tool')).toBe(true);
      expect(bodies[0].tools).toHaveLength(5);
    } finally {
      server.close();
    }
  });
});
```

- [ ] **Step 2: 통과 확인** — Run: `npx vitest run tests/agent-openai-integration.test.ts` → PASS (실패 시 어댑터의 SSE 처리 수정)

- [ ] **Step 3: E2E 작성** — `tests/e2e/chat.spec.ts`의 구조(설정 심기/electron.launch/서버)를 따르되 tool calling 서버 사용:

```ts
// tests/e2e/agent.spec.ts
import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

function startFakeServer(): Promise<{ server: http.Server; baseURL: string }> {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const body = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      if (!body.messages.some((m: { role: string }) => m.role === 'tool')) {
        send({ choices: [{ delta: { content: '구구단 파일을 만들게요. ' } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'gugudan.py', content: 'for i in range(1,10):\n    print(2*i)\n' }) } }] } }] });
        send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
      } else {
        send({ choices: [{ delta: { content: 'gugudan.py 생성 완료' } }] });
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, baseURL: `http://127.0.0.1:${addr.port}/v1` });
    }),
  );
}

test('에이전트 모드: 요청 → write_file 실행 → 디스크 생성 + 카드 + 트리 반영', async () => {
  const { server, baseURL } = await startFakeServer();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-agent-'));
  const proj = path.join(work, 'proj');
  const ud = path.join(work, 'ud');
  fs.mkdirSync(proj);
  fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(proj, 'a.ts'), 'const x = 1;\n');
  fs.writeFileSync(
    path.join(ud, 'settings.json'),
    JSON.stringify({ profiles: [{ id: 'p1', name: 'fake', provider: 'openai', model: 'fake', baseURL, apiKey: 'k' }], activeProfileId: 'p1' }),
  );
  const app = await electron.launch({ args: ['.'], env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: ud } });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.tree-item', { hasText: 'a.ts' })).toBeVisible({ timeout: 15_000 });
    await page.locator('.right-tabs button', { hasText: 'AI 채팅' }).click();
    // 에이전트 모드 켜기
    await page.locator('.chat-context-toggle', { hasText: '에이전트' }).locator('input').check();
    const input = page.locator('.chat-input-row textarea');
    await input.fill('구구단 앱을 파이썬으로 만들어줘');
    await input.press('Enter');
    // 도구 카드 → 완료
    await expect(page.locator('.tool-card', { hasText: 'gugudan.py' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.tool-card.tool-done')).toBeVisible({ timeout: 15_000 });
    // 텍스트 응답 + 디스크 실존 + 트리 반영
    await expect(page.locator('.chat-assistant')).toContainText('생성 완료', { timeout: 15_000 });
    await expect
      .poll(() => fs.existsSync(path.join(proj, 'gugudan.py')), { timeout: 10_000 })
      .toBe(true);
    expect(fs.readFileSync(path.join(proj, 'gugudan.py'), 'utf8')).toContain('for i in range');
    await expect(page.locator('.tree-item', { hasText: 'gugudan.py' })).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close();
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: E2E 실행** — Run: `npm run build && npm run rebuild:electron && npx playwright test tests/e2e/agent.spec.ts` → 1 passed. 이후 다른 단위 테스트를 돌리려면 `npm run rebuild:node` 필요 (ABI 이중성).

- [ ] **Step 5: 전체 회귀** — Run: `npm run rebuild:node && npm test 2>&1 | grep -E "Test Files|Tests "` → 전체 PASS (기존 242 + 신규)

- [ ] **Step 6: 커밋**

```bash
git add tests/agent-openai-integration.test.ts tests/e2e/agent.spec.ts
git commit -m "에이전트 통합/E2E: fake tool calling 서버 왕복 + 파일 생성·카드·트리 반영 실증

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
