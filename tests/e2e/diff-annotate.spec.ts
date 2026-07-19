import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

// agent.spec.ts의 fake 서버 흐름을 차용 — 에이전트가 파일을 만들면 diff 탭에서 줄 주석을 달고
// 채팅으로 피드백을 프리필하는 경로(Orca "Annotate AI Diffs" 차용)를 검증한다.
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

test('에이전트 diff 줄 주석 → 채팅 피드백 프리필', async () => {
  const { server, baseURL } = await startFakeServer();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-diffann-'));
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
    await page.locator('.chat-mode').selectOption('agent');
    const input = page.locator('.chat-input-row textarea');
    await input.fill('구구단 앱을 파이썬으로 만들어줘');
    await input.press('Enter');
    // 변경 완료 → '변경된 파일' 칩 클릭으로 에이전트 diff 탭 열기
    await expect(page.locator('.tool-card.tool-done')).toBeVisible({ timeout: 15_000 });
    await page.locator('.changed-file-chip', { hasText: 'gugudan.py' }).click();
    // origin==='agent' → 주석 바 표시 (파일 비교 diff는 미표시)
    await expect(page.locator('.diff-annotate-bar')).toBeVisible({ timeout: 10_000 });
    // 오른쪽(modified) 에디터의 한 줄 클릭 → 현재 줄 추적
    await page.locator('.diff-tab-host .view-line span', { hasText: 'range' }).first().click();
    // 코멘트 입력 + 추가 → 주석 항목 생성
    await page.locator('.diff-annotate-input').fill('범위를 2단만 출력하도록');
    await page.locator('.diff-annotate-input-row .rename-btn', { hasText: '추가' }).click();
    await expect(page.locator('.diff-annotate-item')).toHaveCount(1);
    // 채팅으로 보내기 → rightTab이 chat으로 전환 + textarea에 피드백 프리필
    await page.locator('.diff-annotate-send').click();
    const textarea = page.locator('.chat-input-row textarea');
    await expect(textarea).toBeVisible({ timeout: 10_000 });
    await expect(textarea).toHaveValue(/변경 제안 피드백/);
    await expect(textarea).toHaveValue(/gugudan\.py/);
    await expect(textarea).toHaveValue(/범위를 2단만 출력하도록/);
  } finally {
    await app.close();
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
