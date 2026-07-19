import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// 검색 결과 미리보기 + 더블클릭 이동:
//  - 단일 클릭(또는 ↑/↓) → 오버레이 하단 .search-preview에 대상 위치 미리보기 표시, 이동하지 않음.
//  - 더블클릭(또는 Enter) → 해당 위치로 점프 + 오버레이 닫힘.
test('검색 미리보기: 클릭 → 미리보기(이동 없음) → 더블클릭 → 이동+닫힘', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-prev-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(proj);
  // util.c에 고유 마커 주석 — 텍스트 검색이 단일 결정적 매치가 되도록
  fs.writeFileSync(
    path.join(proj, 'util.c'),
    'int helper_fn() {\n  // MARKERZED preview target line\n  return 42;\n}\n',
  );
  fs.writeFileSync(path.join(proj, 'main.c'), 'int main() {\n  return 0;\n}\n');

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: path.join(work, 'ud') },
  });
  try {
    const page = await app.firstWindow();

    // main.c를 먼저 열어 활성 탭으로 두고 인덱싱 완료를 대기 (텍스트 검색은 인덱스 필요)
    await page.locator('.tree-item', { hasText: 'main.c' }).click();
    await expect(page.locator('.symbol-item', { hasText: 'main' })).toBeVisible({ timeout: 30_000 });

    // 전체 검색 → 고유 마커 텍스트
    await page.keyboard.press('ControlOrMeta+Shift+f');
    await page.locator('.search-box input').fill('MARKERZED');
    const item = page.locator('.search-item', { hasText: 'MARKERZED' }).first();
    await expect(item).toBeVisible({ timeout: 10_000 });

    // 단일 클릭 → 미리보기에 대상 줄 텍스트 표시, 이동하지 않음(active 탭 여전히 main.c)
    await item.click();
    const preview = page.locator('.search-preview');
    await expect(preview).toBeVisible({ timeout: 10_000 });
    await expect(preview).toContainText('MARKERZED');
    await expect(page.locator('.search-preview-head')).toContainText('util.c:2');
    await expect(page.locator('.tab.active', { hasText: 'main.c' })).toBeVisible();

    // 더블클릭 → util.c로 이동 + 오버레이 닫힘
    await item.dblclick();
    await expect(page.locator('.tab.active', { hasText: 'util.c' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.search-box')).toHaveCount(0);
  } finally {
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
