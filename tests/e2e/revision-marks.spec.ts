import { test, expect, _electron as electron } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Plan 17: 리비전 마크 E2E.
// git repo에 커밋된 파일을 워킹트리에서 수정 → 열면 gutter에 .rev-mark-modify 표시.
test('리비전 마크: HEAD 대비 수정 라인 gutter 바', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-rev-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(proj);
  const git = (args: string[]) => execFileSync('git', args, { cwd: proj, stdio: 'pipe' });
  git(['init', '-q']);
  git(['config', 'user.email', 't@t.dev']);
  git(['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(proj, 'code.ts'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
  git(['add', 'code.ts']);
  git(['commit', '-q', '-m', 'init']);
  // 워킹트리 수정 — line2 변경 + line4 추가
  fs.writeFileSync(path.join(proj, 'code.ts'), 'const a = 1;\nconst b = 999;\nconst c = 3;\nconst d = 4;\n');

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: path.join(work, 'ud') },
  });
  try {
    const page = await app.firstWindow();
    await page.locator('.tree-item', { hasText: 'code.ts' }).click();
    // gutter에 수정/추가 마크가 나타남
    await expect(page.locator('.rev-mark-modify').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.rev-mark-add').first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
