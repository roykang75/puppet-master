import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// 확장자 없는 Jenkinsfile(groovy)이 실제로 구문 강조되는지 실증.
// monaco-setup의 언어 등록(filenames: Jenkinsfile→'groovy') + registry의 TextMate(source.groovy) 지연 등록이
// 함께 걸려야 성립한다. plaintext면 모든 토큰이 단일 mtk 클래스라 서로 다른 mtk가 2종 이상 나올 수 없다 —
// 따라서 "distinct mtk ≥ 2"가 languageId=groovy + TextMate 색칠의 결정적 증거.
test('Jenkinsfile(groovy) 구문 강조 — 파일명 연결 + TextMate 색칠', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-groovy-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(proj);
  fs.writeFileSync(
    path.join(proj, 'Jenkinsfile'),
    "// Jenkins 파이프라인\npipeline {\n  agent any\n  stages {\n    stage('build') { steps { echo 'hi' } }\n  }\n}\n",
  );

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: path.join(work, 'ud') },
  });
  try {
    const page = await app.firstWindow();
    const item = page.locator('.tree-item', { hasText: 'Jenkinsfile' });
    await expect(item).toBeVisible({ timeout: 15_000 });
    await item.click();
    await expect(page.locator('.editor-host')).toContainText('pipeline', { timeout: 15_000 });

    // TextMate 색칠 실증: view-line 스팬의 서로 다른 mtk 클래스가 2종 이상 (지연 등록 완료까지 폴링)
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const classes = new Set<string>();
            document.querySelectorAll('.editor-host .view-line span[class*="mtk"]').forEach((el) => {
              el.classList.forEach((c) => {
                if (/^mtk/.test(c)) classes.add(c);
              });
            });
            return classes.size;
          }),
        { timeout: 15_000 },
      )
      .toBeGreaterThanOrEqual(2);
  } finally {
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
