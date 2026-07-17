// src/main/agent/adapters.ts — 에이전트 턴 어댑터 (클라이언트 주입 가능, chat 어댑터 패턴)
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { AGENT_MAX_TOKENS } from './prompt';
import type { ToolSpec } from './tools';

export interface AgentToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
export type AgentMsg =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: AgentToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };
export interface AgentTurnResult {
  text: string;
  toolCalls: AgentToolCall[];
}
export interface AgentAdapter {
  runTurn(
    messages: AgentMsg[],
    system: string,
    tools: ToolSpec[],
    onChunk: (t: string) => void,
    signal: AbortSignal,
  ): Promise<AgentTurnResult>;
}

function parseArgs(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json || '{}');
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {}; // 파싱 실패 — 실행기가 인자 부족 오류를 tool result로 돌려준다
  }
}

// ── OpenAI 호환 (LM Studio 등) ──
interface OpenAIAgentClient {
  chat: {
    completions: {
      create(
        params: Record<string, unknown>,
        opts?: { signal?: AbortSignal },
      ): Promise<AsyncIterable<{ choices: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> } }> }>>;
    };
  };
}

export class OpenAIAgentAdapter implements AgentAdapter {
  private client: OpenAIAgentClient;
  constructor(
    private cfg: { model: string; apiKey?: string; baseURL?: string },
    client?: OpenAIAgentClient,
  ) {
    this.client =
      client ?? (new OpenAI({ apiKey: cfg.apiKey ?? 'local', baseURL: cfg.baseURL, maxRetries: 0 }) as unknown as OpenAIAgentClient);
  }

  async runTurn(
    messages: AgentMsg[],
    system: string,
    tools: ToolSpec[],
    onChunk: (t: string) => void,
    signal: AbortSignal,
  ): Promise<AgentTurnResult> {
    const wire: Array<Record<string, unknown>> = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (m.role === 'user') wire.push({ role: 'user', content: m.content });
      else if (m.role === 'assistant') {
        const msg: Record<string, unknown> = { role: 'assistant', content: m.content || null };
        if (m.toolCalls?.length) {
          msg.tool_calls = m.toolCalls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.args) },
          }));
        }
        wire.push(msg);
      } else wire.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    }
    const stream = await this.client.chat.completions.create(
      {
        model: this.cfg.model,
        max_tokens: AGENT_MAX_TOKENS,
        stream: true,
        messages: wire,
        tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
      },
      { signal },
    );
    let text = '';
    const acc = new Map<number, { id: string; name: string; args: string }>();
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        text += delta.content;
        onChunk(delta.content);
      }
      for (const tc of delta?.tool_calls ?? []) {
        const cur = acc.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name && !cur.name) cur.name = tc.function.name; // name은 첫 델타에 한 번만 온다
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        acc.set(tc.index, cur);
      }
    }
    const toolCalls: AgentToolCall[] = [...acc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, c], i) => ({ id: c.id || `call_${i}`, name: c.name, args: parseArgs(c.args) }))
      .filter((c) => c.name);
    return { text, toolCalls };
  }
}

// ── Anthropic ──
interface AnthropicAgentClient {
  messages: {
    create(
      params: Record<string, unknown>,
      opts?: { signal?: AbortSignal },
    ): Promise<AsyncIterable<{ type: string; index?: number; content_block?: { type: string; id?: string; name?: string }; delta?: { type?: string; text?: string; partial_json?: string } }>>;
  };
}

export class AnthropicAgentAdapter implements AgentAdapter {
  private client: AnthropicAgentClient;
  constructor(
    private cfg: { model: string; apiKey?: string },
    client?: AnthropicAgentClient,
  ) {
    this.client = client ?? (new Anthropic({ apiKey: cfg.apiKey ?? '', maxRetries: 0 }) as unknown as AnthropicAgentClient);
  }

  async runTurn(
    messages: AgentMsg[],
    system: string,
    tools: ToolSpec[],
    onChunk: (t: string) => void,
    signal: AbortSignal,
  ): Promise<AgentTurnResult> {
    // 중립 표현 → Anthropic content blocks. 연속 tool 메시지는 하나의 user 턴으로 병합.
    const wire: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
    for (const m of messages) {
      if (m.role === 'user') wire.push({ role: 'user', content: m.content });
      else if (m.role === 'assistant') {
        const blocks: unknown[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
        wire.push({ role: 'assistant', content: blocks.length ? blocks : m.content });
      } else {
        const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
        const last = wire[wire.length - 1];
        if (last && last.role === 'user' && Array.isArray(last.content)) (last.content as unknown[]).push(block);
        else wire.push({ role: 'user', content: [block] });
      }
    }
    const stream = await this.client.messages.create(
      {
        model: this.cfg.model,
        max_tokens: AGENT_MAX_TOKENS,
        stream: true,
        system,
        messages: wire,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      },
      { signal },
    );
    let text = '';
    const blocks = new Map<number, { id: string; name: string; json: string }>();
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
        text += ev.delta.text;
        onChunk(ev.delta.text);
      } else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
        blocks.set(ev.index ?? 0, { id: ev.content_block.id ?? '', name: ev.content_block.name ?? '', json: '' });
      } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta') {
        const b = blocks.get(ev.index ?? 0);
        if (b) b.json += ev.delta.partial_json ?? '';
      }
    }
    const toolCalls: AgentToolCall[] = [...blocks.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, b], i) => ({ id: b.id || `tool_${i}`, name: b.name, args: parseArgs(b.json) }));
    return { text, toolCalls };
  }
}
