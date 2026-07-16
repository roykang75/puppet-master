# Plan 5 (v1.5): AI 코드 자동완성 — 설계 문서

**작성일**: 2026-07-17
**상태**: 자율 모드 승인 (사용자 위임 — 비평 에이전트 리뷰로 게이트 대체)
**상위 스펙**: `2026-07-15-sourceinsight-clone-design.md` §7 (additive 모듈 — 인덱서/심볼 DB 무변경)
**선행**: Plan 4 (MVP v1 완성, main 병합 `e8eb9fb`)

## 1. 범위

포함:
- **설정**: SettingsOverlay (Cmd/Ctrl+,) — provider(none/anthropic/openai)/model/baseURL/API 키. main이 `userData/settings.json`에 저장, **API 키는 Electron safeStorage로 암호화** (평문 금지). provider 미설정 시 완성 기능 완전 비활성 (코어 무영향)
- **ProviderAdapter 2종** (main): AnthropicAdapter (`@anthropic-ai/sdk`), OpenAIAdapter (`openai` SDK — 로컬 LLM은 baseURL 변경만으로 지원)
- **ContextBuilder** (main): 커서 앞/뒤 코드 + 심볼 DB 시그니처(파일 아웃라인)를 프롬프트에 포함
- **CompletionService** (main): 어댑터 선택/호출/오류 처리, ipc `completion:request`
- **렌더러**: Monaco `InlineCompletionsProvider`(고스트 텍스트) — 300ms 디바운스, 새 입력 시 이전 요청 취소, provider 오류 시 조용히 비활성 + 상태바 표시 (스펙 §9)

제외:
- 스트리밍 고스트 텍스트 (아래 결정 기록), 심볼 자동완성(비-AI, v2), AI 채팅(v2), 다중 completion 후보

## 2. 결정 기록 (자율 모드 — 근거 포함. claude-api 스킬로 SDK 사용법 검증됨)

| 결정 | 선택 | 근거 |
|---|---|---|
| **비스트리밍** (상위 스펙 §7 "토큰 스트림"에서 의도된 편차) | `messages.create` 단발 호출, max_tokens ≤ 160 | Monaco InlineCompletionsProvider는 항목 배열을 **한 번에** 반환하는 API — 점진 렌더 경로가 없어 스트리밍 이득이 0. 짧은 완성 + 300ms 디바운스라 지연 이득도 미미. 스트리밍은 후속(§7의 어댑터 인터페이스는 유지 가능) |
| 기본 모델 (Anthropic) | `claude-haiku-4-5` (사용자 설정 변경 가능) | 상위 스펙 §7 명시 (지연시간 우선). 유효 alias 확인됨 |
| 프리필 금지 | 시스템 프롬프트 "커서 위치에 이어질 코드만 출력, 설명/마크다운 금지" + `stop_sequences: ["\n\n\n", "```"]` | 상위 스펙 §7 명시 + 최신 모델 프리필 400 |
| Anthropic 클라이언트 옵션 | `timeout: 10_000`(ms — TS SDK는 ms 단위), `maxRetries: 0` | 인라인 완성은 재시도 무의미 (다음 키 입력이 새 요청). 스킬 확인: TS timeout은 밀리초 |
| 오류 분류 | SDK 타입드 예외 체인 (`AuthenticationError`→키 문제로 비활성+안내 / `APIConnectionError`·`RateLimitError`→일시 비활성 / 기타 `APIError`) — 문자열 매칭 금지 | claude-api 스킬 오류 처리 규약 |
| OpenAIAdapter | 공식 `openai` SDK, `chat.completions.create` 비스트리밍, `baseURL` 설정 시 로컬 LLM (Ollama/LM Studio/llama.cpp) | 상위 스펙 §7 — 별도 로컬 어댑터 불필요 |
| API 키 저장 | main 전용: `safeStorage.encryptString` → base64를 settings.json에. 렌더러엔 **키 존재 여부(boolean)만** 노출, 키 값은 절대 반환 안 함. **decrypt 실패(다른 머신/OS 사용자로 복사된 settings) 시 try/catch로 hasApiKey:false 강등** — 크래시 금지, 재입력 유도 | 상위 스펙 §7 평문 금지. safeStorage 미지원 시 저장 거부+안내 (평문 폴백 금지). Linux basic_text 백엔드는 "지원"으로 간주(문서화) |
| 설정 캐시 | 렌더러는 설정을 로드 시 캐시하고 `setCompletionSettings` 후 재조회 — `provider:'none'`이면 provider 진입 즉시 단락 (키스트로크당 IPC 없음) | 비평 반영 |
| inlineSuggest 옵션 | EditorPane의 `monaco.editor.create` 옵션에 `inlineSuggest: { enabled: true }` 명시 | 고스트 텍스트 렌더 필수 조건 (비평 확인) |
| 로컬 기본 모델 안내 | SettingsOverlay의 openai provider placeholder에 로컬 권장 모델(Qwen2.5-Coder 계열) 안내 문구 | 상위 스펙 §7 로컬 LLM 서사 완결 |
| 설정 파일 | `userData/settings.json` — `{ completion: { provider, model, baseURL?, apiKeyEnc? } }` | 프로젝트 무관 전역 설정이라 프로젝트 해시 디렉터리와 분리 |
| ContextBuilder 입력 | 커서 앞 ≤50줄 + 커서 뒤 ≤10줄 (렌더러가 모델에서 추출해 전달) + 현재 파일 심볼 시그니처 ≤20개 (main이 인덱서 `getFileOutline`으로 조회, 인덱서 미기동 시 생략) | 심볼 DB 보유가 차별점 (§7). 파일 단위 1회 조회로 지연 최소화 |
| 디바운스/취소 | **Monaco 내장 `debounceDelayMs: 300`** (provider 옵션, 0.55 확인됨) — 수동 타이머 없음. `CancellationToken` 존중(취소 시 즉시 빈 결과), 늦은 응답은 세대 비교로 폐기 | 비평 반영 — 내장 디바운스 재사용. provider 진입 시 설정 오프면 IPC 전에 단락 |
| **dispose 계약 (비평 major)** | provider는 `disposeInlineCompletions(completions)` **필수 멤버** 구현 (no-op 본문 가능) — Monaco 0.55에서 `freeInlineCompletions`는 존재하지 않음 (구명칭) | monaco.d.ts 검증 — 누락 시 컴파일 실패 |
| **아웃라인 캐시 (비평 major)** | main CompletionService가 path별 아웃라인 캐시. **무효화: main이 fileIndexed 이벤트를 릴레이할 때 해당 path 캐시 제거** (기존 sendIndexerEvent 경로에 훅). 인덱서 미기동/오류 시 try/catch로 시그니처 생략 | 키스트로크 핫패스에서 인덱서 RPC 왕복 제거 — 타이핑 경험 보호 |
| 비활성 정책 | provider 미설정=기능 오프. 인증 오류=설정 변경까지 오프(상태바 "AI 완성: 키 오류"). 네트워크/율 제한=60초 백오프 오프(상태바 표시) | 스펙 §9 "완성 기능만 조용히 비활성 + 상태바" |
| Monaco 등록 | `monaco.languages.registerInlineCompletionsProvider(지원 언어들, provider)` — provider의 `provideInlineCompletions`가 디바운스+설정 확인 후 ipc 호출 | Monaco 표준 경로. `editor.inlineSuggest.enabled: true` 옵션 |

## 3. 데이터 흐름

1. 타이핑 → Monaco가 `provideInlineCompletions(model, position, ctx, token)` 호출
2. provider: 설정 오프/비활성 상태면 즉시 빈 결과. 아니면 300ms 디바운스 (Monaco token 취소 존중, 세대 토큰)
3. 컨텍스트 추출 (렌더러): prefix(≤50줄), suffix(≤10줄), path, 언어 id → ipc `completion:request`
4. main CompletionService: settings 로드(캐시) → ContextBuilder(+심볼 시그니처) → 어댑터 `complete(ctx)` → 텍스트 반환
5. 렌더러: 세대 유효하면 `{ items: [{ insertText }] }` 반환 → 고스트 텍스트
6. 오류: main이 `{ error: { kind: 'auth'|'transient'|'other', message } }` 반환 → 렌더러 비활성 정책 적용 + 상태바

## 4. 인터페이스

```ts
// shared/protocol.ts 추가
export interface CompletionSettings { provider: 'none' | 'anthropic' | 'openai'; model: string; baseURL?: string; hasApiKey: boolean }
export interface CompletionContext { path: string; languageId: string; prefix: string; suffix: string }
export interface CompletionResult { text: string | null; error?: { kind: 'auth' | 'transient' | 'other'; message: string } }
```

- main `ProviderAdapter` 인터페이스: `complete(ctx: BuiltContext): Promise<string>` (BuiltContext = CompletionContext + symbolSignatures). 어댑터는 **클라이언트 주입 가능** 구조 (단위 테스트용)
- ipc: `settings:completion:get` → CompletionSettings(키 값 제외), `settings:completion:set (settings, apiKey?)` (apiKey는 전달 시에만 갱신), `completion:request (ctx)` → CompletionResult
- preload: `getCompletionSettings/setCompletionSettings/requestCompletion`

## 5. 프롬프트 설계 (어댑터 공통)

- system: "당신은 코드 자동완성 엔진이다. 커서 위치에 이어질 코드만 출력한다. 설명, 마크다운 펜스, 주석 금지. 짧게(보통 1~5줄) 완성한다." + 파일 언어/경로 + 심볼 시그니처 목록
- user: `<prefix 마지막 부분>` + `<CURSOR>` 마커 + `<suffix 앞부분>` 구조의 단일 메시지
- 후처리: 응답에서 마크다운 펜스 제거, prefix 끝과 중복되는 선두 부분 제거, 빈 문자열이면 null

## 6. 테스트

- **단위 (TDD)**: ContextBuilder(프롬프트 조립, 시그니처 포함/생략), 응답 후처리(펜스 제거/중복 프리픽스 제거), 설정 저장소(safeStorage mock — encrypt/decrypt 대칭, 키 미반환), 어댑터 2종(주입된 fake 클라이언트로 요청 파라미터·오류 분류 검증)
- **통합**: OpenAIAdapter를 로컬 fake HTTP 서버(node http, OpenAI 호환 응답)로 실왕복 — baseURL 경로 실증
- **수동/스모크**: SettingsOverlay 열기(Cmd/Ctrl+,)·저장 라운드트립. 실 API 호출은 키 필요라 자동화 제외 (명시)
