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
      for (const t of ['테스트', ' 응답', '입니다']) {
        res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: t }, finish_reason: null }] })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, baseURL: `http://127.0.0.1:${addr.port}/v1` });
    }),
  );
}

test('AI 채팅: 질문 → 스트리밍 응답 → 새 대화 리셋', async () => {
  const { server, baseURL } = await startFakeServer();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-chat-'));
  const proj = path.join(work, 'proj');
  const ud = path.join(work, 'ud');
  fs.mkdirSync(proj);
  fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(proj, 'a.ts'), 'const x = 1;\n');
  fs.writeFileSync(
    path.join(ud, 'settings.json'),
    JSON.stringify({ completion: { provider: 'openai', model: 'fake', baseURL, apiKey: 'k' } }),
  );

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: ud },
  });
  try {
    const page = await app.firstWindow();
    const item = page.locator('.tree-item', { hasText: 'a.ts' });
    await expect(item).toBeVisible({ timeout: 15_000 });
    await item.click();

    // AI 채팅 탭 전환 → 질문 전송
    await page.locator('.right-tabs button', { hasText: 'AI 채팅' }).click();
    const input = page.locator('.chat-input-row textarea');
    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.fill('x가 뭐야?');
    await input.press('Enter');

    // 스트리밍 응답 렌더 확인
    await expect(page.locator('.chat-assistant')).toContainText('테스트 응답입니다', { timeout: 15_000 });
    await expect(page.locator('.chat-user')).toContainText('x가 뭐야?');

    // 새 대화 → 리셋 (헤더 개편으로 .chat-toolbar → .chat-thread-actions, 버튼은 title로 특정)
    await page.locator('.chat-thread-actions button[title="새 대화"]').click();
    await expect(page.locator('.chat-msg')).toHaveCount(0);
  } finally {
    await app.close();
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
