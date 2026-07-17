import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// 정의 이동 트리거: F12는 Playwright 합성 키가 Monaco addCommand로 라우팅되지 않아
// (Electron+Monaco 자동화 환경 한계) 앱이 제공하는 동일 경로의 Ctrl/Cmd+클릭으로 검증한다.
// 두 트리거 모두 tryLspDefinition → jumpTo 동일 로직을 탄다 (EditorPane.tsx 참조).
const DEF_MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

test('LSP: 타입 인지 완성 드롭다운 + Ctrl/Cmd+클릭 정의 이동', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-lsp-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'lib.ts'), 'export function greet(name: string): string {\n  return name.toUpperCase();\n}\n');
  fs.writeFileSync(path.join(proj, 'use.ts'), "import { greet } from './lib';\nconst s = greet('hi');\n");

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: path.join(work, 'ud') },
  });
  try {
    const page = await app.firstWindow();
    const useItem = page.locator('.tree-item', { hasText: 'use.ts' });
    await expect(useItem).toBeVisible({ timeout: 15_000 });
    await useItem.click();
    await expect(page.locator('.editor-host')).toContainText('greet', { timeout: 15_000 });

    // 파일 끝에 s. 타이핑 → LSP 완성 드롭다운 (타입 인지: s는 string이라 문자열 메서드가 뜬다)
    await page.locator('.editor-host').click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('s.');
    const widget = page.locator('.suggest-widget.visible');
    await expect(widget).toBeVisible({ timeout: 30_000 }); // 서버 웜업 여유
    // toUpperCase는 긴 문자열 메서드 목록에서 가상 스크롤로 DOM에 없을 수 있어, 필터링해 렌더를 강제
    await page.keyboard.type('toUpper');
    await expect(widget).toContainText('toUpperCase', { timeout: 10_000 });
    await page.keyboard.press('Escape');

    // 타이핑 원복 (s.toUpper 9자 제거 — 버퍼를 청정 상태로)
    for (let i = 0; i < 9; i++) await page.keyboard.press('Backspace');
    await page.keyboard.press('Escape'); // 잔여 완성 위젯이 이후 입력을 가로채지 않도록 정리

    // 2행 "const s = greet('hi');"의 greet 위로 Ctrl/Cmd+클릭 → lib.ts로 정의 이동
    const box = await page.evaluate(() => {
      const lines = document.querySelectorAll('.editor-host .view-line');
      const line2 = lines[1];
      if (!line2) return null;
      const walker = document.createTreeWalker(line2, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const t = node.textContent || '';
        const idx = t.indexOf('greet');
        if (idx >= 0) {
          const range = document.createRange();
          range.setStart(node, idx + 2);
          range.setEnd(node, idx + 3);
          const r = range.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
      return null;
    });
    expect(box, 'greet 단어 위치를 찾지 못함').not.toBeNull();
    await page.keyboard.down(DEF_MODIFIER);
    await page.mouse.click(box!.x, box!.y);
    await page.keyboard.up(DEF_MODIFIER);
    await expect(page.locator('.tab.active')).toContainText('lib.ts', { timeout: 15_000 });
  } finally {
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
