import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Plan 20 / v3 S1·S2 E2E: React fetch → Flow 탭 → FastAPI 핸들러 점프.
// 흐름: web/app.ts 열기 → Relation "Flow" 탭 → GET /api/users/{} 호출 행 + 매칭 read_user
//       → 클릭 → server/main.py로 점프(활성 파일 전환). 역방향: main.py의 Flow에 loadUser.
test('Flow 탭: fetch → 엔드포인트 매칭 → 핸들러 점프 (S1·S2)', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-flow-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(path.join(proj, 'web'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'server'), { recursive: true });
  fs.writeFileSync(
    path.join(proj, 'web', 'app.ts'),
    'export async function loadUser(id: string) {\n  return fetch(`/api/users/${id}`);\n}\n',
  );
  fs.writeFileSync(
    path.join(proj, 'server', 'main.py'),
    '@app.get("/api/users/{user_id}")\ndef read_user(user_id: int):\n    return user_id\n',
  );

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: path.join(work, 'ud') },
  });
  try {
    const page = await app.firstWindow();

    // web/app.ts 열기 → 인덱싱 완료 대기(아웃라인 loadUser)
    await page.locator('.tree-item', { hasText: 'web' }).first().click();
    await page.locator('.tree-item', { hasText: 'app.ts' }).click();
    await expect(page.locator('.symbol-item', { hasText: 'loadUser' })).toBeVisible({ timeout: 30_000 });

    // Flow 탭 → 호출 행 + 매칭 핸들러 (S1 데이터가 화면에)
    await page.locator('.rel-tab', { hasText: 'Flow' }).click();
    await expect(page.locator('.flow-method', { hasText: 'GET' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.rel-label', { hasText: '/api/users/{}' })).toBeVisible();
    const target = page.locator('.flow-target', { hasText: 'read_user' });
    await expect(target).toBeVisible();

    // 핸들러 클릭 → server/main.py로 점프 (S1)
    await target.click();
    await expect(page.locator('.statusbar-path')).toHaveText(/server\/main\.py/, { timeout: 10_000 });

    // 역방향 (S2): main.py의 Flow에 엔드포인트 + loadUser 호출부
    await expect(page.locator('.rel-label', { hasText: '/api/users/{} (read_user)' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.flow-target', { hasText: 'loadUser' })).toBeVisible();
  } finally {
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
