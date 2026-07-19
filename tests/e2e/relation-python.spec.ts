import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// 사용자 리포트 재현(계측판): 파이썬 프로젝트에서 Relation이 비는 문제.
// 콘솔/페이지 에러를 수집하고 단계별 상태를 로그로 남긴다.
test('Relation(py): 커서 → resolve → Callers 표시', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-relpy-'));
  const proj = path.join(work, 'proj');
  const ud = path.join(work, 'ud');
  fs.mkdirSync(path.join(proj, 'backend'), { recursive: true });
  fs.writeFileSync(
    path.join(proj, 'backend', 'db.py'),
    'def get_models():\n    return []\n\ndef init_db():\n    get_models()\n',
  );
  fs.writeFileSync(
    path.join(proj, 'backend', 'admin_routes.py'),
    'from db import get_models\n\ndef admin_list():\n    return get_models()\n',
  );

  const app = await electron.launch({ args: ['.'], env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: ud } });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  try {
    // 인덱싱 완료 대기 (statusbar "심볼 N")
    await expect(page.locator('.statusbar')).toContainText('심볼', { timeout: 30_000 });

    await page.locator('.tree-item', { hasText: 'backend' }).first().click();
    const dbItem = page.locator('.tree-item', { hasText: 'db.py' }).first();
    await expect(dbItem).toBeVisible({ timeout: 10_000 });
    await dbItem.click();
    console.log('[step] db.py 클릭 완료');

    // 탭이 실제로 열렸는가?
    const tabVisible = await page.locator('.tab, .file-tab, [class*="tab"]', { hasText: 'db.py' }).first()
      .isVisible({ timeout: 5_000 } as never).catch(() => false);
    console.log(`[step] db.py 탭 표시: ${tabVisible}`);

    const symVisible = await page.locator('.symbol-item', { hasText: 'get_models' })
      .isVisible().catch(() => false);
    console.log(`[step] 아웃라인 get_models: ${symVisible}`);
    if (!symVisible) {
      await page.waitForTimeout(3_000);
      console.log(`[step] 3초 후 아웃라인: ${await page.locator('.symbol-item').count()}개, 탭영역 텍스트: ${JSON.stringify(await page.locator('.tabs, .file-tabs, [class*="tabs"]').first().textContent().catch(() => '(없음)'))}`);
    }

    // 에디터에서 get_models 클릭 → Relation
    await page.locator('.editor-host .view-line span', { hasText: 'get_models' }).first().click({ timeout: 10_000 });
    console.log('[step] 에디터 클릭 완료');
    await page.waitForTimeout(2_000);
    console.log(`[step] Relation 타이틀: ${JSON.stringify(await page.locator('.panel-title', { hasText: 'Relation' }).first().textContent())}`);
    console.log(`[step] rel-item 수: ${await page.locator('.rel-item').count()}`);

    await expect(page.locator('.panel-title', { hasText: 'Relation — get_models' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.rel-label', { hasText: 'admin_list' })).toBeVisible({ timeout: 10_000 });
  } finally {
    console.log('[errors]', errors.length ? errors.join('\n') : '(콘솔/페이지 에러 없음)');
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
