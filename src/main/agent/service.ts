// src/main/agent/service.ts — 에이전트 tool-use 루프. electron 임포트 금지, 동시 1개.
import { AnthropicAgentAdapter, OpenAIAgentAdapter, type AgentAdapter, type AgentMsg } from './adapters';
import { AGENT_TOOLS, READONLY_AGENT_TOOLS, buildWriteDiff, DIFF_SOURCE_CAP, executeTool, readCurrentContent, toolSummary, type AgentToolDeps } from './tools';
import { buildAgentSystemPrompt } from './prompt';
import { classifyError } from '../completion/errors';
import type { AgentEvent, ChatContext, ChatMessage } from '../../shared/protocol';

export const MAX_TOOL_CALLS = 25;
export const READONLY_MAX_TOOL_CALLS = 12; // 질문 모드 탐색 한도 (에이전트 모드보다 낮게)
const APPROVAL_REQUIRED = new Set(['write_file', 'run_command']);

// AgentEvent error kind은 'unsuitable'을 갖지 않는다 — 'other'로 접는다.
function toAgentErrorKind(e: unknown): 'auth' | 'transient' | 'other' {
  const kind = classifyError(e);
  return kind === 'unsuitable' ? 'other' : kind;
}

export interface AgentDeps {
  getSettings(): { provider: 'none' | 'anthropic' | 'openai'; model: string; baseURL?: string };
  getApiKey(): string | null;
  getToolDeps(): AgentToolDeps | null;
  adapterFactory?: (
    provider: 'anthropic' | 'openai',
    cfg: { model: string; apiKey: string | null; baseURL?: string },
  ) => AgentAdapter;
  executeToolOverride?: (name: string, args: Record<string, unknown>, deps: AgentToolDeps) => Promise<string>; // 테스트용
}

const defaultFactory: NonNullable<AgentDeps['adapterFactory']> = (provider, cfg) =>
  provider === 'anthropic'
    ? new AnthropicAgentAdapter({ model: cfg.model, apiKey: cfg.apiKey ?? '' })
    : new OpenAIAgentAdapter({ model: cfg.model, apiKey: cfg.apiKey ?? undefined, baseURL: cfg.baseURL });

export class AgentService {
  private controller: AbortController | null = null;
  private approvals = new Map<string, (ok: boolean) => void>();
  private readonly factory: NonNullable<AgentDeps['adapterFactory']>;
  private readonly exec: NonNullable<AgentDeps['executeToolOverride']>;

  constructor(private deps: AgentDeps) {
    this.factory = deps.adapterFactory ?? defaultFactory;
    this.exec = deps.executeToolOverride ?? executeTool;
  }

  isStreaming(): boolean {
    return this.controller !== null;
  }

  approve(id: string, ok: boolean): void {
    this.approvals.get(id)?.(ok);
    this.approvals.delete(id);
  }

  cancel(): void {
    this.controller?.abort();
    for (const resolve of this.approvals.values()) resolve(false);
    this.approvals.clear();
  }

  private waitApproval(id: string, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve(false);
      this.approvals.set(id, resolve);
      signal.addEventListener('abort', () => resolve(false), { once: true });
    });
  }

  async send(
    messages: ChatMessage[],
    context: ChatContext | null,
    autoApprove: boolean,
    onEvent: (e: AgentEvent) => void,
    readOnly = false,
  ): Promise<void> {
    if (this.controller) {
      onEvent({ type: 'error', kind: 'other' }); // 동시 1개
      return;
    }
    const settings = this.deps.getSettings();
    const toolDeps = this.deps.getToolDeps();
    if (settings.provider === 'none' || !toolDeps) {
      onEvent({ type: 'error', kind: 'other' });
      return;
    }
    const apiKey = this.deps.getApiKey();
    if (settings.provider === 'anthropic' && !apiKey) {
      onEvent({ type: 'error', kind: 'auth' });
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    try {
      const adapter = this.factory(settings.provider, { model: settings.model, apiKey, baseURL: settings.baseURL });
      const system = buildAgentSystemPrompt(context, readOnly);
      const tools = readOnly ? READONLY_AGENT_TOOLS : AGENT_TOOLS;
      const maxToolCalls = readOnly ? READONLY_MAX_TOOL_CALLS : MAX_TOOL_CALLS;
      const msgs: AgentMsg[] = messages.map((m) => ({ role: m.role, content: m.content }));
      let toolCount = 0;
      for (;;) {
        const res = await adapter.runTurn(msgs, system, tools, (t) => onEvent({ type: 'chunk', text: t }), controller.signal);
        msgs.push({ role: 'assistant', content: res.text, toolCalls: res.toolCalls.length ? res.toolCalls : undefined });
        if (res.toolCalls.length === 0) break;
        for (const call of res.toolCalls) {
          if (controller.signal.aborted) break;
          toolCount++;
          const summary = toolSummary(call.name, call.args);
          const isWrite = call.name === 'write_file';
          const path = isWrite ? String(call.args.path ?? '') : undefined;
          // write_file은 diff를 카드 detail로 — 승인 전 미리보기 + 완료 후 기록 (동일 diff 재사용)
          const diff = isWrite
            ? buildWriteDiff(toolDeps, String(call.args.path ?? ''), String(call.args.content ?? ''))
            : undefined;
          // 에디터 diff 뷰용 원문 — 상한 초과/읽기 불가면 생략 (뷰 버튼 미표시)
          let before: string | undefined;
          let after: string | undefined;
          if (isWrite) {
            const cur = readCurrentContent(toolDeps, String(call.args.path ?? ''));
            const proposed = String(call.args.content ?? '');
            if (cur !== null && proposed.length <= DIFF_SOURCE_CAP) {
              before = cur;
              after = proposed;
            }
          }
          let result: string;
          if (!autoApprove && APPROVAL_REQUIRED.has(call.name)) {
            onEvent({ type: 'tool', id: call.id, name: call.name, summary, state: 'awaiting', path, detail: diff, before, after });
            const ok = await this.waitApproval(call.id, controller.signal);
            if (controller.signal.aborted) break;
            if (!ok) {
              result = '사용자가 거부함';
              onEvent({ type: 'tool', id: call.id, name: call.name, summary, state: 'error', detail: result, path });
              msgs.push({ role: 'tool', toolCallId: call.id, name: call.name, content: result });
              continue;
            }
          }
          onEvent({ type: 'tool', id: call.id, name: call.name, summary, state: 'running', path });
          result = await this.exec(call.name, call.args, toolDeps);
          const failed = result.startsWith('오류');
          onEvent({
            type: 'tool',
            id: call.id,
            name: call.name,
            summary,
            state: failed ? 'error' : 'done',
            detail: call.name === 'run_command' || failed ? result : diff,
            path,
            before,
            after,
          });
          msgs.push({ role: 'tool', toolCallId: call.id, name: call.name, content: result });
        }
        if (controller.signal.aborted) break;
        if (toolCount >= maxToolCalls) {
          onEvent({ type: 'chunk', text: '\n(도구 호출 한도 도달 — 중단)' });
          break;
        }
      }
      onEvent({ type: 'done' });
    } catch (e) {
      if (controller.signal.aborted) {
        onEvent({ type: 'done' }); // 취소는 오류가 아님 — 부분 응답 유지
      } else {
        console.error('[agent] error:', e instanceof Error ? e.message : e);
        onEvent({ type: 'error', kind: toAgentErrorKind(e) });
      }
    } finally {
      this.controller = null;
      this.approvals.clear();
    }
  }
}
