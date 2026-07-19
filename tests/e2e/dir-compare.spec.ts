import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Plan: Directory Compare E2E.
// 두 폴더 준비 → dirA 우클릭 "비교 대상 폴더로 선택" → dirB 우클릭 "폴더 비교"
// → dircmp 탭에 차이 목록(다름/한쪽만) 표시 → 다름 행 클릭 시 diff 탭.
test('Directory Compare: 폴더 우클릭 → 비교 → 결과 목록 → 파일 diff', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-dcmp-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(path.join(proj, 'A'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'B'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'A', 'shared.txt'), 'v1\n');
  fs.writeFileSync(path.join(proj, 'B', 'shared.txt'), 'v2\n'); // 다름
  fs.writeFileSync(path.join(proj, 'A', 'onlyA.txt'), 'a\n'); // 왼쪽만

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: path.join(work, 'ud') },
  });
  try {
    const page = await app.firstWindow();
    await page.locator('.tree-item', { hasText: 'A' }).first().click({ button: 'right' });
    await expect(page.locator('.tree-ctx-menu')).toBeVisible();
    await page.locator('.open-editors-item', { hasText: '비교 대상 폴더로 선택' }).click();
    await page.locator('.tree-item', { hasText: 'B' }).first().click({ button: 'right' });
    await page.locator('.open-editors-item', { hasText: '폴더 비교' }).click();

    // 결과 목록 표시 (다름 + 왼쪽만)
    await expect(page.locator('.dircmp-row', { hasText: 'shared.txt' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.dircmp-row', { hasText: 'onlyA.txt' })).toBeVisible();

    // 다름 행 클릭 → diff 탭
    await page.locator('.dircmp-row', { hasText: 'shared.txt' }).click();
    await expect(page.locator('.diff-tab-host')).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
