// v3 Plan 21 — 에이전트 구조 도구 4종 + 컨텍스트 구조 블록 + S3(fake 서버) 실증.
import { describe, it, expect } from 'vitest';
import * as http from 'http';
import { executeTool, toolSummary, AGENT_TOOLS, READONLY_AGENT_TOOLS, AgentToolDeps } from '../src/main/agent/tools';
import { buildAgentSystemPrompt } from '../src/main/agent/prompt';
import { buildStructureLines } from '../src/renderer/src/chat-context';
import { OpenAIAgentAdapter } from '../src/main/agent/adapters';

// 인덱서 RPC 페이크 — 실제 응답 형태 그대로
const fakeIndexer = (method: string, params: Record<string, unknown>): Promise<unknown> => {
  if (method === 'resolve') {
    if (params.name === 'target')
      return Promise.resolve([{ id: 1, name: 'target', kind: 'function', signature: 'export function target()', path: 'lib/util.ts', line: 0 }]);
    return Promise.resolve([]);
  }
  if (method === 'getCallers') {
    if (params.name === 'target')
      return Promise.resolve([{ callerId: 2, callerName: 'midCaller', callerKind: 'function', path: 'lib/util.ts', line: 1 }]);
    if (params.name === 'midCaller')
      return Promise.resolve([{ callerId: 3, callerName: 'topCaller', callerKind: 'function', path: 'lib/util.ts', line: 2 }]);
    return Promise.resolve([]);
  }
  if (method === 'getCallees') {
    if (params.symbolId === 1)
      return Promise.resolve([{ id: 9, name: 'helper', kind: 'function', signature: 'function helper()', path: 'lib/h.ts', line: 4 }]);
    return Promise.resolve([]);
  }
  if (method === 'getImpact')
    return Promise.resolve([
      { name: 'midCaller', kind: 'function', path: 'lib/util.ts', line: 1, depth: 1 },
      { name: 'topCaller', kind: 'function', path: 'lib/util.ts', line: 2, depth: 2 },
    ]);
  if (method === 'traceHttp')
    return Promise.resolve({
      calls: [{ method: 'GET', path: '/api/users/{}', rawPath: '/api/users/{}', file: 'web/app.ts', line: 2, enclosingName: 'loadUser',
        endpoints: [{ method: 'GET', path: '/api/users/{}', file: 'server/main.py', line: 0, handlerName: 'read_user' }] }],
      endpoints: [{ method: 'GET', path: '/api/users/{}', file: 'server/main.py', line: 0, handlerName: 'read_user',
        calls: [{ file: 'web/app.ts', line: 2, enclosingName: 'loadUser' }] }],
    });
  return Promise.resolve(null);
};

const deps: AgentToolDeps = {
  projectRoot: '/tmp',
  allowedDirs: [],
  searchText: async () => [],
  indexerQuery: fakeIndexer,
};

describe('구조 도구 실행', () => {
  it('find_symbol: 정의+시그니처+위치', async () => {
    const out = await executeTool('find_symbol', { name: 'target' }, deps);
    expect(out).toContain('function target — lib/util.ts:1');
    expect(out).toContain('export function target()');
  });
  it('find_symbol: 미발견 → search_text 안내', async () => {
    expect(await executeTool('find_symbol', { name: 'nope' }, deps)).toContain('search_text');
  });
  it('get_call_graph callers: 2단계 들여쓰기', async () => {
    const out = await executeTool('get_call_graph', { name: 'target', direction: 'callers' }, deps);
    expect(out).toContain('midCaller — lib/util.ts:2');
    expect(out).toContain('  ↳ topCaller — lib/util.ts:3');
  });
  it('get_call_graph callees: resolve→id→callees', async () => {
    const out = await executeTool('get_call_graph', { name: 'target', direction: 'callees' }, deps);
    expect(out).toContain('helper — lib/h.ts:5');
  });
  it('get_impact: 직접/간접 구분 + 총계', async () => {
    const out = await executeTool('get_impact', { name: 'target' }, deps);
    expect(out).toContain('총 2개 위치');
    expect(out).toContain('직접 호출자:');
    expect(out).toContain('midCaller — lib/util.ts:2');
    expect(out).toContain('간접(2단계):');
    expect(out).toContain('topCaller — lib/util.ts:3');
  });
  it('trace_http: 엔드포인트↔호출부 양방향 화살표', async () => {
    const out = await executeTool('trace_http', { query: '/api/users' }, deps);
    expect(out).toContain('[GET] /api/users/{} — 핸들러 read_user (server/main.py:1)');
    expect(out).toContain('← 호출: loadUser (web/app.ts:3)');
    expect(out).toContain('→ 핸들러: read_user (server/main.py:1)');
  });
  it('indexerQuery 미주입 → 안내 (크래시 없음)', async () => {
    const noIdx: AgentToolDeps = { projectRoot: '/tmp', allowedDirs: [], searchText: async () => [] };
    expect(await executeTool('get_impact', { name: 'x' }, noIdx)).toContain('인덱서를 사용할 수 없습니다');
  });
});

describe('도구셋/요약/프롬프트', () => {
  it('구조 도구 4종은 읽기 전용셋에도 포함 (질문 모드)', () => {
    for (const n of ['find_symbol', 'get_call_graph', 'get_impact', 'trace_http']) {
      expect(READONLY_AGENT_TOOLS.map((t) => t.name)).toContain(n);
      expect(AGENT_TOOLS.map((t) => t.name)).toContain(n);
    }
  });
  it('toolSummary', () => {
    expect(toolSummary('find_symbol', { name: 'foo' })).toBe('foo');
    expect(toolSummary('get_call_graph', { name: 'foo', direction: 'callers' })).toBe('foo (callers)');
    expect(toolSummary('trace_http', { query: '/api' })).toBe('/api');
  });
  it('시스템 프롬프트에 구조 도구 우선 지침 (양 모드)', () => {
    for (const ro of [true, false]) {
      const p = buildAgentSystemPrompt(null, ro);
      expect(p).toContain('find_symbol');
      expect(p).toContain('get_impact');
      expect(p).toContain('최후 수단');
    }
  });
});

describe('컨텍스트 구조 블록 (buildStructureLines)', () => {
  it('callers/callees 상위 5 라인', () => {
    const lines = buildStructureLines(
      'target',
      [{ callerName: 'midCaller', path: 'lib/util.ts', line: 1 }, { callerName: null, path: 'top.ts', line: 0 }],
      [{ name: 'helper', signature: 'function helper()', path: 'lib/h.ts', line: 4 }],
    );
    expect(lines[0]).toContain('target');
    expect(lines).toContain('호출자: midCaller — lib/util.ts:2');
    expect(lines).toContain('호출자: (파일 최상위) — top.ts:1');
    expect(lines).toContain('피호출: function helper() — lib/h.ts:5');
  });
  it('둘 다 비면 []', () => {
    expect(buildStructureLines('x', [], [])).toEqual([]);
  });
});

// S3 실증: "target 바꾸면 뭐가 깨져?" → get_impact tool → callers가 tool 결과에 → 응답이 반영
describe('S3: fake 서버 통합 — 영향 질문에 callers 반영', () => {
  it('tool_calls get_impact → 결과에 midCaller → 최종 응답 반영', async () => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        const body = JSON.parse(raw);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const toolMsg = body.messages.find((m: { role: string; content?: string }) => m.role === 'tool');
        if (!toolMsg) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'i1', type: 'function', function: { name: 'get_impact', arguments: '{"name":"target"}' } }] } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
        } else {
          // 모델 역할 흉내: tool 결과에 midCaller가 있으면 응답에 반영
          const text = toolMsg.content.includes('midCaller') ? 'midCaller와 topCaller가 영향받습니다' : '영향 없음';
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
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
      const t1 = await adapter.runTurn([{ role: 'user', content: 'target 바꾸면 뭐가 깨져?' }], 'S', READONLY_AGENT_TOOLS, () => {}, signal);
      expect(t1.toolCalls[0].name).toBe('get_impact');
      const result = await executeTool('get_impact', t1.toolCalls[0].args, deps);
      expect(result).toContain('midCaller'); // 그래프가 tool 결과에
      const chunks: string[] = [];
      await adapter.runTurn(
        [
          { role: 'user', content: 'target 바꾸면 뭐가 깨져?' },
          { role: 'assistant', content: '', toolCalls: t1.toolCalls },
          { role: 'tool', toolCallId: 'i1', name: 'get_impact', content: result },
        ],
        'S', READONLY_AGENT_TOOLS, (t) => chunks.push(t), signal,
      );
      expect(chunks.join('')).toContain('midCaller와 topCaller가 영향받습니다'); // 응답에 반영 (S3)
    } finally {
      server.close();
    }
  });
});
