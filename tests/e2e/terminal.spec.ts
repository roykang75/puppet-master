import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

test('내장 터미널: echo 출력 + 두 번째 터미널 탭', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-term-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'a.ts'), 'const x = 1;\n');

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: path.join(work, 'ud') },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.tree-item', { hasText: 'a.ts' })).toBeVisible({ timeout: 15_000 });

    // Terminal 탭 → 첫 터미널 지연 기동
    await page.locator('.panel-title button', { hasText: 'Terminal' }).click();
    await expect(page.locator('.terminal-tab')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });

    // 셸 프롬프트 대기 후 echo (마커로 확인 — DOM 렌더러라 텍스트 어서션 가능)
    await page.locator('.terminal-host >> visible=true').click();
    // 로그인 셸 프롬프트 출현 대기 (임의 sleep 대신 폴링 — 하니스 규칙)
    await expect
      .poll(async () => (await page.locator('.xterm').innerText()).trim().length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    await page.keyboard.type('echo SI_E2E_$((2+3))');
    await page.keyboard.press('Enter');
    await expect(page.locator('.xterm')).toContainText('SI_E2E_5', { timeout: 15_000 });

    // + 로 두 번째 터미널 → 탭 2개 + 전환
    await page.locator('.terminal-add').click();
    await expect(page.locator('.terminal-tab')).toHaveCount(2, { timeout: 15_000 });
    await page.locator('.terminal-tab').first().click();
    await expect(page.locator('.terminal-tab').first()).toHaveClass(/active/);
  } finally {
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
