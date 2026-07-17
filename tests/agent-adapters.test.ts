import { describe, it, expect } from 'vitest';
import { AnthropicAgentAdapter, OpenAIAgentAdapter, type AgentMsg } from '../src/main/agent/adapters';
import { AGENT_TOOLS } from '../src/main/agent/tools';

const noAbort = new AbortController().signal;

describe('OpenAIAgentAdapter', () => {
  it('tool_calls 스트리밍 델타를 조립하고 tool 메시지를 직렬화한다', async () => {
    let captured: any;
    const fake = {
      chat: {
        completions: {
          async create(params: any) {
            captured = params;
            async function* gen() {
              yield { choices: [{ delta: { content: '만들게요' } }] };
              yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'write_file', arguments: '{"path":"a.py",' } }] } }] };
              yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"content":"print(1)"}' } }] } }] };
            }
            return gen();
          },
        },
      },
    };
    const adapter = new OpenAIAgentAdapter({ model: 'm' }, fake as any);
    const msgs: AgentMsg[] = [
      { role: 'user', content: '구구단 만들어' },
      { role: 'assistant', content: '이전 응답', toolCalls: [{ id: 'c0', name: 'list_dir', args: {} }] },
      { role: 'tool', toolCallId: 'c0', name: 'list_dir', content: '[file] x' },
    ];
    const chunks: string[] = [];
    const res = await adapter.runTurn(msgs, 'SYS', AGENT_TOOLS, (t) => chunks.push(t), noAbort);
    expect(chunks.join('')).toBe('만들게요');
    expect(res.toolCalls).toEqual([{ id: 'c1', name: 'write_file', args: { path: 'a.py', content: 'print(1)' } }]);
    // 직렬화 검증
    expect(captured.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(captured.messages[2].tool_calls[0].function.name).toBe('list_dir');
    expect(captured.messages[3]).toEqual({ role: 'tool', tool_call_id: 'c0', content: '[file] x' });
    expect(captured.tools[0].function.name).toBe('list_dir');
    expect(captured.tools.map((t: any) => t.function.name)).toContain('write_file');
  });

  it('arguments JSON 파싱 실패 시 args {}로 반환한다', async () => {
    const fake = {
      chat: {
        completions: {
          async create() {
            async function* gen() {
              yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: '{broken' } }] } }] };
            }
            return gen();
          },
        },
      },
    };
    const adapter = new OpenAIAgentAdapter({ model: 'm' }, fake as any);
    const res = await adapter.runTurn([{ role: 'user', content: 'x' }], 'S', AGENT_TOOLS, () => {}, noAbort);
    expect(res.toolCalls).toEqual([{ id: 'c1', name: 'read_file', args: {} }]);
  });
});

describe('AnthropicAgentAdapter', () => {
  it('tool_use 블록을 조립하고 tool_result를 user 턴으로 직렬화한다', async () => {
    let captured: any;
    const fake = {
      messages: {
        async create(params: any) {
          captured = params;
          async function* gen() {
            yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '네' } };
            yield { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'write_file' } };
            yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":"a.py","content":' } };
            yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"print(1)"}' } };
            yield { type: 'content_block_stop', index: 1 };
          }
          return gen();
        },
      },
    };
    const adapter = new AnthropicAgentAdapter({ model: 'm', apiKey: 'k' }, fake as any);
    const msgs: AgentMsg[] = [
      { role: 'user', content: '만들어' },
      { role: 'assistant', content: '이전', toolCalls: [{ id: 't0', name: 'list_dir', args: {} }] },
      { role: 'tool', toolCallId: 't0', name: 'list_dir', content: '[file] x' },
    ];
    const chunks: string[] = [];
    const res = await adapter.runTurn(msgs, 'SYS', AGENT_TOOLS, (t) => chunks.push(t), noAbort);
    expect(chunks.join('')).toBe('네');
    expect(res.toolCalls).toEqual([{ id: 't1', name: 'write_file', args: { path: 'a.py', content: 'print(1)' } }]);
    expect(captured.system).toBe('SYS');
    expect(captured.tools[0].input_schema.type).toBe('object');
    // assistant 턴: text + tool_use 블록, tool 결과는 다음 user 턴의 tool_result 블록
    const asst = captured.messages[1];
    expect(asst.role).toBe('assistant');
    expect(asst.content.some((b: any) => b.type === 'tool_use' && b.id === 't0')).toBe(true);
    const toolTurn = captured.messages[2];
    expect(toolTurn.role).toBe('user');
    expect(toolTurn.content[0]).toEqual({ type: 'tool_result', tool_use_id: 't0', content: '[file] x' });
  });
});
