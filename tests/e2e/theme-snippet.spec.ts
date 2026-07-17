import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

test('테마 전환(Light+) + 스니펫 삽입(log)', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-theme-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'a.ts'), 'const x = 1;\n');

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: path.join(work, 'ud') },
  });
  try {
    const page = await app.firstWindow();
    const item = page.locator('.tree-item', { hasText: 'a.ts' });
    await expect(item).toBeVisible({ timeout: 15_000 });
    await item.click();
    await expect(page.locator('.editor-host')).toContainText('const', { timeout: 15_000 });

    // 초기(다크) 배경 기록
    const bgBefore = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    // 설정 → 테마 Light+ → 저장
    await page.keyboard.press('ControlOrMeta+,');
    await page.locator('.settings-box').waitFor({ timeout: 5_000 });
    await page.locator('.settings-box select#theme-select').selectOption('light-plus');
    await page.locator('.settings-box button.primary').click();
    await page.locator('.settings-box').waitFor({ state: 'hidden', timeout: 10_000 });

    // body 배경이 밝게 변경 (CSS 변수 주입) + themeKind=light
    await expect
      .poll(async () => page.evaluate(() => getComputedStyle(document.body).backgroundColor), { timeout: 10_000 })
      .not.toBe(bgBefore);
    const kind = await page.evaluate(() => document.documentElement.dataset.themeKind);
    expect(kind).toBe('light');

    // 스니펫: 파일 끝에서 'log' 타이핑 → 드롭다운에 Snippet 항목 → 선택 삽입
    await page.locator('.editor-host').click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('log');
    const widget = page.locator('.suggest-widget.visible');
    await expect(widget).toBeVisible({ timeout: 15_000 });
    // LSP 완성과 스니펫이 같은 드롭다운에 섞임 — 스니펫 라벨(description 'Console log')로 좁힘
    const snippetRow = widget.locator('.monaco-list-row', { hasText: 'Console log' }).first();
    await expect(snippetRow).toBeVisible({ timeout: 5_000 });
    await snippetRow.click();
    await expect(page.locator('.editor-host')).toContainText('console.log', { timeout: 5_000 });
  } finally {
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
