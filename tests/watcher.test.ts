import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { watchProject } from '../src/indexer/watcher';

function waitFor(cond: () => boolean, ms = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const t = setInterval(() => {
      if (cond()) { clearInterval(t); resolve(); }
      else if (Date.now() - start > ms) { clearInterval(t); reject(new Error('timeout')); }
    }, 50);
  });
}

// chokidar의 네이티브 워처 등록은 watchProject() 호출 후 비동기로 완료되므로, 호출 직후 곧바로
// 파일을 쓰면 워처가 아직 준비되지 않아 그 이벤트를 놓칠 수 있다(레디 경합, fork 경합 하에서 재현).
// 고정 sleep으로 "준비됐다"고 가정하는 대신, 워밍업 파일이 감지될 때까지 주기적으로 재작성해
// 결정적으로 준비를 확인한다. 재시도 간격(500ms)은 awaitWriteFinish stabilityThreshold(300ms)보다
// 커서, 한 번 감지가 시작되면 다음 재시도 전에 안정화되어 이벤트가 발생할 여지를 준다.
function waitForWithRetry(
  check: () => boolean,
  retry: () => void,
  { timeoutMs = 15000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {}
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
      // 워처 준비 경합 방지: 별도 워밍업 파일이 감지될 때까지 재시도 (x.c 등 실제 검증 대상과는
      // 이름이 겹치지 않아 이후 카운트 기반 단언에 영향을 주지 않는다)
      const warm = path.join(tmp, '_warmup.c');
      let attempt = 0;
      await waitForWithRetry(
        () => changed.includes('_warmup.c'),
        () => { attempt += 1; fs.writeFileSync(warm, `int w; // ${attempt}`); }
      );

      const f = path.join(tmp, 'x.c');
      fs.writeFileSync(f, 'int a;');
      await waitFor(() => changed.includes('x.c'));
      fs.writeFileSync(f, 'int a; int b;');
      await waitFor(() => changed.filter((n) => n === 'x.c').length >= 2);
      fs.unlinkSync(f);
      await waitFor(() => removed.includes('x.c'));
      // 미지원 확장자는 무시: y.txt와 함께 지원 확장자 z.c도 써서, z.c 감지(포지티브 신호)를
      // 앵커로 삼아 그 시점까지 y.txt가 나타나지 않았는지 확인한다 (고정 sleep 대신 결정적 대기)
      fs.writeFileSync(path.join(tmp, 'y.txt'), 'hi');
      fs.writeFileSync(path.join(tmp, 'z.c'), 'int z;');
      await waitFor(() => changed.includes('z.c'));
      expect(changed).not.toContain('y.txt');
    } finally {
      await w.close();
    }
  }, 70000);
});
