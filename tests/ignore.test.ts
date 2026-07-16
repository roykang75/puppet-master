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

// 워처 준비(초기 fs 구독 완료) 시점은 fork 경합 하에서 가변적이라, 고정 sleep으로
// "준비됐다"고 가정하는 대신 감지될 때까지 주기적으로 재시도(rewrite)하여 결정적으로 기다린다.
// 재시도 간격(600ms)은 awaitWriteFinish의 stabilityThreshold(300ms)보다 넉넉히 커서,
// 한 번 감지가 시작되면 다음 재시도 전에 안정화되어 이벤트가 발생할 여지를 준다.
function waitForWithRetry(
  check: () => boolean,
  retry: () => void,
  { timeoutMs = 20000, intervalMs = 600 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (check()) { resolve(); return; }
      if (Date.now() - start > timeoutMs) { reject(new Error('timeout waiting for condition')); return; }
      retry();
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

describe('watchProject gitignore 정합 (M-A)', () => {
  it('gitignore된 디렉터리의 변경은 통지하지 않는다', async () => {
    const seen: string[] = [];
    const w = watchProject(root, {
      onChangeOrAdd: (p) => seen.push(path.relative(root, p).split(path.sep).join('/')),
      onRemove: () => {},
    });
    try {
      let n = 0;
      await waitForWithRetry(
        () => seen.includes('src/b.ts'),
        () => {
          n += 1;
          fs.writeFileSync(path.join(root, 'generated', 'gen2.ts'), `export const g2 = ${n};`);
          fs.writeFileSync(path.join(root, 'src', 'b.ts'), `export const b = ${n};`);
        }
      );
      // 포지티브 신호(src/b.ts 감지) 이후로 앵커링된 bounded settle window: 이 시점이면
      // 워처 파이프라인이 확실히 가동 중이므로, gitignore된 경로의 이벤트가 뒤늦게 도착하지
      // 않았는지 확인하기 위한 여유 시간만 필요하다.
      await new Promise((r) => setTimeout(r, 1000));
      expect(seen).not.toContain('generated/gen2.ts');
    } finally {
      await w.close();
    }
  }, 30000);
});
