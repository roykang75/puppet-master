import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

test('열기 → 트리 → 편집 → 저장 → 아웃라인 갱신', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'main.c'), 'int main() {\n  return 0;\n}\n');

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: path.join(work, 'ud') },
  });
  const page = await app.firstWindow();

  // 파일 트리 → 열기
  const item = page.locator('.tree-item', { hasText: 'main.c' });
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.click();
  await expect(page.locator('.editor-host')).toContainText('return 0', { timeout: 15_000 });

  // 인덱싱 완료 → 아웃라인
  await expect(page.locator('.symbol-item', { hasText: 'main' })).toBeVisible({ timeout: 30_000 });

  // 편집: 문서 맨 앞에 전역 변수 선언 (괄호/따옴표 없는 텍스트 — 자동닫기 간섭 회피)
  await page.locator('.editor-host').click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type('int global_marker;\n');
  await expect(page.locator('.tab.active .dirty-dot')).toBeVisible();

  // 저장 (Monaco addCommand가 si:save 디스패치)
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.tab.active .dirty-dot')).toBeHidden({ timeout: 10_000 });
  expect(fs.readFileSync(path.join(proj, 'main.c'), 'utf8')).toContain('global_marker');

  // 재인덱싱 → 아웃라인 갱신
  await expect(page.locator('.symbol-item', { hasText: 'global_marker' })).toBeVisible({ timeout: 15_000 });

  await app.close();
  fs.rmSync(work, { recursive: true, force: true });
});
