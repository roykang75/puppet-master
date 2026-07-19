import { test, expect, _electron as electron } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

// 격리(worktree) 모드 E2E — 에이전트가 gugudan.py를 wt에 생성 → 원본엔 없음 + 적용 바 →
//   [적용] → 원본에 생성 + 트리 반영. (Orca "Parallel Worktrees" 차용 2탄, v1)
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

test('격리 모드: wt에 생성 → 원본 없음 + 적용 바 → [적용] → 원본 반영', async () => {
  const { server, baseURL } = await startFakeServer();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-iso-'));
  const proj = path.join(work, 'proj');
  const ud = path.join(work, 'ud');
  fs.mkdirSync(proj);
  fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(proj, 'a.ts'), 'const x = 1;\n');
  // git 저장소 초기화 (격리 모드는 git에서만 동작)
  const git = (args: string[]) => execFileSync('git', ['-C', proj, ...args], { stdio: 'pipe' });
  git(['init', '-q']);
  git(['config', 'user.email', 't@t.dev']);
  git(['config', 'user.name', 'T']);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);
  // 격리 on 시딩 (agent.isolate)
  fs.writeFileSync(
    path.join(ud, 'settings.json'),
    JSON.stringify({
      profiles: [{ id: 'p1', name: 'fake', provider: 'openai', model: 'fake', baseURL, apiKey: 'k' }],
      activeProfileId: 'p1',
      agent: { allowedDirs: [], isolate: true },
    }),
  );
  const app = await electron.launch({ args: ['.'], env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: ud } });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.tree-item', { hasText: 'a.ts' })).toBeVisible({ timeout: 15_000 });
    await page.locator('.right-tabs button', { hasText: 'AI 채팅' }).click();
    await page.locator('.chat-mode').selectOption('agent');
    // 격리 체크박스가 시딩값(true)으로 켜져 있어야 함
    await expect(page.locator('.chat-context-toggle', { hasText: '격리' }).locator('input')).toBeChecked();
    const input = page.locator('.chat-input-row textarea');
    await input.fill('구구단 앱을 파이썬으로 만들어줘');
    await input.press('Enter');
    // 도구 카드 완료
    await expect(page.locator('.tool-card', { hasText: 'gugudan.py' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.chat-assistant')).toContainText('생성 완료', { timeout: 15_000 });
    // 적용 바 표시 + 원본엔 아직 파일 없음 (wt에만 존재)
    await expect(page.locator('.worktree-bar')).toContainText('격리된 변경', { timeout: 15_000 });
    expect(fs.existsSync(path.join(proj, 'gugudan.py'))).toBe(false);
    // [적용] → 원본 반영 + 트리 표시
    await page.locator('.worktree-bar .rename-btn.primary', { hasText: '적용' }).click();
    await expect
      .poll(() => fs.existsSync(path.join(proj, 'gugudan.py')), { timeout: 10_000 })
      .toBe(true);
    expect(fs.readFileSync(path.join(proj, 'gugudan.py'), 'utf8')).toContain('for i in range');
    await expect(page.locator('.tree-item', { hasText: 'gugudan.py' })).toBeVisible({ timeout: 10_000 });
    // 바는 사라짐
    await expect(page.locator('.worktree-bar')).toHaveCount(0);
  } finally {
    await app.close();
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
