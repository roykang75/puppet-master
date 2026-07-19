// src/main/agent/service.ts — 에이전트 tool-use 루프. electron 임포트 금지, 동시 1개.
import { AnthropicAgentAdapter, OpenAIAgentAdapter, type AgentAdapter, type AgentMsg } from './adapters';
import { AGENT_TOOLS, READONLY_AGENT_TOOLS, buildWriteDiff, DIFF_SOURCE_CAP, executeTool, readCurrentContent, toolSummary, type AgentToolDeps } from './tools';
import { buildAgentSystemPrompt } from './prompt';
import { classifyError } from '../completion/errors';
import type { AgentEvent, ChatContext, ChatMessage, WorktreeChange } from '../../shared/protocol';

export const MAX_TOOL_CALLS = 25;
export const READONLY_MAX_TOOL_CALLS = 12; // 질문 모드 탐색 한도 (에이전트 모드보다 낮게)
const APPROVAL_REQUIRED = new Set(['write_file', 'run_command']);

// AgentEvent error kind은 'unsuitable'을 갖지 않는다 — 'other'로 접는다.
function toAgentErrorKind(e: unknown): 'auth' | 'transient' | 'other' {
  const kind = classifyError(e);
  return kind === 'unsuitable' ? 'other' : kind;
}

/** 격리(worktree) 모드 배선 — electron-free하게 worktree.ts + settings를 묶어 main.ts에서 주입한다.
 *  미주입(undefined) 또는 enabled()=false면 기존 직접 모드 그대로. */
export interface AgentIsolationDeps {
  enabled(): boolean; // settings.agent.isolate
  isGit(): boolean; // isGitRepo(projectRoot)
  ensure(): { dir: string; skipped: string[] }; // ensureWorktree — 실패 시 throw
  changes(dir: string): WorktreeChange[]; // worktreeChanges(dir)
}

export interface AgentDeps {
  getSettings(): { provider: 'none' | 'anthropic' | 'openai'; model: string; baseURL?: string };
  getApiKey(): string | null;
  getToolDeps(): AgentToolDeps | null;
  isolation?: AgentIsolationDeps;
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

  /** 격리 턴 종료 시 wt 변경 목록을 렌더러로 1회 전달. 실패해도 done 흐름을 막지 않는다. */
  private emitWorktreeChanges(iso: AgentIsolationDeps, wtDir: string, onEvent: (e: AgentEvent) => void): void {
    try {
      onEvent({ type: 'worktree', changes: iso.changes(wtDir) });
    } catch (e) {
      console.error('[agent] worktree 변경 조회 실패:', e instanceof Error ? e.message : e);
    }
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
    const baseToolDeps = this.deps.getToolDeps();
    if (settings.provider === 'none' || !baseToolDeps) {
      onEvent({ type: 'error', kind: 'other' });
      return;
    }
    const apiKey = this.deps.getApiKey();
    if (settings.provider === 'anthropic' && !apiKey) {
      onEvent({ type: 'error', kind: 'auth' });
      return;
    }
    // 격리(worktree) 모드 — 턴 시작 시 worktree 보장 후 projectRoot를 wt로 교체 (파일 도구가 wt 기준으로 격리됨).
    // searchText/indexerQuery는 원본 인덱스(read-only) 그대로 유지된다.
    const iso = this.deps.isolation;
    let worktreeDir: string | null = null;
    let toolDeps = baseToolDeps;
    if (iso?.enabled()) {
      if (!iso.isGit()) {
        // 비-git인데 격리 on — 직접 모드 묵시 폴백 금지, 명시적 오류로 중단
        onEvent({ type: 'chunk', text: '격리 모드가 켜져 있지만 이 프로젝트는 git 저장소가 아닙니다. 격리를 끄거나 git 저장소에서 실행하세요.' });
        onEvent({ type: 'done' });
        return;
      }
      try {
        const { dir, skipped } = iso.ensure();
        worktreeDir = dir;
        toolDeps = { ...baseToolDeps, projectRoot: dir };
        if (skipped.length > 0) {
          onEvent({ type: 'chunk', text: `(격리: 큰/많은 파일 ${skipped.length}개는 샌드박스 동기화에서 제외됨)\n` });
        }
      } catch (e) {
        console.error('[agent] worktree 준비 실패:', e instanceof Error ? e.message : e);
        onEvent({ type: 'chunk', text: `격리 샌드박스 준비 실패: ${e instanceof Error ? e.message : String(e)}` });
        onEvent({ type: 'done' });
        return;
      }
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
      if (worktreeDir && iso) this.emitWorktreeChanges(iso, worktreeDir, onEvent);
      onEvent({ type: 'done' });
    } catch (e) {
      if (controller.signal.aborted) {
        // 취소도 wt에 이미 쓰인 변경은 리뷰 대상 — 부분 응답과 함께 유지
        if (worktreeDir && iso) this.emitWorktreeChanges(iso, worktreeDir, onEvent);
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
