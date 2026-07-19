import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// 사용자 실제 시나리오: 앱 재시작 → uiState로 복원된 탭(db.py)에서 커서 → Relation.
// (신규 열기 경로는 relation-python.spec에서 통과 확인됨 — 복원 경로만 격리 검증)
test('Relation(py): 재시작 탭 복원 후 커서 → Callers', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-relpyR-'));
  const proj = path.join(work, 'proj');
  const ud = path.join(work, 'ud');
  fs.mkdirSync(path.join(proj, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'backend', 'db.py'), 'def get_models():\n    return []\n');
  fs.writeFileSync(path.join(proj, 'backend', 'admin_routes.py'), 'from db import get_models\n\ndef admin_list():\n    return get_models()\n');
  const launch = () => electron.launch({ args: ['.'], env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: ud } });

  // 1차: db.py 열어 uiState에 남기고 종료
  let app = await launch();
  let page = await app.firstWindow();
  await expect(page.locator('.statusbar')).toContainText('심볼', { timeout: 30_000 });
  await page.locator('.tree-item', { hasText: 'backend' }).first().click();
  await page.locator('.tree-item', { hasText: 'db.py' }).first().click();
  await expect(page.locator('.symbol-item', { hasText: 'get_models' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(800); // uiState 디바운스 저장(500ms) 보장
  await app.close();

  // 2차: 재시작 — 복원된 탭에서 바로 커서
  app = await launch();
  page = await app.firstWindow();
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await expect(page.locator('.symbol-item', { hasText: 'get_models' })).toBeVisible({ timeout: 30_000 });
    console.log('[step] 복원된 탭 아웃라인 확인');
    await page.locator('.editor-host .view-line span', { hasText: 'get_models' }).first().click({ timeout: 10_000 });
    await page.waitForTimeout(2_000);
    console.log(`[step] Relation 타이틀: ${JSON.stringify(await page.locator('.panel-title', { hasText: 'Relation' }).first().textContent())}`);
    console.log(`[step] rel-item 수: ${await page.locator('.rel-item').count()}`);
    await expect(page.locator('.panel-title', { hasText: 'Relation — get_models' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.rel-label', { hasText: 'admin_list' })).toBeVisible({ timeout: 10_000 });
  } finally {
    console.log('[errors]', errors.length ? errors.join('\n') : '(없음)');
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
