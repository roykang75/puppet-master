import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Task 7: Smart Rename E2E.
// 흐름: main.c 열기 → 아웃라인 대기(인덱싱 완료) → helper_fn 텍스트 클릭(커서) → F2 →
//       RenameOverlay 표시 → 새 이름 입력 → 적용 → 요약(phase done) 확인 → 닫기 →
//       fs 단언(util.c/main.c 디스크에 helper_renamed) → 에디터 버퍼 갱신 → 아웃라인 갱신.
//
// 실제 컴포넌트(RenameOverlay.tsx)에 맞춘 셀렉터/조정:
//  (A) 오버레이 박스는 `.rename-box`, 입력은 `.rename-input`, 적용 버튼은 `.rename-btn.primary`
//      (텍스트 '적용'; done 후 같은 버튼이 '확인'으로 바뀌며 close 수행 — 텍스트로 구분).
//  (B) 완료 요약(phase==='done')은 `.rename-summary` ("N개 파일 M건 치환").
//  (C) F2는 Monaco addCommand(EditorPane.tsx). editor `.view-line span`(helper_fn) 클릭으로
//      포커스+커서 확보 후 page.keyboard.press('F2'). (Cmd+F2는 App-level 북마크라 순수 F2 사용.)
//  (D) 아웃라인 단언 조정: main.c의 프로토타입 `int helper_fn();`는 C 쿼리상 심볼이 아니라
//      (function_definition만 @def.function; declaration+function_declarator는 미포함),
//      main.c 아웃라인엔 `main`만 존재하고 helper_fn은 호출 ref로만 잡힌다. 따라서
//      "아웃라인에 helper_renamed"는 정의 파일 util.c를 열어 검증한다. 에디터 버퍼 갱신은
//      rename 당시 열려있던 활성 탭 main.c(호출부 line 4)에서 라이브 리로드로 검증한다.
test('Smart Rename: F2 → 오버레이 → 적용 → 디스크/버퍼/아웃라인 갱신', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-rn-'));
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

    // 1) main.c 열기 → 인덱싱 완료(아웃라인 채워짐) 대기
    await page.locator('.tree-item', { hasText: 'main.c' }).click();
    await expect(page.locator('.symbol-item', { hasText: 'main' })).toBeVisible({ timeout: 30_000 });

    // 2) helper_fn 텍스트(호출부) 위 커서 클릭 → 에디터 포커스
    await page.locator('.editor-host .view-line span', { hasText: 'helper_fn' }).last().click();

    // 3) F2 → RenameOverlay 표시 대기
    await page.keyboard.press('F2');
    await expect(page.locator('.rename-box')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.rename-title', { hasText: 'helper_fn' })).toBeVisible();

    // 4) 새 이름 입력 → 적용 버튼 클릭
    await page.locator('.rename-input').fill('helper_renamed');
    await page.locator('.rename-btn.primary', { hasText: '적용' }).click();

    // 5) 요약(phase done) 확인 — "N개 파일 M건 치환"
    await expect(page.locator('.rename-summary', { hasText: '치환' })).toBeVisible({ timeout: 15_000 });

    // 6) 닫기 (done 상태의 primary 버튼 = 확인)
    await page.locator('.rename-btn.primary', { hasText: '확인' }).click();
    await expect(page.locator('.rename-box')).toBeHidden();

    // 7) fs 단언: 두 파일 디스크 내용에 helper_renamed 존재
    expect(fs.readFileSync(path.join(proj, 'util.c'), 'utf8')).toContain('helper_renamed');
    expect(fs.readFileSync(path.join(proj, 'main.c'), 'utf8')).toContain('helper_renamed');

    // 8) 에디터 버퍼 갱신: 활성 탭 main.c(호출부)가 디스크 리로드로 helper_renamed 표시
    await expect(page.locator('.editor-host')).toContainText('helper_renamed', { timeout: 15_000 });

    // 9) 아웃라인 갱신: 정의 파일 util.c를 열어 helper_renamed 심볼 확인 (조정 D)
    await page.locator('.tree-item', { hasText: 'util.c' }).click();
    await expect(page.locator('.editor-host')).toContainText('helper_renamed', { timeout: 15_000 });
    await expect(page.locator('.symbol-item', { hasText: 'helper_renamed' })).toBeVisible({ timeout: 15_000 });
  } finally {
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
