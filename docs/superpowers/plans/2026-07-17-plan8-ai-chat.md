# Plan 8: AI 채팅 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 에디터 옆(우측 탭)에 코드 컨텍스트를 자동 주입하는 스트리밍 AI 채팅 패널을 만든다.

**Architecture:** main이 스트리밍 ChatService(무상태 중계 — 이력은 렌더러 store 소유)를 갖고, 기존 completion 설정(provider/model/baseURL/키)을 재사용해 Anthropic/OpenAI 어댑터로 스트리밍 호출한다. 청크는 `chat:event`로 push, `chat:cancel`은 AbortController. 렌더러는 우측 영역을 "Relation | AI 채팅" 탭으로 확장하고, 전송 시 선택 영역/커서 주변 코드+심볼 시그니처를 자동 주입(토글 가능)한다.

**Tech Stack:** 기존 @anthropic-ai/sdk·openai SDK(스트리밍), Electron ipc push, zustand store, 기존 theme.css 변수

**스펙**: `docs/superpowers/specs/2026-07-17-plan8-ai-chat-design.md`

## Global Constraints

- **API 키는 main에만** — 렌더러 직접 SDK 호출 금지. 오류는 kind 고정 문자열(`'auth'|'transient'|'other'`)만 IPC 통과 (completion과 동일 원칙)
- **채팅 전용 설정 없음** — 기존 completion 설정 재사용. provider 미설정 시 렌더러가 전송 전 단락(패널 안내), main도 2차 방어
- **main ChatService는 무상태** — 대화 이력의 단일 소유자는 렌더러 store. 동시 스트리밍 1개(진행 중 chat:send 거부)
- 대화는 앱 세션 메모리만 — `setProject` 리셋에 포함, 진행 중이면 cancel
- 취소 시 부분 응답 유지 + "(중단됨)" 표기. 스트리밍 중 입력 비활성(중단 버튼만)
- **한글 IME 주의**: 입력창 Enter 전송은 `e.nativeEvent.isComposing`이면 무시 (조합 확정 Enter로 이중 전송 방지)
- 인덱서/DB 스키마 무변경 (additive 모듈 — 기존 `getFileOutline` read-only 재사용)
- 커밋 메시지 한국어 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 트레일러. `git add`는 명시적 파일 나열만(-A 금지)
- `npm test`는 node ABI 필요. E2E 태스크는 종료 시 `npm run rebuild:node` + `npm test` 복원·보고

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/shared/protocol.ts` (수정) | ChatMessage/ChatContext/ChatEvent 타입 |
| `src/main/chat/prompt.ts` (신규) | 시스템 프롬프트 빌더 (순수) |
| `src/main/chat/adapters.ts` (신규) | Anthropic/OpenAI 스트리밍 채팅 어댑터 (클라이언트 주입 가능) |
| `src/main/chat/service.ts` (신규) | ChatService — 어댑터 선택/스트리밍 중계/동시 1개/취소 |
| `src/main/main.ts` (수정) | ipc chat:send/chat:cancel + chat:event push |
| `src/preload/preload.ts` (수정) | chatSend/chatCancel/onChatEvent |
| `src/renderer/src/chat-context.ts` (신규) | 컨텍스트 빌더 (순수) |
| `src/renderer/src/components/EditorPane.tsx` (수정) | `getChatEditorState()` export |
| `src/renderer/src/components/RightPanel.tsx` (신규) | "Relation \| AI 채팅" 탭 래퍼 |
| `src/renderer/src/components/ChatPanel.tsx` (신규) | 채팅 UI |
| `src/renderer/src/store.ts` (수정) | chatMessages/chatStreaming/rightTab/chatContextEnabled |
| `src/renderer/src/App.tsx` (수정) | RelationPanel 자리 → RightPanel |
| `src/renderer/src/theme.css` (수정) | 채팅 스타일 (기존 변수 사용) |

---

### Task 1: 공유 타입 + 시스템 프롬프트 빌더 (TDD)

**Files:**
- Modify: `src/shared/protocol.ts`
- Create: `src/main/chat/prompt.ts`
- Test: `tests/chat-prompt.test.ts`

**Interfaces (Produces):**

```ts
// protocol.ts
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ChatContext {
  path: string; languageId: string;
  code: string; isSelection: boolean; startLine: number; // 1-기반 표시용
  signatures: string[];
}
export type ChatEvent =
  | { type: 'chunk'; text: string }
  | { type: 'done' }
  | { type: 'error'; kind: 'auth' | 'transient' | 'other' };
// prompt.ts
export const CHAT_MAX_TOKENS = 2048;
export function buildChatSystemPrompt(context: ChatContext | null): string;
```

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/chat-prompt.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildChatSystemPrompt, CHAT_MAX_TOKENS } from '../src/main/chat/prompt';
import type { ChatContext } from '../src/shared/protocol';

const ctx: ChatContext = {
  path: 'src/app.ts', languageId: 'typescript',
  code: 'function add(a, b) {\n  return a + b;\n}', isSelection: true, startLine: 10,
  signatures: ['function add(a, b)', 'class App'],
};

describe('buildChatSystemPrompt', () => {
  it('컨텍스트 없으면 기본 지시만', () => {
    const s = buildChatSystemPrompt(null);
    expect(s).toContain('코드 어시스턴트');
    expect(s).toContain('한국어');
    expect(s).not.toContain('```');
  });

  it('컨텍스트 포함: 경로/언어/선택 표시/시작 줄/코드 블록/시그니처', () => {
    const s = buildChatSystemPrompt(ctx);
    expect(s).toContain('src/app.ts');
    expect(s).toContain('typescript');
    expect(s).toContain('선택 영역');
    expect(s).toContain('10행부터');
    expect(s).toContain('```typescript\nfunction add(a, b) {');
    expect(s).toContain('- function add(a, b)');
    expect(s).toContain('- class App');
  });

  it('선택이 아니면 "커서 주변" 표기, 시그니처 없으면 목록 생략', () => {
    const s = buildChatSystemPrompt({ ...ctx, isSelection: false, signatures: [] });
    expect(s).toContain('커서 주변');
    expect(s).not.toContain('심볼 시그니처');
  });

  it('상수', () => {
    expect(CHAT_MAX_TOKENS).toBe(2048);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/chat-prompt.test.ts` → 모듈 없음 FAIL

- [ ] **Step 3: protocol.ts에 타입 추가** (LSP 블록 뒤에):

```ts
// ── AI 채팅 (Plan 8) ──
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ChatContext {
  path: string;
  languageId: string;
  code: string;
  isSelection: boolean;
  startLine: number; // 1-기반 (표시용)
  signatures: string[];
}
export type ChatEvent =
  | { type: 'chunk'; text: string }
  | { type: 'done' }
  | { type: 'error'; kind: 'auth' | 'transient' | 'other' };
```

- [ ] **Step 4: prompt.ts 구현**

```ts
// 채팅 시스템 프롬프트 — 순수 모듈 (electron/SDK 임포트 금지)
import type { ChatContext } from '../../shared/protocol';

export const CHAT_MAX_TOKENS = 2048;

export function buildChatSystemPrompt(context: ChatContext | null): string {
  const lines = [
    '너는 코드 어시스턴트다. 간결하고 정확하게 한국어로 답한다.',
    '코드를 보여줄 때는 마크다운 코드 펜스를 사용한다.',
  ];
  if (context) {
    lines.push('');
    lines.push(
      `사용자가 보고 있는 코드 (${context.path}, ${context.languageId}, ` +
        `${context.isSelection ? '선택 영역' : '커서 주변'}, ${context.startLine}행부터):`,
    );
    lines.push('```' + context.languageId + '\n' + context.code + '\n```');
    if (context.signatures.length > 0) {
      lines.push('이 파일의 심볼 시그니처:');
      for (const sig of context.signatures) lines.push(`- ${sig}`);
    }
  }
  return lines.join('\n');
}
```

- [ ] **Step 5: 통과 확인** — `npx vitest run tests/chat-prompt.test.ts` → PASS

- [ ] **Step 6: 커밋**

```bash
git add src/shared/protocol.ts src/main/chat/prompt.ts tests/chat-prompt.test.ts
git commit -m "AI 채팅 기반: 공유 타입 + 시스템 프롬프트 빌더

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 스트리밍 채팅 어댑터 2종 (TDD)

**Files:**
- Create: `src/main/chat/adapters.ts`
- Test: `tests/chat-adapters.test.ts`

**Interfaces:**
- Consumes: `buildChatSystemPrompt/CHAT_MAX_TOKENS`(Task 1), `ChatMessage/ChatContext`
- Produces:

```ts
export interface ChatAdapter {
  // 청크마다 onChunk 호출. 완료 시 resolve. 오류는 throw (SDK 타입드 예외 그대로).
  // signal abort 시 SDK가 던지는 예외도 그대로 throw — 호출측(service)이 aborted 여부로 구분.
  chatStream(
    messages: ChatMessage[],
    context: ChatContext | null,
    onChunk: (text: string) => void,
    signal: AbortSignal,
  ): Promise<void>;
}
export class AnthropicChatAdapter implements ChatAdapter {
  constructor(cfg: { model: string; apiKey: string }, client?: AnthropicChatClient);
}
export class OpenAIChatAdapter implements ChatAdapter {
  constructor(cfg: { model: string; apiKey?: string; baseURL?: string }, client?: OpenAIChatClient);
}
```

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/chat-adapters.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { AnthropicChatAdapter, OpenAIChatAdapter, type AnthropicChatClient, type OpenAIChatClient } from '../src/main/chat/adapters';
import { CHAT_MAX_TOKENS } from '../src/main/chat/prompt';
import type { ChatContext, ChatMessage } from '../src/shared/protocol';

const msgs: ChatMessage[] = [
  { role: 'user', content: '이 함수 설명해줘' },
  { role: 'assistant', content: '어떤 함수인가요?' },
  { role: 'user', content: 'add 함수' },
];
const ctx: ChatContext = {
  path: 'a.ts', languageId: 'typescript', code: 'function add() {}',
  isSelection: false, startLine: 1, signatures: [],
};

async function* anthropicEvents() {
  yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '안녕' } };
  yield { type: 'content_block_delta', delta: { type: 'input_json_delta' } }; // 무시 대상
  yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '하세요' } };
  yield { type: 'message_stop' };
}

describe('AnthropicChatAdapter', () => {
  it('파라미터(system/messages/max_tokens/stream) + text_delta만 onChunk', async () => {
    let seen: any = null;
    let seenOpts: any = null;
    const fake: AnthropicChatClient = {
      messages: {
        create: async (params, opts) => {
          seen = params;
          seenOpts = opts;
          return anthropicEvents() as any;
        },
      },
    };
    const chunks: string[] = [];
    const ac = new AbortController();
    const adapter = new AnthropicChatAdapter({ model: 'claude-haiku-4-5', apiKey: 'sk-x' }, fake);
    await adapter.chatStream(msgs, ctx, (t) => chunks.push(t), ac.signal);
    expect(chunks).toEqual(['안녕', '하세요']);
    expect(seen.model).toBe('claude-haiku-4-5');
    expect(seen.max_tokens).toBe(CHAT_MAX_TOKENS);
    expect(seen.stream).toBe(true);
    expect(seen.system).toContain('function add() {}'); // 컨텍스트가 system에
    expect(seen.messages).toEqual(msgs); // 이력 그대로 (system 별도)
    expect(seenOpts.signal).toBe(ac.signal);
  });
});

async function* openaiChunks() {
  yield { choices: [{ delta: { content: 'A' } }] };
  yield { choices: [{ delta: {} }] }; // content 없는 청크 무시
  yield { choices: [{ delta: { content: 'B' } }] };
}

describe('OpenAIChatAdapter', () => {
  it('system 메시지 선두 + delta.content만 onChunk + signal 전달', async () => {
    let seen: any = null;
    let seenOpts: any = null;
    const fake: OpenAIChatClient = {
      chat: {
        completions: {
          create: async (params, opts) => {
            seen = params;
            seenOpts = opts;
            return openaiChunks() as any;
          },
        },
      },
    };
    const chunks: string[] = [];
    const ac = new AbortController();
    const adapter = new OpenAIChatAdapter({ model: 'local', baseURL: 'http://x/v1' }, fake);
    await adapter.chatStream(msgs, null, (t) => chunks.push(t), ac.signal);
    expect(chunks).toEqual(['A', 'B']);
    expect(seen.model).toBe('local');
    expect(seen.stream).toBe(true);
    expect(seen.max_tokens).toBe(CHAT_MAX_TOKENS);
    expect(seen.messages[0].role).toBe('system');
    expect(seen.messages.slice(1)).toEqual(msgs);
    expect(seenOpts.signal).toBe(ac.signal);
  });

  it('스트림 도중 예외는 그대로 전파', async () => {
    async function* failing() {
      yield { choices: [{ delta: { content: 'x' } }] };
      throw new Error('boom');
    }
    const fake: OpenAIChatClient = {
      chat: { completions: { create: async () => failing() as any } },
    };
    const adapter = new OpenAIChatAdapter({ model: 'm' }, fake);
    await expect(
      adapter.chatStream(msgs, null, () => {}, new AbortController().signal),
    ).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/chat-adapters.test.ts` → FAIL

- [ ] **Step 3: adapters.ts 구현**

```ts
// 스트리밍 채팅 어댑터 — 클라이언트 주입 가능 (completion 어댑터와 같은 패턴).
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { buildChatSystemPrompt, CHAT_MAX_TOKENS } from './prompt';
import type { ChatContext, ChatMessage } from '../../shared/protocol';

export interface ChatAdapter {
  chatStream(
    messages: ChatMessage[],
    context: ChatContext | null,
    onChunk: (text: string) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

// ── Anthropic ──
export interface AnthropicChatClient {
  messages: {
    create(
      params: {
        model: string;
        max_tokens: number;
        stream: true;
        system: string;
        messages: ChatMessage[];
      },
      opts: { signal: AbortSignal },
    ): Promise<AsyncIterable<{ type: string; delta?: { type?: string; text?: string } }>>;
  };
}

export class AnthropicChatAdapter implements ChatAdapter {
  private client: AnthropicChatClient;

  constructor(
    private cfg: { model: string; apiKey: string },
    client?: AnthropicChatClient,
  ) {
    this.client = client ?? (new Anthropic({ apiKey: cfg.apiKey, maxRetries: 0 }) as unknown as AnthropicChatClient);
  }

  async chatStream(
    messages: ChatMessage[],
    context: ChatContext | null,
    onChunk: (text: string) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const stream = await this.client.messages.create(
      {
        model: this.cfg.model,
        max_tokens: CHAT_MAX_TOKENS,
        stream: true,
        system: buildChatSystemPrompt(context),
        messages,
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
        onChunk(event.delta.text);
      }
    }
  }
}

// ── OpenAI 호환 ──
export interface OpenAIChatClient {
  chat: {
    completions: {
      create(
        params: {
          model: string;
          max_tokens: number;
          stream: true;
          messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
        },
        opts: { signal: AbortSignal },
      ): Promise<AsyncIterable<{ choices: Array<{ delta?: { content?: string | null } }> }>>;
    };
  };
}

export class OpenAIChatAdapter implements ChatAdapter {
  private client: OpenAIChatClient;

  constructor(
    private cfg: { model: string; apiKey?: string; baseURL?: string },
    client?: OpenAIChatClient,
  ) {
    this.client =
      client ??
      (new OpenAI({ apiKey: cfg.apiKey ?? 'local', baseURL: cfg.baseURL, maxRetries: 0 }) as unknown as OpenAIChatClient);
  }

  async chatStream(
    messages: ChatMessage[],
    context: ChatContext | null,
    onChunk: (text: string) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.cfg.model,
        max_tokens: CHAT_MAX_TOKENS,
        stream: true,
        messages: [{ role: 'system', content: buildChatSystemPrompt(context) }, ...messages],
      },
      { signal },
    );
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) onChunk(text);
    }
  }
}
```

**구현 주의**: 실제 SDK의 `create(..., {signal})` 두 번째 인자 지원과 스트리밍 반환 타입이 위 최소 인터페이스와 다르면(제네릭 등) `as unknown as` 캐스트 위치를 조정하되, 테스트의 fake 인터페이스와 공개 시그니처는 유지하고 보고서에 기록.

- [ ] **Step 4: 통과 확인** — `npx vitest run tests/chat-adapters.test.ts` → PASS

- [ ] **Step 5: 커밋**

```bash
git add src/main/chat/adapters.ts tests/chat-adapters.test.ts
git commit -m "AI 채팅 어댑터: Anthropic/OpenAI 스트리밍 (클라이언트 주입, abort signal 전달)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: ChatService + main ipc + preload (TDD)

**Files:**
- Create: `src/main/chat/service.ts`
- Modify: `src/main/main.ts`, `src/preload/preload.ts`
- Test: `tests/chat-service.test.ts`

**Interfaces:**
- Consumes: 어댑터(Task 2), 기존 `classifyError`(src/main/completion/errors.ts), SettingsStore(getCompletion/getApiKey)
- Produces:

```ts
export interface ChatDeps {
  getSettings(): { provider: 'none' | 'anthropic' | 'openai'; model: string; baseURL?: string };
  getApiKey(): string | null;
  adapterFactory?: (provider: 'anthropic' | 'openai', cfg: { model: string; apiKey: string | null; baseURL?: string }) => ChatAdapter;
}
export class ChatService {
  constructor(deps: ChatDeps);
  isStreaming(): boolean;
  // 스트리밍 시작. 이미 진행 중이면 즉시 {error, kind:'other'} 이벤트 후 반환(기존 스트림 유지).
  send(messages: ChatMessage[], context: ChatContext | null, onEvent: (e: ChatEvent) => void): Promise<void>;
  cancel(): void; // 진행 중 스트림 abort — send가 {type:'done'}으로 마무리
}
```

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/chat-service.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { ChatService } from '../src/main/chat/service';
import type { ChatAdapter } from '../src/main/chat/adapters';
import type { ChatEvent } from '../src/shared/protocol';

const settings = { provider: 'openai' as const, model: 'm', baseURL: 'http://x/v1' };

function makeAdapter(impl: ChatAdapter['chatStream']): ChatAdapter {
  return { chatStream: impl };
}

const collect = () => {
  const events: ChatEvent[] = [];
  return { events, on: (e: ChatEvent) => events.push(e) };
};

describe('ChatService', () => {
  it('정상 스트림: chunk들 → done', async () => {
    const svc = new ChatService({
      getSettings: () => settings,
      getApiKey: () => null,
      adapterFactory: () =>
        makeAdapter(async (_m, _c, onChunk) => {
          onChunk('A');
          onChunk('B');
        }),
    });
    const { events, on } = collect();
    await svc.send([{ role: 'user', content: 'q' }], null, on);
    expect(events).toEqual([{ type: 'chunk', text: 'A' }, { type: 'chunk', text: 'B' }, { type: 'done' }]);
    expect(svc.isStreaming()).toBe(false);
  });

  it('provider none → error other (2차 방어)', async () => {
    const svc = new ChatService({ getSettings: () => ({ provider: 'none', model: '' }), getApiKey: () => null });
    const { events, on } = collect();
    await svc.send([{ role: 'user', content: 'q' }], null, on);
    expect(events).toEqual([{ type: 'error', kind: 'other' }]);
  });

  it('anthropic인데 키 없음 → error auth', async () => {
    const svc = new ChatService({
      getSettings: () => ({ provider: 'anthropic', model: 'claude-haiku-4-5' }),
      getApiKey: () => null,
    });
    const { events, on } = collect();
    await svc.send([{ role: 'user', content: 'q' }], null, on);
    expect(events).toEqual([{ type: 'error', kind: 'auth' }]);
  });

  it('동시 1개 가드: 진행 중 send는 error other, 기존 스트림 유지', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const svc = new ChatService({
      getSettings: () => settings,
      getApiKey: () => null,
      adapterFactory: () =>
        makeAdapter(async (_m, _c, onChunk) => {
          onChunk('1');
          await gate;
        }),
    });
    const a = collect();
    const first = svc.send([{ role: 'user', content: 'q' }], null, a.on);
    await new Promise((r) => setTimeout(r, 20));
    const b = collect();
    await svc.send([{ role: 'user', content: 'q2' }], null, b.on);
    expect(b.events).toEqual([{ type: 'error', kind: 'other' }]);
    expect(svc.isStreaming()).toBe(true); // 기존 스트림 살아있음
    release();
    await first;
    expect(a.events.at(-1)).toEqual({ type: 'done' });
  });

  it('cancel: abort 신호 전달 + done으로 마무리 (부분 응답 유지)', async () => {
    const svc = new ChatService({
      getSettings: () => settings,
      getApiKey: () => null,
      adapterFactory: () =>
        makeAdapter(async (_m, _c, onChunk, signal) => {
          onChunk('부분');
          await new Promise<void>((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')));
          });
        }),
    });
    const { events, on } = collect();
    const p = svc.send([{ role: 'user', content: 'q' }], null, on);
    await new Promise((r) => setTimeout(r, 20));
    svc.cancel();
    await p;
    expect(events).toEqual([{ type: 'chunk', text: '부분' }, { type: 'done' }]); // abort는 error 아님
  });

  it('스트림 오류 → classifyError kind (401 → auth)', async () => {
    const svc = new ChatService({
      getSettings: () => settings,
      getApiKey: () => null,
      adapterFactory: () =>
        makeAdapter(async () => {
          const e = new Error('unauthorized') as Error & { status: number };
          e.status = 401;
          throw e;
        }),
    });
    const { events, on } = collect();
    await svc.send([{ role: 'user', content: 'q' }], null, on);
    expect(events).toEqual([{ type: 'error', kind: 'auth' }]);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/chat-service.test.ts` → FAIL

- [ ] **Step 3: service.ts 구현**

```ts
// 채팅 스트리밍 오케스트레이션 — electron 임포트 금지. 무상태(이력은 렌더러 소유), 동시 1개.
import { AnthropicChatAdapter, OpenAIChatAdapter, type ChatAdapter } from './adapters';
import { classifyError } from '../completion/errors';
import type { ChatContext, ChatEvent, ChatMessage } from '../../shared/protocol';

export interface ChatDeps {
  getSettings(): { provider: 'none' | 'anthropic' | 'openai'; model: string; baseURL?: string };
  getApiKey(): string | null;
  adapterFactory?: (
    provider: 'anthropic' | 'openai',
    cfg: { model: string; apiKey: string | null; baseURL?: string },
  ) => ChatAdapter;
}

const defaultFactory: NonNullable<ChatDeps['adapterFactory']> = (provider, cfg) =>
  provider === 'anthropic'
    ? new AnthropicChatAdapter({ model: cfg.model, apiKey: cfg.apiKey ?? '' })
    : new OpenAIChatAdapter({ model: cfg.model, apiKey: cfg.apiKey ?? undefined, baseURL: cfg.baseURL });

export class ChatService {
  private controller: AbortController | null = null;
  private readonly factory: NonNullable<ChatDeps['adapterFactory']>;

  constructor(private deps: ChatDeps) {
    this.factory = deps.adapterFactory ?? defaultFactory;
  }

  isStreaming(): boolean {
    return this.controller !== null;
  }

  async send(messages: ChatMessage[], context: ChatContext | null, onEvent: (e: ChatEvent) => void): Promise<void> {
    if (this.controller) {
      onEvent({ type: 'error', kind: 'other' }); // 동시 1개 — 기존 스트림 유지
      return;
    }
    const settings = this.deps.getSettings();
    if (settings.provider === 'none') {
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
      const adapter = this.factory(settings.provider, {
        model: settings.model,
        apiKey,
        baseURL: settings.baseURL,
      });
      await adapter.chatStream(messages, context, (text) => onEvent({ type: 'chunk', text }), controller.signal);
      onEvent({ type: 'done' });
    } catch (e) {
      if (controller.signal.aborted) {
        onEvent({ type: 'done' }); // 취소는 오류가 아님 — 부분 응답 유지 (스펙 §4)
      } else {
        const err = e as { status?: number; message?: string };
        console.error(`[chat] provider error kind=${classifyError(e)} status=${err?.status ?? '-'}: ${err?.message ?? e}`);
        onEvent({ type: 'error', kind: classifyError(e) === 'unsuitable' ? 'other' : (classifyError(e) as 'auth' | 'transient' | 'other') });
      }
    } finally {
      this.controller = null;
    }
  }

  cancel(): void {
    this.controller?.abort();
  }
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run tests/chat-service.test.ts` → PASS

- [ ] **Step 5: main.ts 배선**

import에 `import { ChatService } from './chat/service';`, 상태 변수 `let chatService: ChatService;`. `app.whenReady()`의 completionService 생성 옆에:

```ts
  chatService = new ChatService({
    getSettings: () => settingsStore.getCompletion(),
    getApiKey: () => settingsStore.getApiKey(),
  });
```

registerIpc()에 (`ChatMessage/ChatContext` 타입 import 추가):

```ts
  ipcMain.handle('chat:send', (_e, messages: ChatMessage[], context: ChatContext | null) => {
    // fire-and-forget — 이벤트는 chat:event push로 전달 (스트리밍 동안 invoke를 붙잡지 않음)
    void chatService.send(messages, context, (event) => win?.webContents.send('chat:event', event));
  });
  ipcMain.handle('chat:cancel', () => chatService.cancel());
```

- [ ] **Step 6: preload 추가**

```ts
  chatSend: (messages: ChatMessage[], context: ChatContext | null): Promise<void> =>
    ipcRenderer.invoke('chat:send', messages, context),
  chatCancel: (): Promise<void> => ipcRenderer.invoke('chat:cancel'),
  onChatEvent: (cb: (e: ChatEvent) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, data: ChatEvent) => cb(data);
    ipcRenderer.on('chat:event', h);
    return () => ipcRenderer.removeListener('chat:event', h);
  },
```

(타입 import에 `ChatMessage, ChatContext, ChatEvent` 추가.)

- [ ] **Step 7: 빌드+전체 테스트+커밋** — `npm run build && npm test` 그린.

```bash
git add src/main/chat/service.ts src/main/main.ts src/preload/preload.ts tests/chat-service.test.ts
git commit -m "ChatService + ipc: 스트리밍 push/취소/동시 1개 가드 (completion 설정 재사용)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 렌더러 컨텍스트 빌더 (TDD) + EditorPane 상태 export

**Files:**
- Create: `src/renderer/src/chat-context.ts`
- Modify: `src/renderer/src/components/EditorPane.tsx`
- Test: `tests/chat-context.test.ts`

**Interfaces:**
- Produces:

```ts
// chat-context.ts (순수)
export interface ChatEditorState {
  path: string; languageId: string;
  selectionText: string | null; selectionStartLine: number; // 선택 없으면 0
  cursorLine: number; // 1-기반
  lines: string[]; // 전체 문서 줄
}
export function buildChatContext(state: ChatEditorState | null, signatures: string[]): ChatContext | null;
export const CURSOR_RADIUS = 30;
export const MAX_CONTEXT_SIGNATURES = 20;
// EditorPane.tsx
export function getChatEditorState(): ChatEditorState | null; // 에디터/활성 파일 없으면 null
```

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/chat-context.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildChatContext, CURSOR_RADIUS, MAX_CONTEXT_SIGNATURES, type ChatEditorState } from '../src/renderer/src/chat-context';

const mkState = (over: Partial<ChatEditorState> = {}): ChatEditorState => ({
  path: 'src/a.ts', languageId: 'typescript',
  selectionText: null, selectionStartLine: 0,
  cursorLine: 50,
  lines: Array.from({ length: 100 }, (_, i) => `line${i + 1}`),
  ...over,
});

describe('buildChatContext', () => {
  it('선택 영역 우선', () => {
    const ctx = buildChatContext(mkState({ selectionText: 'const x = 1;', selectionStartLine: 7 }), [])!;
    expect(ctx.code).toBe('const x = 1;');
    expect(ctx.isSelection).toBe(true);
    expect(ctx.startLine).toBe(7);
  });

  it('선택 없으면 커서 ±30줄', () => {
    const ctx = buildChatContext(mkState(), [])!;
    expect(ctx.isSelection).toBe(false);
    expect(ctx.startLine).toBe(50 - CURSOR_RADIUS);
    const lines = ctx.code.split('\n');
    expect(lines[0]).toBe('line20');
    expect(lines.at(-1)).toBe('line80');
  });

  it('문서 경계 절단 (파일 앞부분 커서)', () => {
    const ctx = buildChatContext(mkState({ cursorLine: 3 }), [])!;
    expect(ctx.startLine).toBe(1);
    expect(ctx.code.split('\n')[0]).toBe('line1');
  });

  it('시그니처 20개 절단 + null 상태는 null', () => {
    const sigs = Array.from({ length: 30 }, (_, i) => `sig${i}`);
    const ctx = buildChatContext(mkState(), sigs)!;
    expect(ctx.signatures).toHaveLength(MAX_CONTEXT_SIGNATURES);
    expect(buildChatContext(null, sigs)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/chat-context.test.ts` → FAIL

- [ ] **Step 3: chat-context.ts 구현**

```ts
// 채팅 컨텍스트 빌더 — 순수 모듈 (monaco 임포트 금지, 상태는 EditorPane이 추출해 전달)
import type { ChatContext } from '../../shared/protocol';

export const CURSOR_RADIUS = 30;
export const MAX_CONTEXT_SIGNATURES = 20;

export interface ChatEditorState {
  path: string;
  languageId: string;
  selectionText: string | null;
  selectionStartLine: number;
  cursorLine: number;
  lines: string[];
}

export function buildChatContext(state: ChatEditorState | null, signatures: string[]): ChatContext | null {
  if (!state) return null;
  const sigs = signatures.slice(0, MAX_CONTEXT_SIGNATURES);
  if (state.selectionText && state.selectionText.trim()) {
    return {
      path: state.path,
      languageId: state.languageId,
      code: state.selectionText,
      isSelection: true,
      startLine: state.selectionStartLine,
      signatures: sigs,
    };
  }
  const start = Math.max(1, state.cursorLine - CURSOR_RADIUS);
  const end = Math.min(state.lines.length, state.cursorLine + CURSOR_RADIUS);
  return {
    path: state.path,
    languageId: state.languageId,
    code: state.lines.slice(start - 1, end).join('\n'),
    isSelection: false,
    startLine: start,
    signatures: sigs,
  };
}
```

- [ ] **Step 4: EditorPane에 `getChatEditorState` export** (기존 `getCursorLocation` 근처):

```ts
/** 채팅 컨텍스트용 에디터 상태 (1-기반 줄). 에디터/활성 파일 없으면 null. */
export function getChatEditorState(): import('../chat-context').ChatEditorState | null {
  const st = useAppStore.getState();
  const model = editorInstance?.getModel();
  const pos = editorInstance?.getPosition();
  if (!st.activePath || !model || !pos || !editorInstance) return null;
  const sel = editorInstance.getSelection();
  const selectionText = sel && !sel.isEmpty() ? model.getValueInRange(sel) : null;
  return {
    path: st.activePath,
    languageId: model.getLanguageId(),
    selectionText,
    selectionStartLine: sel && selectionText ? sel.startLineNumber : 0,
    cursorLine: pos.lineNumber,
    lines: model.getLinesContent(),
  };
}
```

- [ ] **Step 5: 통과 확인 + 빌드** — `npx vitest run tests/chat-context.test.ts` PASS, `npm run build` 그린

- [ ] **Step 6: 커밋**

```bash
git add src/renderer/src/chat-context.ts src/renderer/src/components/EditorPane.tsx tests/chat-context.test.ts
git commit -m "채팅 컨텍스트 빌더: 선택 우선/커서 ±30줄/시그니처 절단 (순수) + 에디터 상태 export

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: ChatPanel + 우측 탭 + store + CSS

**Files:**
- Create: `src/renderer/src/components/ChatPanel.tsx`, `src/renderer/src/components/RightPanel.tsx`
- Modify: `src/renderer/src/store.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: `buildChatContext/getChatEditorState`(Task 4), preload `chatSend/chatCancel/onChatEvent`(Task 3), 기존 `getFileOutline`
- Produces: `<RightPanel />` — App에서 기존 RelationPanel 자리에 배치

- [ ] **Step 1: store.ts 확장**

상태/세터 추가:

```ts
  chatMessages: { role: 'user' | 'assistant'; content: string; error?: string }[];
  chatStreaming: boolean;
  chatContextEnabled: boolean;
  rightTab: 'relation' | 'chat';
  appendChatUser(content: string): void;
  appendChatAssistant(): void; // 빈 어시스턴트 자리
  appendChatChunk(text: string): void; // 마지막 어시스턴트에 append
  setChatError(error: string): void; // 마지막 어시스턴트에 오류 표기
  setChatStreaming(v: boolean): void;
  setChatContextEnabled(v: boolean): void;
  setRightTab(v: 'relation' | 'chat'): void;
  clearChat(): void;
```

구현:

```ts
  chatMessages: [],
  chatStreaming: false,
  chatContextEnabled: true,
  rightTab: 'relation',
  appendChatUser: (content) => set((s) => ({ chatMessages: [...s.chatMessages, { role: 'user', content }] })),
  appendChatAssistant: () => set((s) => ({ chatMessages: [...s.chatMessages, { role: 'assistant', content: '' }] })),
  appendChatChunk: (text) =>
    set((s) => {
      const msgs = s.chatMessages.slice();
      const last = msgs.at(-1);
      if (last?.role === 'assistant') msgs[msgs.length - 1] = { ...last, content: last.content + text };
      return { chatMessages: msgs };
    }),
  setChatError: (error) =>
    set((s) => {
      const msgs = s.chatMessages.slice();
      const last = msgs.at(-1);
      if (last?.role === 'assistant') msgs[msgs.length - 1] = { ...last, error };
      return { chatMessages: msgs };
    }),
  setChatStreaming: (chatStreaming) => set({ chatStreaming }),
  setChatContextEnabled: (chatContextEnabled) => set({ chatContextEnabled }),
  setRightTab: (rightTab) => set({ rightTab }),
  clearChat: () => set({ chatMessages: [], chatStreaming: false }),
```

`setProject` 리셋 객체에 `chatMessages: [], chatStreaming: false` 추가 (rightTab/chatContextEnabled은 유지 — 전역 UI 선호).

- [ ] **Step 2: ChatPanel.tsx 구현**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { buildChatContext } from '../chat-context';
import { getChatEditorState } from './EditorPane';
import type { ChatContext } from '../../../shared/protocol';

const ERROR_TEXT: Record<string, string> = {
  auth: '인증 오류 — Cmd+,에서 설정을 확인하세요',
  transient: '일시적 오류 — 잠시 후 다시 시도하세요',
  other: '오류가 발생했습니다',
};

/** 마크다운 코드 펜스만 분리해 등폭 블록으로 렌더 (구문 강조는 후속) */
function renderContent(content: string): JSX.Element[] {
  const parts = content.split(/```[\w]*\n?/);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <pre key={i} className="chat-code">{part}</pre>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function ChatPanel() {
  const messages = useAppStore((s) => s.chatMessages);
  const streaming = useAppStore((s) => s.chatStreaming);
  const contextEnabled = useAppStore((s) => s.chatContextEnabled);
  const activePath = useAppStore((s) => s.activePath);
  const [input, setInput] = useState('');
  const [provider, setProvider] = useState<string>('none');
  const listRef = useRef<HTMLDivElement>(null);

  // provider 미설정 감지 (전송 전 단락 — 스펙 §4)
  useEffect(() => {
    void window.si.getCompletionSettings().then((s) => setProvider(s.provider)).catch(() => {});
  }, []);

  // 이벤트 구독 (마운트 1회 — RightPanel이 탭 전환 시에도 유지되도록 store만 갱신)
  useEffect(() => {
    const off = window.si.onChatEvent((e) => {
      const st = useAppStore.getState();
      if (e.type === 'chunk') st.appendChatChunk(e.text);
      else if (e.type === 'done') st.setChatStreaming(false);
      else {
        st.setChatError(ERROR_TEXT[e.kind] ?? ERROR_TEXT.other);
        st.setChatStreaming(false);
      }
    });
    return off;
  }, []);

  // 새 메시지에 자동 스크롤
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    const st = useAppStore.getState();
    let context: ChatContext | null = null;
    if (contextEnabled) {
      const editorState = getChatEditorState();
      let signatures: string[] = [];
      if (editorState) {
        signatures = await window.si
          .getFileOutline(editorState.path)
          .then((o) => o.map((s) => s.signature).filter(Boolean))
          .catch(() => []);
      }
      context = buildChatContext(editorState, signatures);
    }
    st.appendChatUser(text);
    st.appendChatAssistant();
    st.setChatStreaming(true);
    setInput('');
    const history = useAppStore.getState().chatMessages
      .filter((m) => !m.error)
      .slice(0, -1) // 방금 추가한 빈 어시스턴트 제외
      .map((m) => ({ role: m.role, content: m.content }));
    void window.si.chatSend(history, context);
  };

  const cancel = () => {
    void window.si.chatCancel();
    const st = useAppStore.getState();
    st.appendChatChunk('\n(중단됨)');
  };

  const editorState = contextEnabled ? getChatEditorState() : null;
  const contextLabel = editorState
    ? `컨텍스트: ${editorState.path}${editorState.selectionText ? ` (선택 ${editorState.selectionText.split('\n').length}줄)` : ''}`
    : activePath && contextEnabled
      ? `컨텍스트: ${activePath}`
      : '컨텍스트 없음';

  if (provider === 'none') {
    return <div className="hint">AI provider가 설정되지 않았습니다. Cmd+,에서 설정하세요.</div>;
  }

  return (
    <div className="chat-panel">
      <div className="chat-toolbar">
        <label className="chat-context-toggle">
          <input
            type="checkbox"
            checked={contextEnabled}
            onChange={(e) => useAppStore.getState().setChatContextEnabled(e.target.checked)}
          />
          <span className="chat-context-label">{contextLabel}</span>
        </label>
        <button className="rename-btn" onClick={() => useAppStore.getState().clearChat()}>새 대화</button>
      </div>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && <div className="hint">코드에 대해 물어보세요.</div>}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-${m.role}`}>
            <div className="chat-content">{renderContent(m.content)}</div>
            {m.error && <div className="chat-error">{m.error}</div>}
          </div>
        ))}
        {streaming && <div className="chat-streaming">…</div>}
      </div>
      <div className="chat-input-row">
        <textarea
          rows={3}
          value={input}
          placeholder="질문 입력 (Enter 전송, Shift+Enter 줄바꿈)"
          disabled={streaming}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {streaming ? (
          <button className="rename-btn" onClick={cancel}>중단</button>
        ) : (
          <button className="rename-btn primary" onClick={() => void send()} disabled={!input.trim()}>전송</button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: RightPanel.tsx 구현**

```tsx
import { useAppStore } from '../store';
import { RelationPanel } from './RelationPanel';
import { ChatPanel } from './ChatPanel';

export function RightPanel() {
  const tab = useAppStore((s) => s.rightTab);
  const setTab = useAppStore((s) => s.setRightTab);
  return (
    <div className="panel">
      <div className="panel-title right-tabs">
        <button className={tab === 'relation' ? 'active' : ''} onClick={() => setTab('relation')}>Relation</button>
        <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>AI 채팅</button>
      </div>
      <div className="panel-body">{tab === 'relation' ? <RelationPanel /> : <ChatPanel />}</div>
    </div>
  );
}
```

**구현 주의**: RelationPanel이 자체적으로 `.panel`/`.panel-title` 래퍼를 갖고 있으면(App에서의 기존 사용 형태 확인) 중첩되지 않게 조정 — RightPanel이 래퍼를 소유하고 RelationPanel은 내용만 렌더하도록 하거나, RelationPanel 기존 구조를 유지한 채 탭 헤더만 위에 얹는다. 기존 렌더 결과(스크린샷/E2E 셀렉터 `.relation-*`)가 깨지지 않는 쪽을 선택하고 보고서에 기록.

- [ ] **Step 4: App.tsx 수정** — 기존 `<RelationPanel />` 배치 지점을 `<RightPanel />`로 교체 (import 교체 포함). 추가로 App의 프로젝트 열기 경로(openProject 함수)에 `void window.si.chatCancel();`를 넣어 프로젝트 전환 시 진행 중 스트림을 중단한다 (스펙 §4-5 — store 리셋은 setProject가 담당).

- [ ] **Step 5: theme.css 추가**

```css
/* ── AI 채팅 (Plan 8) ── */
.right-tabs { display: flex; gap: 2px; padding: 0; }
.right-tabs button {
  flex: 1; padding: 4px 8px; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase;
  background: none; border: none; color: var(--fg-dim); cursor: pointer;
  border-bottom: 2px solid transparent;
}
.right-tabs button.active { color: var(--fg); border-bottom-color: var(--accent); }
.chat-panel { display: flex; flex-direction: column; height: 100%; }
.chat-toolbar {
  flex: none; display: flex; align-items: center; justify-content: space-between;
  gap: 4px; padding: 4px 8px; border-bottom: 1px solid var(--border);
}
.chat-context-toggle { display: flex; align-items: center; gap: 4px; min-width: 0; cursor: pointer; }
.chat-context-label {
  font-size: 11px; color: var(--fg-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.chat-messages { flex: 1; overflow: auto; padding: 8px; user-select: text; }
.chat-msg { margin-bottom: 8px; padding: 6px 8px; border-radius: 4px; white-space: pre-wrap; word-break: break-word; }
.chat-user { background: var(--bg-active); }
.chat-assistant { background: var(--bg-panel); border: 1px solid var(--border); }
.chat-code {
  display: block; margin: 4px 0; padding: 6px; overflow-x: auto;
  background: var(--bg); border: 1px solid var(--border); border-radius: 3px;
  font: 12px/1.4 ui-monospace, 'SF Mono', Menlo, monospace;
}
.chat-error { margin-top: 4px; color: var(--warn); font-size: 11px; }
.chat-streaming { color: var(--fg-dim); padding: 2px 8px; }
.chat-input-row { flex: none; display: flex; gap: 4px; padding: 6px; border-top: 1px solid var(--border); }
.chat-input-row textarea {
  flex: 1; resize: none; background: var(--bg); color: var(--fg);
  border: 1px solid var(--border); border-radius: 3px; padding: 4px 6px; font: inherit;
}
```

- [ ] **Step 6: 빌드 + 전체 테스트 + 커밋** — `npm run build && npm test` 그린.

```bash
git add src/renderer/src/components/ChatPanel.tsx src/renderer/src/components/RightPanel.tsx src/renderer/src/store.ts src/renderer/src/App.tsx src/renderer/src/theme.css
git commit -m "AI 채팅 UI: 우측 Relation|채팅 탭, 스트리밍 메시지, 컨텍스트 토글/표시, 중단/새 대화

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 통합 테스트 — fake OpenAI SSE 서버 실왕복

**Files:**
- Create: `tests/chat-openai-integration.test.ts`

**Interfaces:** Consumes `OpenAIChatAdapter`(실제 openai SDK 클라이언트 경로)

- [ ] **Step 1: 테스트 작성** (기존 `tests/completion-openai-integration.test.ts` 패턴 참조 — node http 서버)

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import { OpenAIChatAdapter } from '../src/main/chat/adapters';

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
      const timer = setInterval(() => {
        if (i < chunks.length) {
          res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: chunks[i] }, finish_reason: null }] })}\n\n`);
          i++;
        } else {
          res.write('data: [DONE]\n\n');
          res.end();
          clearInterval(timer);
        }
      }, 30);
      req.on('close', () => {
        abortObserved = true;
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
  });

  it('abort 시 스트림 중단 (연결 종료 관측)', async () => {
    abortObserved = false;
    const adapter = new OpenAIChatAdapter({ model: 'fake-model', apiKey: 'k', baseURL });
    const ac = new AbortController();
    const chunks: string[] = [];
    const p = adapter.chatStream([{ role: 'user', content: 'q' }], null, (t) => {
      chunks.push(t);
      if (chunks.length === 1) ac.abort(); // 첫 청크에서 중단
    }, ac.signal);
    await expect(p).rejects.toThrow(); // SDK abort 예외
    await new Promise((r) => setTimeout(r, 100));
    expect(abortObserved).toBe(true);
    expect(chunks.length).toBeLessThan(3);
  }, 10_000);
});
```

- [ ] **Step 2: 실행/통과** — `npx vitest run tests/chat-openai-integration.test.ts` → PASS (SSE 포맷/SDK 동작이 기대와 다르면 fake 서버 응답 형태를 실제 SDK가 수용하는 형태로 조정하고 보고서에 기록 — "스트리밍 청크 수신 + abort 중단" 의도 유지)

- [ ] **Step 3: 전체 스위트 + 커밋** — `npm test` 그린.

```bash
git add tests/chat-openai-integration.test.ts
git commit -m "채팅 통합 테스트: fake OpenAI SSE 서버 스트리밍 실왕복 + abort 중단

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: E2E — 채팅 왕복 + 새 대화

**Files:**
- Create: `tests/e2e/chat.spec.ts`

- [ ] **Step 1: 스펙 작성** — fake OpenAI SSE 서버를 테스트 안에서 띄우고, SI_USER_DATA에 설정을 심어 구동:

```ts
import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

function startFakeServer(): Promise<{ server: http.Server; baseURL: string }> {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const t of ['테스트', ' 응답', '입니다']) {
        res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: t }, finish_reason: null }] })}\n\n`);
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

test('AI 채팅: 질문 → 스트리밍 응답 → 새 대화 리셋', async () => {
  const { server, baseURL } = await startFakeServer();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-chat-'));
  const proj = path.join(work, 'proj');
  const ud = path.join(work, 'ud');
  fs.mkdirSync(proj);
  fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(proj, 'a.ts'), 'const x = 1;\n');
  fs.writeFileSync(
    path.join(ud, 'settings.json'),
    JSON.stringify({ completion: { provider: 'openai', model: 'fake', baseURL, apiKey: 'k' } }),
  );

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: ud },
  });
  try {
    const page = await app.firstWindow();
    const item = page.locator('.tree-item', { hasText: 'a.ts' });
    await expect(item).toBeVisible({ timeout: 15_000 });
    await item.click();

    // AI 채팅 탭 전환 → 질문 전송
    await page.locator('.right-tabs button', { hasText: 'AI 채팅' }).click();
    const input = page.locator('.chat-input-row textarea');
    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.fill('x가 뭐야?');
    await input.press('Enter');

    // 스트리밍 응답 렌더 확인
    await expect(page.locator('.chat-assistant')).toContainText('테스트 응답입니다', { timeout: 15_000 });
    await expect(page.locator('.chat-user')).toContainText('x가 뭐야?');

    // 새 대화 → 리셋
    await page.locator('.chat-toolbar button', { hasText: '새 대화' }).click();
    await expect(page.locator('.chat-msg')).toHaveCount(0);
  } finally {
    await app.close();
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실행** — `npm run test:e2e` → 전체 E2E(기존 5 + 신규 1) PASS. 셀렉터가 구현과 다르면 구현 쪽 관례에 맞춰 조정.

- [ ] **Step 3: 휴지 복원 + 커밋** — `npm run rebuild:node && npm test` 전체 통과.

```bash
git add tests/e2e/chat.spec.ts
git commit -m "E2E: AI 채팅 스트리밍 왕복 + 새 대화 리셋

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review (작성 후 점검 결과)

1. **스펙 커버리지**: §1 채팅 패널/컨텍스트 토글/ChatService/세션 메모리(Task 5·4·3·5) / §3 구조 전 파일 매핑 / §4 흐름 1~6(전송·단락·청크·done/error/cancel·프로젝트 리셋·동시 1개 — Task 3·5) / §5 단위(1·2·3·4)·통합(6)·E2E(7). 프로젝트 전환 시 진행 중 cancel: Task 5 Step 1의 setProject 리셋 + App의 openProject에서 `window.si.chatCancel()` 호출이 누락 → **보완**: Task 5 Step 4에 "App.tsx의 openProject 경로에 `void window.si.chatCancel();` 추가 (프로젝트 전환 시 진행 중 스트림 중단, 스펙 §4-5)"를 포함한다.
2. **Placeholder**: 없음. Task 2/6의 "SDK 실형태와 다르면 조정" 지시는 조정 조건·의도·기록 요구를 명시한 완결 지시.
3. **타입 일관성**: `ChatMessage/ChatContext/ChatEvent`(Task 1 ↔ 2·3·5), `ChatAdapter.chatStream` 시그니처(2 ↔ 3), `ChatEditorState/buildChatContext`(4 ↔ 5), preload 함수명 `chatSend/chatCancel/onChatEvent`(3 ↔ 5), store 세터명(5 내부 일관) 확인.
