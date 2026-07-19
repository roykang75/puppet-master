import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Task 4~8 통합 게이트: 검색 점프 → 뒤로 복귀 → Context 정의 → Relation Callers → 북마크.
// 브리프 spec은 Task 4~8 착지 전에 작성됨 — 실제 컴포넌트 동작에 맞춰 아래처럼 조정함:
//  (A) 검색 점프: 브리프는 Enter로 첫 항목 선택. 그러나 'helper' 심볼 검색은 util.c 정의 외에
//      main.c의 프로토타입 선언이 함께 잡혀 정렬 순서가 불확정 → Enter가 어느 파일로 튈지
//      보장 불가. util.c 정의 심볼 행(label=helper_fn ∧ detail⊃util.c)을 직접 더블클릭해
//      "검색 → util.c 점프"를 결정적으로 검증한다 (더블클릭 픽업도 Enter와 동일 pick() 경로).
//      단일 클릭은 이제 점프하지 않고 미리보기만 띄우므로 반드시 더블클릭이어야 한다.
//  (B) 뒤로 복귀: 브리프는 Alt+ArrowLeft. Electron/OS가 소비할 수 있어 툴바 ◀(.nav-btn 첫 번째)
//      클릭으로 대체 (goBack 직접 호출, 브리프 66행 지침 그대로).
//  (C) Relation 탭 라벨은 실제로 'Callers' (RelationPanel 151행). 기본 탭이 이미 'callers'라
//      클릭은 무해한 명시 동작으로 유지.
//  (D) 북마크 단언: 브리프의 맨몸 `.rel-detail⊃main.c`는 Relation의 caller 상세(main.c:N)와도
//      매칭돼 북마크를 실제로 검증하지 못함 → Bookmarks 패널(.panel⊃panel-title:Bookmarks)로
//      스코프를 좁혀 그 안의 .rel-item⊃main.c를 단언한다.
test('분석 흐름: 검색 점프 → 뒤로 → Context → Relation Callers → 북마크', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-an-'));
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

    // 인덱싱 완료 대기: main.c 열고 아웃라인 확인 (indexDone 이후에만 아웃라인 채워짐)
    await page.locator('.tree-item', { hasText: 'main.c' }).click();
    await expect(page.locator('.symbol-item', { hasText: 'main' })).toBeVisible({ timeout: 30_000 });

    // 1) 검색 오버레이 → helper 심볼 → util.c 정의 클릭 → util.c 활성 (조정 A)
    await page.keyboard.press('ControlOrMeta+Shift+f');
    await page.locator('.search-box input').fill('helper');
    await expect(page.locator('.search-item', { hasText: 'helper_fn' }).first()).toBeVisible({
      timeout: 10_000,
    });
    await page.locator('.search-item', { hasText: 'helper_fn' }).filter({ hasText: 'util.c' }).first().dblclick();
    await expect(page.locator('.tab.active', { hasText: 'util.c' })).toBeVisible({ timeout: 10_000 });

    // 2) main.c로 복귀 — 툴바 뒤로 버튼 (조정 B)
    await page.locator('.nav-btn').first().click();
    await expect(page.locator('.tab.active', { hasText: 'main.c' })).toBeVisible({ timeout: 10_000 });

    // 3) 커서를 helper_fn 호출 위에 → Context에 정의 표시 (150ms 디바운스 후 resolve)
    await page.locator('.editor-host .view-line span', { hasText: 'helper_fn' }).last().click();
    await expect(page.locator('.context-header', { hasText: 'helper_fn' })).toBeVisible({ timeout: 15_000 });

    // 4) Relation Callers 탭 — helper_fn의 caller에 main (조정 C)
    await page.locator('.rel-tab', { hasText: 'Callers' }).click();
    await expect(page.locator('.rel-item', { hasText: 'main' }).first()).toBeVisible({ timeout: 15_000 });

    // 5) 북마크 토글 → Bookmarks 패널에 main.c 표시 (조정 D)
    await page.keyboard.press('ControlOrMeta+F2');
    const bmPanel = page.locator('.panel', {
      has: page.locator('.panel-title', { hasText: 'Bookmarks' }),
    });
    await expect(bmPanel.locator('.rel-item', { hasText: 'main.c' })).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
