import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

function startFakeServer(): Promise<{ server: http.Server; baseURL: string }> {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const t of ['응답', ' 완료'])
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, baseURL: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` })),
  );
}

test('채팅 스레드: 저장 → 새 스레드 → 재시작 복원', async () => {
  const { server, baseURL } = await startFakeServer();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-thread-'));
  const proj = path.join(work, 'proj');
  const ud = path.join(work, 'ud');
  fs.mkdirSync(proj);
  fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(proj, 'a.ts'), 'const x = 1;\n');
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ profiles: [{ id: 'p1', name: 'f', provider: 'openai', model: 'f', baseURL, apiKey: 'k' }], activeProfileId: 'p1' }));
  const env = { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: ud };

  // 1회차: 메시지 전송 → 스레드 자동 생성·제목
  let app = await electron.launch({ args: ['.'], env });
  let page = await app.firstWindow();
  await expect(page.locator('.tree-item', { hasText: 'a.ts' })).toBeVisible({ timeout: 15_000 });
  await page.locator('.right-tabs button', { hasText: 'AI 채팅' }).click();
  const input = page.locator('.chat-input-row textarea');
  await input.fill('첫 질문입니다');
  await input.press('Enter');
  await expect(page.locator('.chat-assistant')).toContainText('응답 완료', { timeout: 15_000 });
  await expect(page.locator('.chat-thread-title')).toContainText('첫 질문입니다');
  await page.waitForTimeout(600); // 저장 디바운스
  await app.close();

  // 2회차: 재시작 → 이전 대화 복원
  app = await electron.launch({ args: ['.'], env });
  page = await app.firstWindow();
  await expect(page.locator('.tree-item', { hasText: 'a.ts' })).toBeVisible({ timeout: 15_000 });
  await page.locator('.right-tabs button', { hasText: 'AI 채팅' }).click();
  try {
    await expect(page.locator('.chat-user')).toContainText('첫 질문입니다', { timeout: 10_000 });
    await expect(page.locator('.chat-assistant')).toContainText('응답 완료');
    await expect(page.locator('.chat-thread-title')).toContainText('첫 질문입니다');
    // 대화 기록 드롭다운에 1개
    await page.locator('.chat-thread-actions button[title="대화 기록"]').click();
    await expect(page.locator('.chat-thread-menu .open-editors-item')).toHaveCount(1);
  } finally {
    await app.close();
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
