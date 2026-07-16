# Plan 5 (v1.5): AI 코드 자동완성 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monaco 고스트 텍스트 인라인 완성 — Anthropic/OpenAI(로컬 LLM) 어댑터, 심볼 DB 컨텍스트, safeStorage 키 관리. additive 모듈 (인덱서/DB 무변경).

**Architecture:** 렌더러 InlineCompletionsProvider(내장 debounceDelayMs 300) → ipc `completion:request` → main CompletionService(설정/아웃라인 캐시/어댑터) → SDK 비스트리밍 호출. 스펙: `docs/superpowers/specs/2026-07-17-plan5-ai-completion-design.md` (결정 기록 필독 — Monaco 0.55 `disposeInlineCompletions` 필수, 비스트리밍 근거 등).

**Tech Stack:** 신규 **dependencies**(devDeps 아님 — 패키징에 포함 필요): `@anthropic-ai/sdk`, `openai`. 둘 다 순수 JS — rebuild 스크립트 변경 불필요 (비평 검증됨).

## Global Constraints

- **additive**: `src/indexer/**`, `src/shared/ignore.ts`, 스키마 등 무변경. 코어 기능은 provider 미설정 시 완전 무영향.
- **API 키는 main 밖으로 절대 나가지 않음**: 렌더러/preload는 hasApiKey(boolean)만. decrypt 실패는 hasApiKey:false 강등(크래시 금지). safeStorage 미지원 시 키 저장 거부.
- Anthropic 어댑터: 비스트리밍 `messages.create`, `timeout: 10_000`(ms), `maxRetries: 0`, 기본 모델 `claude-haiku-4-5`, 프리필 금지(시스템 프롬프트+stop_sequences).
- 오류 분류는 SDK 타입드 예외/status 기반 — 메시지 문자열 매칭 금지.
- 키스트로크 핫패스에서 인덱서 RPC 금지 — 아웃라인은 main 캐시(fileIndexed 릴레이 시 무효화).
- ABI/휴지 규칙 유지 (npm test=node ABI). 기존 테스트 무회귀. 커밋 한국어 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`, 명시적 add.

**알려진 한계 (의도):** 스트리밍 고스트 텍스트 없음(Monaco API 단발 반환), 실 API E2E 없음(키 필요 — fake 서버 통합 테스트로 대체), 다중 완성 후보 없음.

---

### Task 1: 설정 저장소(safeStorage) + SettingsOverlay

**Files:**
- Create: `src/main/settings.ts`
- Create: `src/renderer/src/components/SettingsOverlay.tsx`
- Modify: `src/shared/protocol.ts` (CompletionSettings), `src/main/main.ts` (ipc), `src/preload/preload.ts`, `src/renderer/src/store.ts` (settingsOpen), `src/renderer/src/App.tsx` (마운트+Cmd/Ctrl+,), `src/renderer/src/theme.css`, `package.json` (deps 설치는 Task 2에서)
- Test: `tests/settings-store.test.ts`

**Interfaces:**
- protocol.ts:

```ts
export interface CompletionSettings {
  provider: 'none' | 'anthropic' | 'openai';
  model: string;
  baseURL?: string;
  hasApiKey: boolean;
}
```

- `src/main/settings.ts` — safeStorage는 **주입 가능** (vitest에 electron 없음):

```ts
export interface SettingsCrypto {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(enc: Buffer): string;
}

export interface StoredCompletionSettings {
  provider: 'none' | 'anthropic' | 'openai';
  model: string;
  baseURL?: string;
  apiKeyEnc?: string; // base64(safeStorage.encryptString)
}

export class SettingsStore {
  constructor(baseDir: string, crypto: SettingsCrypto) {}
  getCompletion(): StoredCompletionSettings            // 파일 없음/손상 → 기본값 {provider:'none', model:''}
  setCompletion(s: { provider; model; baseURL? }, apiKey?: string): void
  // apiKey가 주어졌을 때만 암호화 갱신(빈 문자열은 키 삭제); crypto.isAvailable() false에서 apiKey 저장 시도 → throw
  getApiKey(): string | null                            // apiKeyEnc 없음/decrypt 실패 → null (try/catch)
  toPublic(): CompletionSettings                        // hasApiKey = getApiKey() !== null
}
```

  저장 위치: `baseDir/settings.json`, `{ completion: StoredCompletionSettings }` (Persistence 클래스와 별개 파일이되 같은 스타일 — JSON 직렬화, mkdir recursive).
- main.ts: `const settingsCrypto: SettingsCrypto = { isAvailable: () => safeStorage.isEncryptionAvailable(), encrypt: (s) => safeStorage.encryptString(s), decrypt: (b) => safeStorage.decryptString(b) };` + `settingsStore = new SettingsStore(app.getPath('userData'), settingsCrypto)`. ipc: `settings:completion:get` → `toPublic()`; `settings:completion:set (s, apiKey?)` → try `setCompletion` / throw는 그대로 렌더러로 (오버레이가 오류 표시).
- preload: `getCompletionSettings(): Promise<CompletionSettings>`, `setCompletionSettings(s: {provider; model; baseURL?}, apiKey?: string): Promise<void>`.
- SettingsOverlay: store `settingsOpen` (setProject 리셋 불포함 — 전역 설정), Cmd/Ctrl+, 토글(App keydown, 캡처, preventDefault). 폼: provider select(none/anthropic/openai), model input(placeholder: anthropic→`claude-haiku-4-5`, openai→`로컬: Qwen2.5-Coder 계열 권장`), baseURL input(openai일 때만 표시), API key password input(placeholder "변경 시에만 입력 — 저장된 키는 표시되지 않음"). 저장 버튼 → `setCompletionSettings(..., apiKey || undefined)` → 성공 시 닫기, 실패(safeStorage 미지원 등) 시 오류 문구. SearchOverlay 패턴(백드롭/Esc) 재사용. 저장 성공 후 렌더러 설정 캐시 갱신은 Task 4에서 배선 — 이 태스크에선 저장/로드 UI 완결이 목표.

- [ ] **Step 1: settings-store TDD** — `tests/settings-store.test.ts`: fake crypto(prefix 문자열 암복호화 + isAvailable 스위치)로: (a) set→get 라운드트립+toPublic hasApiKey true, (b) apiKey 미전달 set은 기존 키 유지, (c) 빈 문자열 apiKey는 키 삭제, (d) decrypt throw → getApiKey null + toPublic hasApiKey false, (e) isAvailable false에서 apiKey 저장 → throw, (f) 파일 없음 → 기본값. RED→GREEN.
- [ ] **Step 2: main/preload/UI 구현** (위 계약대로)
- [ ] **Step 3: `npm run build && npm test` green → 커밋** ("AI 완성 설정: safeStorage 키 저장 + 설정 오버레이(Cmd/Ctrl+,)")

---

### Task 2: ProviderAdapter 2종 + 프롬프트/후처리

**Files:**
- Create: `src/main/completion/prompt.ts` (순수), `src/main/completion/anthropic-adapter.ts`, `src/main/completion/openai-adapter.ts`, `src/main/completion/errors.ts`
- Modify: `package.json` (`npm i @anthropic-ai/sdk openai` — **dependencies**)
- Test: `tests/completion-prompt.test.ts`, `tests/completion-adapters.test.ts`, `tests/completion-openai-integration.test.ts`

**Interfaces:**
- shared/protocol.ts에 추가:

```ts
export interface CompletionContext { path: string; languageId: string; prefix: string; suffix: string }
export interface CompletionResult { text: string | null; error?: { kind: 'auth' | 'transient' | 'other'; message: string } }
```

- prompt.ts (순수 — electron/SDK 임포트 금지):

```ts
export interface BuiltContext extends CompletionContext { symbolSignatures: string[] }
export function buildSystemPrompt(ctx: BuiltContext): string
// "코드 자동완성 엔진... 커서 위치에 이어질 코드만... 설명/마크다운 펜스 금지, 보통 1~5줄" + 언어/경로 + 시그니처 목록(있을 때만)
export function buildUserPrompt(ctx: BuiltContext): string
// prefix 마지막 ≤50줄 + "<CURSOR>" + suffix 앞 ≤10줄 (잘라내기는 여기서 최종 보증)
export function postProcess(raw: string, prefixTail: string): string | null
// 마크다운 펜스 제거, raw 선두가 prefixTail의 접미와 중복되면 중복 제거, 공백뿐이면 null
export const STOP_SEQUENCES = ['\n\n\n', '```'];
export const MAX_COMPLETION_TOKENS = 160;
```

- errors.ts: `export function classifyError(e: unknown): 'auth' | 'transient' | 'other'` — 우선 connection 계열(`Anthropic.APIConnectionError`/`OpenAI.APIConnectionError` instanceof) → transient; 그 외 `(e as { status?: number }).status`: 401/403 → auth, 429/5xx → transient; 나머지 other. (SDK 예외는 status를 노출 — 문자열 매칭 금지.)
- 어댑터 (클라이언트 주입 가능):

```ts
export interface ProviderAdapter { complete(ctx: BuiltContext): Promise<string | null> }

export class AnthropicAdapter implements ProviderAdapter {
  constructor(cfg: { model: string; apiKey: string }, client?: /* Anthropic-호환 최소 인터페이스 */)
  // 기본: new Anthropic({ apiKey, timeout: 10_000, maxRetries: 0 })
  // complete: client.messages.create({ model, max_tokens: MAX_COMPLETION_TOKENS,
  //   system: buildSystemPrompt(ctx), messages: [{ role: 'user', content: buildUserPrompt(ctx) }],
  //   stop_sequences: STOP_SEQUENCES })
  // → content에서 type==='text' 블록 텍스트 → postProcess
}

export class OpenAIAdapter implements ProviderAdapter {
  constructor(cfg: { model: string; apiKey?: string; baseURL?: string }, client?)
  // 기본: new OpenAI({ apiKey: cfg.apiKey ?? 'local', baseURL: cfg.baseURL, timeout: 10_000, maxRetries: 0 })
  // complete: client.chat.completions.create({ model, max_tokens, stop: STOP_SEQUENCES,
  //   messages: [{ role: 'system', ... }, { role: 'user', ... }] }) → choices[0]?.message?.content → postProcess
}
```

- [ ] **Step 1: `npm i @anthropic-ai/sdk openai`** (dependencies — 패키징 포함 확인 목적. lockfile 커밋)
- [ ] **Step 2: prompt/postProcess TDD** — 펜스 제거(```lang\n...\n``` → 내부), prefix 중복 제거(prefix가 `foo.ba`로 끝나고 raw가 `ba r()`로 시작하는 케이스 아님 — 정확히는 raw 선두 substring이 prefixTail의 접미와 일치할 때 잘라냄; 케이스 3개), 공백만 → null, buildUserPrompt 줄수 절단.
- [ ] **Step 3: 어댑터 TDD** — fake 클라이언트가 받은 파라미터(model/max_tokens/system 존재/stop_sequences) 단언 + 텍스트 반환 경로 + classifyError(상태 401/429/500/undefined + APIConnectionError 인스턴스는 생성 가능하면 실인스턴스, 아니면 별도 케이스로 기록).
- [ ] **Step 4: OpenAI fake 서버 통합** — node `http.createServer`로 `/v1/chat/completions`에 OpenAI 호환 JSON 응답(`{choices:[{message:{content:"return 42;"}}]}`), 임의 포트 listen → `OpenAIAdapter({model:'x', baseURL:'http://127.0.0.1:PORT/v1'})` 실왕복 → "return 42;" 단언 → 서버 close. (baseURL 로컬 LLM 경로 실증.)
- [ ] **Step 5: `npm run build && npm test` green → 커밋** ("AI 완성 어댑터: Anthropic/OpenAI(로컬 baseURL) + 프롬프트·후처리·오류 분류")

---

### Task 3: ContextBuilder + CompletionService + ipc

**Files:**
- Create: `src/main/completion/service.ts`
- Modify: `src/main/main.ts` (ipc completion:request + fileIndexed 릴레이 시 아웃라인 캐시 무효화 훅), `src/preload/preload.ts` (requestCompletion)
- Test: `tests/completion-service.test.ts`

**Interfaces:**

```ts
export class CompletionService {
  constructor(deps: {
    getSettings(): StoredCompletionSettings;
    getApiKey(): string | null;
    getOutline(path: string): Promise<Array<{ signature: string }>>; // 인덱서 rpc 래퍼 — 실패 시 throw 허용
    adapterFactory?: (provider, cfg) => ProviderAdapter;             // 테스트 주입
  })
  invalidateOutline(path: string): void      // main의 sendIndexerEvent에서 fileIndexed(path) 릴레이 시 호출
  invalidateAdapter(): void                  // settings:completion:set 후 호출 (어댑터/설정 캐시 리셋)
  async request(ctx: CompletionContext): Promise<CompletionResult>
}
```

- request 동작: provider none/키 필요한데 없음 → `{ text: null }` (오류 아님 — 렌더러가 이미 단락하지만 방어). 아웃라인: path 캐시 히트 시 재사용, 미스 시 `getOutline` try/catch(실패 → 시그니처 []) 후 캐시(상한 20개 시그니처). 어댑터: 설정 스냅샷 기준 캐시(설정 변경 시 invalidateAdapter). 어댑터 호출 오류 → `classifyError`로 `{ text: null, error: { kind, message } }`.
- main.ts: `ipcMain.handle('completion:request', (_e, ctx) => completionService.request(ctx))`; `sendIndexerEvent` 내부에서 `event === 'fileIndexed' && payload.path` → `completionService.invalidateOutline(path)`; `settings:completion:set` 성공 후 `invalidateAdapter()`. getOutline 구현: `indexer.rpc.request('getFileOutline', { path }, { timeoutMs: 5_000 })` (인덱서 없으면 throw → catch로 생략).
- preload: `requestCompletion(ctx: CompletionContext): Promise<CompletionResult>`.

- [ ] **Step 1: TDD** — fake deps로: (a) provider none → text null·어댑터 미호출, (b) 아웃라인 캐시 히트(두 번째 요청에 getOutline 1회만), (c) invalidateOutline 후 재조회, (d) getOutline throw → 시그니처 [] 로 어댑터 호출 지속, (e) 어댑터 throw(status 401) → error.kind 'auth', (f) 설정 변경(invalidateAdapter) 후 adapterFactory 재호출.
- [ ] **Step 2: main/preload 배선 → `npm run build && npm test` green → 커밋** ("AI 완성 서비스: 컨텍스트 빌드(아웃라인 캐시) + completion:request")

---

### Task 4: 렌더러 InlineCompletionsProvider + 비활성 정책

**Files:**
- Create: `src/renderer/src/completion-provider.ts`
- Modify: `src/renderer/src/components/EditorPane.tsx` (`inlineSuggest: { enabled: true }` 옵션 + provider 등록 1회), `src/renderer/src/components/StatusBar.tsx` (completionStatus 표시), `src/renderer/src/store.ts` (completionStatus), `src/renderer/src/components/SettingsOverlay.tsx` (저장 성공 시 설정 캐시 갱신 + 비활성 해제 호출)

**Interfaces (completion-provider.ts):**

```ts
export function registerCompletionProvider(monaco): void   // 앱 수명 1회, EditorPane mount effect에서
export function refreshCompletionSettings(): Promise<void> // 설정 캐시 재조회 + auth 비활성 해제 (SettingsOverlay 저장 후 호출)
```

- provider 객체: `{ debounceDelayMs: 300, provideInlineCompletions, disposeInlineCompletions() {} }` — **disposeInlineCompletions는 필수 멤버** (Monaco 0.55; freeInlineCompletions 아님).
- provideInlineCompletions:
  1. 캐시된 설정 `provider === 'none'` 또는 `!hasApiKey`(anthropic) 또는 비활성 상태(auth 플래그 / transient 백오프 `Date.now() < disabledUntil`) → `{ items: [] }` (IPC 없음)
  2. prefix ≤50줄 / suffix ≤10줄 추출 (`model.getValueInRange`), path는 `model.uri.path`의 선두 '/' 제거(EditorPane uri 규약), languageId는 `model.getLanguageId()`
  3. 세대 토큰 증가 → `window.si.requestCompletion(ctx)` → 응답 시 `token.isCancellationRequested || gen !== 현재` → 빈 결과
  4. `error`: kind 'auth' → authDisabled=true + store.completionStatus 'AI 완성: 인증 오류 — 설정 확인'; 'transient'/'other' → disabledUntil = now+60_000 + status 'AI 완성: 일시 중지'; 빈 결과
  5. 성공: status null 복구, `{ items: [{ insertText: res.text }] }` (text null이면 빈 결과)
- StatusBar: `completionStatus`를 error 톤으로 표시 (기존 error 옆).
- 설정 캐시: 모듈 변수. `registerCompletionProvider` 시 1회 로드 + `refreshCompletionSettings`로 갱신.

- [ ] **Step 1: 구현** (렌더러 glue — 단위 테스트 없음 명시; 로직 대부분은 Task 2/3 테스트로 커버)
- [ ] **Step 2: `npm run build && npm test` green** (typecheck 게이트 포함 — provider 타입이 monaco.d.ts와 정합해야 통과)
- [ ] **Step 3: 커밋** ("AI 완성 렌더러: 고스트 텍스트 provider(debounce 300ms) + 비활성 정책/상태바")

---

### Task 5: 마감 — 검증 + todo.md

**Files:**
- Modify: `todo.md`

- [ ] **Step 1: 전체 검증** — `npm run build && npm test` green; `npm run test:e2e` **3 specs 회귀 확인** (완성 기능은 provider none 기본이라 기존 E2E에 영향 없어야 함 — 실패 시 원인 수정); `npm run rebuild:node && npm test` 휴지 복구.
- [ ] **Step 2: 수동 스모크 (가능 범위)** — ABI dance로 앱 기동 → Cmd/Ctrl+, 오버레이 열림/저장 라운드트립(hasApiKey 반영) 확인. 실 API 호출은 키 필요라 제외 — 보고서에 명시.
- [ ] **Step 3: todo.md** — Plan 5(v1.5) 섹션 완료 표기 (한계 명시: 스트리밍 없음, 실 API 자동화 검증 없음). v2 백로그는 그대로. "다음 단계" 노트: v2 항목은 착수 전 사용자 결정 필요.
- [ ] **Step 4: 커밋** ("AI 코드 자동완성 마감: 검증 + todo.md v1.5 완료 표기")
