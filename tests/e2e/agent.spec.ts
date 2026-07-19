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
      const body = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      if (!body.messages.some((m: { role: string }) => m.role === 'tool')) {
        send({ choices: [{ delta: { content: '구구단 파일을 만들게요. ' } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'gugudan.py', content: 'for i in range(1,10):\n    print(2*i)\n' }) } }] } }] });
        send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
      } else {
        send({ choices: [{ delta: { content: 'gugudan.py 생성 완료' } }] });
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

test('에이전트 모드: 요청 → write_file 실행 → 디스크 생성 + 카드 + 트리 반영', async () => {
  const { server, baseURL } = await startFakeServer();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-agent-'));
  const proj = path.join(work, 'proj');
  const ud = path.join(work, 'ud');
  fs.mkdirSync(proj);
  fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(proj, 'a.ts'), 'const x = 1;\n');
  fs.writeFileSync(
    path.join(ud, 'settings.json'),
    JSON.stringify({ profiles: [{ id: 'p1', name: 'fake', provider: 'openai', model: 'fake', baseURL, apiKey: 'k' }], activeProfileId: 'p1' }),
  );
  const app = await electron.launch({ args: ['.'], env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: ud } });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.tree-item', { hasText: 'a.ts' })).toBeVisible({ timeout: 15_000 });
    await page.locator('.right-tabs button', { hasText: 'AI 채팅' }).click();
    // 에이전트 모드 켜기 (모드 선택 드롭다운 — 세션 UI 개선으로 토글→select 변경됨)
    await page.locator('.chat-mode').selectOption('agent');
    const input = page.locator('.chat-input-row textarea');
    await input.fill('구구단 앱을 파이썬으로 만들어줘');
    await input.press('Enter');
    // 도구 카드 → 완료
    await expect(page.locator('.tool-card', { hasText: 'gugudan.py' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.tool-card.tool-done')).toBeVisible({ timeout: 15_000 });
    // 텍스트 응답 + 디스크 실존 + 트리 반영
    await expect(page.locator('.chat-assistant')).toContainText('생성 완료', { timeout: 15_000 });
    await expect
      .poll(() => fs.existsSync(path.join(proj, 'gugudan.py')), { timeout: 10_000 })
      .toBe(true);
    expect(fs.readFileSync(path.join(proj, 'gugudan.py'), 'utf8')).toContain('for i in range');
    await expect(page.locator('.tree-item', { hasText: 'gugudan.py' })).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close();
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
