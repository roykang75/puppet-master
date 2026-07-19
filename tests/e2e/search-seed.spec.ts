import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// 검색 선택 프리필: 에디터에서 단어를 더블클릭 선택한 뒤 Project 패널 돋보기 버튼으로
// 전체 검색을 열면, 선택 단어가 검색 입력에 자동 채워지고 결과가 뜬다 (VS Code 동일 UX).
// 키보드 meta 조합은 OS가 소비할 수 있어 돋보기 버튼 클릭으로 검증한다.
test('검색 시드: 단어 더블클릭 선택 → 돋보기 열기 → 검색어 프리필 + 결과', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-seed-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'util.c'), 'int helper_fn() {\n  return 42;\n}\n');
  fs.writeFileSync(
    path.join(proj, 'main.c'),
    '#include "util.h"\nint helper_fn();\nint main() {\n  return helper_fn();\n}\n',
  );

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: path.join(work, 'ud') },
  });
  try {
    const page = await app.firstWindow();

    // 인덱싱 완료 대기: util.c 열고 아웃라인 확인
    await page.locator('.tree-item', { hasText: 'util.c' }).click();
    await expect(page.locator('.symbol-item', { hasText: 'helper_fn' })).toBeVisible({ timeout: 30_000 });

    // 에디터에서 helper_fn 단어를 더블클릭으로 선택
    await page.locator('.editor-host .view-line span', { hasText: 'helper_fn' }).first().dblclick();

    // Project 패널 돋보기 버튼 클릭 → 전체 검색 열기
    await page.locator('.panel-action[title*="전체 검색"]').click();

    // 검색 입력에 선택 단어가 프리필되고 결과가 뜬다
    await expect(page.locator('.search-box input')).toHaveValue('helper_fn', { timeout: 10_000 });
    await expect(page.locator('.search-item', { hasText: 'helper_fn' }).first()).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
