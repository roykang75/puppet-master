import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Plan 16: File Compare E2E.
// 흐름: 두 파일 준비 → a.txt 우클릭 "비교 대상으로 선택" → b.txt 우클릭 "'a.txt'와(과) 비교"
//       → diff 탭(.diff-tab-host) 표시 + 탭 제목 "비교:" 확인.
test('File Compare: 우클릭 선택 → 비교 → diff 탭', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-cmp-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'a.txt'), 'line one\nline two\n');
  fs.writeFileSync(path.join(proj, 'b.txt'), 'line one\nline CHANGED\n');

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: path.join(work, 'ud') },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.tree-item', { hasText: 'a.txt' })).toBeVisible({ timeout: 30_000 });

    // a.txt 우클릭 → "비교 대상으로 선택"
    await page.locator('.tree-item', { hasText: 'a.txt' }).click({ button: 'right' });
    await expect(page.locator('.tree-ctx-menu')).toBeVisible();
    await page.locator('.open-editors-item', { hasText: '비교 대상으로 선택' }).click();

    // b.txt 우클릭 → "'a.txt'와(과) 비교"
    await page.locator('.tree-item', { hasText: 'b.txt' }).click({ button: 'right' });
    await page.locator('.open-editors-item', { hasText: '와(과) 비교' }).click();

    // diff 탭 렌더 + 제목 확인
    await expect(page.locator('.diff-tab-host')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('비교: a.txt ↔ b.txt').first()).toBeVisible();
  } finally {
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
