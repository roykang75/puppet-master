import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LspManager } from '../src/main/lsp/manager';
import type { LspDiagnosticN, LspStatusN } from '../src/shared/protocol';

let root: string;
let mgr: LspManager;
const diags = new Map<string, LspDiagnosticN[]>();
const statuses: LspStatusN[] = [];

const waitFor = async (cond: () => boolean, ms: number): Promise<void> => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
  if (!cond()) throw new Error('waitFor 타임아웃');
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'si-lsp-'));
  fs.writeFileSync(path.join(root, 'lib.ts'), 'export function greet(name: string): string {\n  return name.toUpperCase();\n}\n');
  fs.writeFileSync(path.join(root, 'use.ts'), "import { greet } from './lib';\nconst s = greet('hi');\ns.\n");
  fs.writeFileSync(path.join(root, 'bad.ts'), "const n: number = 'oops';\n");
  fs.writeFileSync(path.join(root, 'm.py'), 'def add(a: int, b: int) -> int:\n    return a + b\n');
  fs.writeFileSync(path.join(root, 'use.py'), 'from m import add\nx: int = "bad"\ns = "hi"\ns.\n');
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}\n');
  fs.writeFileSync(path.join(root, 'pyrightconfig.json'), '{}\n');
  mgr = new LspManager({
    root,
    onDiagnostics: (p, d) => diags.set(p, d),
    onStatus: (s) => statuses.push(s),
  });
});

afterAll(() => {
  mgr.shutdownAll();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('tsgo 실왕복', () => {
  it('didOpen → running 상태', async () => {
    for (const f of ['lib.ts', 'use.ts', 'bad.ts']) {
      mgr.notify('didOpen', { path: f, text: fs.readFileSync(path.join(root, f), 'utf8') });
    }
    await waitFor(() => statuses.some((s) => s.lang === 'ts' && s.state === 'running'), 20_000);
  }, 30_000);

  it('completion: s. 뒤에서 toUpperCase 제안', async () => {
    const items = (await mgr.request('completion', { path: 'use.ts', line: 2, col: 2 })) as { label: string }[];
    expect(items.map((i) => i.label)).toContain('toUpperCase');
  }, 30_000);

  it('hover: greet 위에서 시그니처 markdown', async () => {
    const hover = (await mgr.request('hover', { path: 'use.ts', line: 1, col: 11 })) as { markdown: string } | null;
    expect(hover?.markdown ?? '').toContain('greet');
  }, 30_000);

  it('definition: use.ts의 greet → lib.ts', async () => {
    const locs = (await mgr.request('definition', { path: 'use.ts', line: 1, col: 11 })) as { path: string }[];
    expect(locs[0]?.path).toBe('lib.ts');
  }, 30_000);

  it('진단(pull): bad.ts 타입 오류 수신', async () => {
    await waitFor(() => (diags.get('bad.ts')?.length ?? 0) > 0, 20_000);
    expect(diags.get('bad.ts')![0].message.length).toBeGreaterThan(0);
  }, 30_000);

  it('references: greet → 선언(lib.ts) + 사용(use.ts)', async () => {
    const refs = (await mgr.request('references', { path: 'use.ts', line: 1, col: 11 })) as { path: string }[];
    const paths = refs.map((r) => r.path);
    expect(paths).toContain('lib.ts'); // includeDeclaration
    expect(paths).toContain('use.ts');
  }, 30_000);

  it('signatureHelp: greet( 안에서 name 파라미터', async () => {
    const sh = (await mgr.request('signatureHelp', { path: 'use.ts', line: 1, col: 16 })) as {
      signatures: { label: string }[];
    } | null;
    expect(sh?.signatures[0]?.label ?? '').toContain('name');
  }, 30_000);

  it('format: 잘못 들여쓴 파일에 대해 편집 반환', async () => {
    const p = path.join(root, 'messy.ts');
    fs.writeFileSync(p, 'function  f( ){return    1}\n');
    mgr.notify('didOpen', { path: 'messy.ts', text: fs.readFileSync(p, 'utf8') });
    await new Promise((r) => setTimeout(r, 300));
    const edits = await mgr.format({ path: 'messy.ts', tabSize: 2, insertSpaces: true });
    expect(edits.length).toBeGreaterThan(0); // tsserver가 정렬 편집 제안
  }, 30_000);
});

describe('pyright 실왕복', () => {
  it('didOpen → running + 진단(push): 타입 오류 수신', async () => {
    for (const f of ['m.py', 'use.py']) {
      mgr.notify('didOpen', { path: f, text: fs.readFileSync(path.join(root, f), 'utf8') });
    }
    await waitFor(() => statuses.some((s) => s.lang === 'py' && s.state === 'running'), 60_000);
    await waitFor(() => (diags.get('use.py')?.length ?? 0) > 0, 60_000);
  }, 120_000);

  it('completion: s. 뒤에서 upper 제안', async () => {
    const items = (await mgr.request('completion', { path: 'use.py', line: 3, col: 2 })) as { label: string }[];
    expect(items.map((i) => i.label)).toContain('upper');
  }, 60_000);

  it('definition: use.py의 add → m.py', async () => {
    const locs = (await mgr.request('definition', { path: 'use.py', line: 0, col: 14 })) as { path: string }[];
    expect(locs[0]?.path).toBe('m.py');
  }, 60_000);

  it('hover: add 위에서 시그니처', async () => {
    const hover = (await mgr.request('hover', { path: 'use.py', line: 0, col: 14 })) as { markdown: string } | null;
    expect(hover?.markdown ?? '').toContain('add');
  }, 60_000);
});
