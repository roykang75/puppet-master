# Plan 10 (v2): 에이전트 모드 — 설계 문서

**작성일**: 2026-07-18
**상태**: 설계 사용자 승인 완료 (대화형 브레인스토밍)
**목적**: AI가 도구 호출로 프로젝트 파일을 직접 생성/수정 — "구구단 앱을 파이썬으로 만들어줘" → 실제 파일 생성+코드 주입
**선행**: Plan 8 (AI 채팅, `8e85e76`) — 채팅 UI·스트리밍·프로파일 인프라 재사용

## 1. 범위

포함:
- **자체 tool-use 루프**: main의 AgentService가 모델에 도구 스키마를 제공하고 tool call을 실행·반환하는 대화 루프. Anthropic tool use + OpenAI 호환 tool calling(LM Studio의 Qwen 등) — 기존 완성/채팅 프로파일 그대로 사용
- **도구 5종**: `list_dir` / `read_file` / `write_file`(생성 포함, 중간 폴더 자동) / `search_text`(기존 인덱서 FTS) / `run_command`(셸 단발 실행)
- **접근 범위**: 파일 도구는 프로젝트 루트 + 설정의 "추가 허용 디렉터리" 목록 안만 (경로 탈출 거부). `search_text`는 인덱서 기반이라 프로젝트만
- **승인 UX**: 기본 전부 자동 실행. 패널의 "자동 승인" 토글(기본 켬)을 끄면 `write_file`/`run_command`는 실행 전 [실행]/[건너뛰기] 승인 대기 (읽기 도구는 항상 자동). 셸도 토글을 따른다
- **UI**: 기존 AI 채팅 패널에 "에이전트" 모드 토글. 도구 호출은 응답 중간 인라인 카드(도구명+대상+상태), write_file 카드 클릭 → 파일 탭 열기, run_command 카드는 출력 접기/펼치기
- **후처리**: write_file 성공 시 프로젝트 트리 새로고침, 열린 탭은 기존 "디스크에서 변경됨" 메커니즘 동작

제외 (명시):
- Claude Agent SDK 통합(Anthropic 전용이라 로컬 모델 패턴과 어긋남 — 기각), 서브에이전트, diff 미리보기 승인, 대화 영구 저장, 셸 디렉터리 샌드박스(OS 수준 불가 — 한계 고지로 대체), 멀티 파일 원자 트랜잭션

## 2. 결정 기록 (사용자 답변)

| 결정 | 선택 | 근거 |
|---|---|---|
| 엔진 | 자체 tool-use 루프 (a) | 기존 프로파일 재사용 — Anthropic+로컬 모델 모두. Agent SDK는 Anthropic 전용 기각, CLI 래핑은 터미널로 이미 가능 |
| 도구 범위 | 파일+검색+셸 전부 (c) | 생성·수정·실행(테스트)까지 커버 |
| 승인 | 전부 자동 + 자동승인 토글 (c) | 속도 우선, 토글로 세밀 제어. 끄면 쓰기/셸 승인 대기 |
| UI | 채팅 패널 모드 토글 (a) | 스트리밍/마크다운/프로파일 인프라 재사용 — 구현 최소 |
| 파일 접근 | 루트 + 추가 허용 목록 (b) | 프로젝트 밖 참조 자료 등 유연성. 경로 탈출 방지는 유지 |
| 셸 처리 | 자동승인 토글 따름 (b) | 디렉터리 제한 불가 한계를 고지한 상태에서 사용자가 속도 선택 |
| 도구 미지원 모델 | tools 전달하되 모델이 안 쓰면 일반 채팅 폴백 | gemma 등 — 오류가 아닌 자연 폴백 |

## 3. 구조

```
src/main/agent/
  tools.ts     도구 스키마(JSON Schema) + 실행기. 경로 해석: 루트 상대 경로 기본,
               절대 경로는 allowedDirs 안일 때만 허용. run_command: /bin/zsh -c,
               cwd=프로젝트 루트, 30초 타임아웃, 출력 20KB 절단
  adapters.ts  AnthropicAgent / OpenAIAgent — 스트리밍 + tool call 파싱 (주입 가능한 클라이언트)
  service.ts   AgentService — 루프: 모델 호출 → text 청크 push → tool call 실행(승인 대기 포함)
               → tool result 추가 → 재호출. 최대 25회 도구 호출. AbortController 취소
src/main/main.ts        ipc: agent:send / agent:cancel / agent:approve(id, ok) / agent:event(push)
src/preload             agentSend / agentCancel / agentApprove / onAgentEvent
src/renderer/src/
  components/ChatPanel  에이전트/자동승인 토글, 도구 카드 렌더 (구독은 App.tsx — P1 교훈)
  store.ts              agentMode / autoApprove / 메시지에 toolCalls 인라인 항목
설정(settings.json)      agent: { allowedDirs: string[] } — SettingsOverlay에 목록 편집 UI
```

- **ipc 계약**: `agent:send(messages, context)` → 스트리밍 시작(동시 1개). `agent:event` payload:
  `{type:'chunk', text}` | `{type:'tool', id, name, summary, state:'running'|'done'|'error'|'awaiting', detail?}` |
  `{type:'done'}` | `{type:'error', kind}`. 승인 대기 시 `awaiting` → 렌더러 `agent:approve(id, ok)` 응답까지 루프 대기.
- **보안 원칙 유지**: API 키·오류 상세는 IPC를 넘지 않음(kind/절단된 도구 출력만). 도구 실행 실패 메시지는 모델에게 tool result로 반환해 스스로 복구 시도.

## 4. 데이터 흐름·수명·오류

1. 에이전트 모드 켜고 전송 → 렌더러가 이력+컨텍스트를 `agent:send` → main 루프 시작
2. 텍스트는 기존 채팅처럼 스트리밍, tool call은 카드 이벤트(running→done/error)로 push
3. 자동승인 꺼짐 + 쓰기/셸 → `awaiting` 카드([실행]/[건너뛰기]) → 거부 시 "사용자가 거부함"을 tool result로 전달
4. write_file 성공 → 렌더러가 트리 새로고침 + 카드 클릭 시 탭 열기
5. 취소 → 진행 중 도구만 마무리 후 루프 종료, 부분 응답 유지. 25회 한도 → "(도구 호출 한도 도달)" 후 종료
6. 프로젝트 전환 → 대화·진행 중 루프 리셋(기존 채팅과 동일)

## 5. 테스트

- **단위(TDD)**: tools — 경로 탈출 거부/allowedDirs 허용/write 중간 폴더/run_command 출력 절단·타임아웃. service — fake 어댑터로 도구 호출→실행→재호출→종료, 한도, 취소, 승인 대기/거부
- **어댑터**: fake 클라이언트로 Anthropic/OpenAI 각각 tool call 파싱·tool result 왕복
- **통합**: OpenAI 어댑터를 fake HTTP tool calling 서버로 실왕복
- **E2E**: fake 서버 + 설정 심은 SI_USER_DATA → 에이전트 모드 → "파일 만들어줘" → 실제 디스크 파일 생성 + 도구 카드 표시 + 트리 반영 확인
