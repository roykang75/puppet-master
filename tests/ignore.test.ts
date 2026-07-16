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
