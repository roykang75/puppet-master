import { describe, it, expect } from 'vitest';
import * as http from 'http';
import { OpenAIAgentAdapter } from '../src/main/agent/adapters';
import { AGENT_TOOLS } from '../src/main/agent/tools';

function sse(res: http.ServerResponse, obj: unknown): void {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

describe('OpenAI 에이전트 어댑터 통합 (fake SSE tool calling 서버)', () => {
  it('1턴 tool_calls 수신 → tool 메시지 포함 2턴 요청 → 텍스트 수신', async () => {
    const bodies: any[] = [];
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        const body = JSON.parse(raw);
        bodies.push(body);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const hasToolMsg = body.messages.some((m: any) => m.role === 'tool');
        if (!hasToolMsg) {
          sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'write_file', arguments: '' } }] } }] });
          sse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"gugudan.py","content":"print(2*1)"}' } }] } }] });
          sse(res, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
        } else {
          sse(res, { choices: [{ delta: { content: '생성 완료' } }] });
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const adapter = new OpenAIAgentAdapter({ model: 'm', baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'k' });
      const signal = new AbortController().signal;
      const t1 = await adapter.runTurn([{ role: 'user', content: '만들어' }], 'S', AGENT_TOOLS, () => {}, signal);
      expect(t1.toolCalls[0]).toEqual({ id: 'c1', name: 'write_file', args: { path: 'gugudan.py', content: 'print(2*1)' } });
      const chunks: string[] = [];
      const t2 = await adapter.runTurn(
        [
          { role: 'user', content: '만들어' },
          { role: 'assistant', content: '', toolCalls: t1.toolCalls },
          { role: 'tool', toolCallId: 'c1', name: 'write_file', content: '작성 완료' },
        ],
        'S', AGENT_TOOLS, (t) => chunks.push(t), signal,
      );
      expect(chunks.join('')).toBe('생성 완료');
      expect(t2.toolCalls).toHaveLength(0);
      expect(bodies[1].messages.some((m: any) => m.role === 'tool')).toBe(true);
      expect(bodies[0].tools).toHaveLength(AGENT_TOOLS.length);
    } finally {
      server.close();
    }
  });
});
