import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import { OpenAIChatAdapter } from '../src/main/chat/adapters';

// 실제 openai SDK 클라이언트 경로를 로컬 fake SSE 서버로 실왕복한다.
let server: http.Server;
let baseURL: string;
let lastBody: any = null;
let abortObserved = false;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      lastBody = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunks = ['안녕', '하세요', '!'];
      let i = 0;
      // 청크 간격을 넉넉히 두어, abort 테스트에서 첫 청크 이후 연결 종료가
      // 다음 청크 전송보다 확실히 먼저 일어나도록 한다(결정적).
      const timer = setInterval(() => {
        if (i < chunks.length) {
          res.write(
            `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: chunks[i] }, finish_reason: null }] })}\n\n`,
          );
          i++;
        } else {
          res.write('data: [DONE]\n\n');
          res.end();
          clearInterval(timer);
        }
      }, 60);
      // 클라이언트가 스트림 완료 전 연결을 끊으면(abort) res 'close'가
      // writableEnded=false 상태로 발생한다 — 서버 측에서 결정적으로 abort 관측.
      // (IncomingMessage의 'close'는 요청 본문 소비 직후 발생하므로 abort 신호로 부적합.)
      res.on('close', () => {
        if (!res.writableEnded) abortObserved = true;
        clearInterval(timer);
      });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  baseURL = `http://127.0.0.1:${addr.port}/v1`;
});

afterAll(() => server.close());

describe('OpenAIChatAdapter 실왕복 (fake SSE 서버)', () => {
  it('스트리밍 청크 순서대로 수신 + system 선두 + max_tokens', async () => {
    abortObserved = false;
    const adapter = new OpenAIChatAdapter({ model: 'fake-model', apiKey: 'k', baseURL });
    const chunks: string[] = [];
    await adapter.chatStream(
      [{ role: 'user', content: '안녕' }],
      null,
      (t) => chunks.push(t),
      new AbortController().signal,
    );
    expect(chunks).toEqual(['안녕', '하세요', '!']);
    expect(lastBody.stream).toBe(true);
    expect(lastBody.messages[0].role).toBe('system');
    expect(lastBody.max_tokens).toBe(2048);
    expect(abortObserved).toBe(false);
  });

  it('abort 시 스트림 중단 (연결 종료 관측)', async () => {
    abortObserved = false;
    const adapter = new OpenAIChatAdapter({ model: 'fake-model', apiKey: 'k', baseURL });
    const ac = new AbortController();
    const chunks: string[] = [];
    // openai SDK v6는 스트림 순회 중 signal.abort() 시 예외를 던지지 않고
    // 이터레이터를 조용히 종료한다. 따라서 예외 여부가 아니라
    // "수신 청크 수 < 전체" + "서버가 연결 종료를 관측"으로 중단을 검증한다.
    await adapter.chatStream(
      [{ role: 'user', content: 'q' }],
      null,
      (t) => {
        chunks.push(t);
        if (chunks.length === 1) ac.abort(); // 첫 청크에서 중단
      },
      ac.signal,
    );
    // 연결 종료(res 'close')가 이벤트 루프에 반영될 시간을 확보한다.
    await new Promise((r) => setTimeout(r, 150));
    expect(abortObserved).toBe(true);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.length).toBeLessThan(3);
  }, 10_000);
});
