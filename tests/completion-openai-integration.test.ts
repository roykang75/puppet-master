import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import { AddressInfo } from 'net';
import { OpenAIAdapter } from '../src/main/completion/openai-adapter';
import type { BuiltContext } from '../src/main/completion/prompt';

// 로컬 LLM(OpenAI 호환 /v1) baseURL 경로를 실왕복으로 실증한다.
let server: http.Server;
let baseURL: string;
let lastBody: any = null;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        lastBody = JSON.parse(raw);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'cmpl-1',
            object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: 'return 42;' }, finish_reason: 'stop' }],
          }),
        );
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseURL = `http://127.0.0.1:${port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

function ctx(): BuiltContext {
  return {
    path: 'src/x.ts',
    languageId: 'typescript',
    prefix: 'function f() {\n  ',
    suffix: '\n}',
    symbolSignatures: [],
  };
}

describe('OpenAIAdapter 로컬 baseURL 통합', () => {
  it('가짜 OpenAI 호환 서버와 실왕복하여 완성 텍스트를 반환한다', async () => {
    const adapter = new OpenAIAdapter({ model: 'test-model', baseURL });
    const out = await adapter.complete(ctx());
    expect(out).toBe('return 42;');
    // 서버가 실제로 model/messages를 받았는지 확인
    expect(lastBody.model).toBe('test-model');
    expect(Array.isArray(lastBody.messages)).toBe(true);
    expect(lastBody.messages[0].role).toBe('system');
    expect(lastBody.max_tokens).toBe(160);
  });
});
