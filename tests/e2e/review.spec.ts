import { test, expect, _electron as electron } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Plan 22: 변경 리뷰 센터 E2E 스모크.
// git repo(커밋된 util.ts) + 워킹트리 수정(foo 본문 변경 + bar 추가) → 메뉴 "변경 리뷰" →
// 리뷰 탭에 util.ts(M) 표시 → 펼치면 심볼(foo 수정 / bar 추가) 표시.
test('변경 리뷰: 메뉴 → 리뷰 탭 → 파일/심볼 목록', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-review-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  const git = (args: string[]) => execFileSync('git', ['-C', proj, ...args], { stdio: 'pipe' });
  git(['init', '-q']);
  git(['config', 'user.email', 't@t.dev']);
  git(['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(proj, 'util.ts'), 'export function foo() {\n  return 1;\n}\n');
  git(['add', '.']);
  git(['commit', '-qm', 'init']);
  // 워킹트리 변경(베이스라인=HEAD 대비) — foo 수정 + bar 추가
  fs.writeFileSync(path.join(proj, 'util.ts'), 'export function foo() {\n  return 999;\n}\nexport function bar() {\n  return 2;\n}\n');

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: path.join(work, 'ud') },
  });
  try {
    const page = await app.firstWindow();
    // 인덱싱/로드 대기 — 파일 트리 표시 확인
    await expect(page.locator('.tree-item', { hasText: 'util.ts' })).toBeVisible({ timeout: 30_000 });

    // 앱 메뉴의 "변경 리뷰…" 항목을 메인 프로세스에서 프로그램적으로 클릭 (네이티브 메뉴 UI 우회)
    await app.evaluate(({ Menu }) => {
      const find = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
        for (const it of items) {
          if (it.label === '변경 리뷰…') return it;
          if (it.submenu) {
            const r = find(it.submenu.items);
            if (r) return r;
          }
        }
        return null;
      };
      const item = find(Menu.getApplicationMenu()!.items);
      item?.click();
    });

    // 리뷰 탭 + 파일 행(util.ts, M)
    await expect(page.locator('.review')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.review-file-row', { hasText: 'util.ts' })).toBeVisible({ timeout: 10_000 });

    // 펼치기 → 심볼 행(foo/bar)
    await page.locator('.review-file-row .review-caret').first().click();
    await expect(page.locator('.review-symbol-name', { hasText: 'foo' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.review-symbol-name', { hasText: 'bar' })).toBeVisible();
  } finally {
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
