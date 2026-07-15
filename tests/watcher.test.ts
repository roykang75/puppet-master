import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { watchProject } from '../src/indexer/watcher';

function waitFor(cond: () => boolean, ms = 8000): Promise<void> {
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
