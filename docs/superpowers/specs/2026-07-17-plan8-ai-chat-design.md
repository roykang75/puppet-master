# Plan 8 (v2): AI 채팅 — 설계 문서

**작성일**: 2026-07-17
**상태**: 설계 사용자 승인 완료 (대화형 브레인스토밍)
**상위 스펙**: `2026-07-15-sourceinsight-clone-design.md` v2 백로그 "AI 채팅(코드 설명 등)"
**선행**: Plan 7 (main 병합 `b8534de`)

## 1. 범위

포함:
- **채팅 패널**: 우측 영역을 "Relation | AI 채팅" **탭 전환**으로 확장. 메시지 목록(사용자/어시스턴트), 입력창(Enter 전송, Shift+Enter 줄바꿈), 스트리밍 중 실시간 갱신 + 중단 버튼, "새 대화" 버튼. 어시스턴트 응답의 마크다운 코드 블록은 등폭 블록으로 렌더(구문 강조는 후속)
- **자동 컨텍스트 주입 + 토글**: 메시지 전송 시 — 에디터 선택 영역이 있으면 선택 코드, 없으면 커서 주변 ±30줄 + 파일 경로/언어 + 심볼 아웃라인 시그니처(기존 `getFileOutline` 재사용, ≤20개). 패널에 "컨텍스트: <파일> (선택 N줄)" 표시줄 + "컨텍스트 포함" 체크박스(기본 켬)
- **main 스트리밍 ChatService**: 무상태 중계 — 렌더러가 대화 이력을 보내면 어댑터로 스트리밍 호출, 청크를 `chat:event`로 push, `chat:cancel`로 중단(AbortController). **설정은 기존 completion 설정(provider/model/baseURL/키) 재사용** — 채팅 전용 설정 없음
- **대화 관리**: 앱 세션 메모리만 — 프로젝트 전환(`setProject`) 시 초기화, 저장/복원 없음

제외 (명시):
- **에이전트 패널(Claude Agent SDK — 파일 편집/bash)**: Plan 9 후보로 백로그. 이번 채팅은 읽기 전용
- 대화 영구 저장/히스토리 목록, 응답 코드 블록 구문 강조, 다중 대화 탭, 채팅 전용 모델 설정, 도구 호출(tool use)

## 2. 결정 기록 (사용자 답변)

| 결정 | 선택 | 근거 |
|---|---|---|
| 범위 | 코드 컨텍스트 채팅 우선, 에이전트 패널은 Plan 9 (c) | Agent SDK는 Anthropic 전용이라 로컬 LLM 사용 패턴과 어긋나고 규모가 큼. 채팅 UI·컨텍스트 기반 위에 후속으로 얹기 좋음 |
| 컨텍스트 주입 | 자동 + 끄기 토글 (c) | 질문만 하면 되는 UX + 코드 무관 질문 시 토큰 절약 |
| UI 배치 | 우측 "Relation \| AI 채팅" 탭 전환 (a) | 새 공간 안 뺏음, 레이아웃 구조 불변, 사용 시점 분리 |
| 대화 관리 | 세션 메모리만 + 새 대화 버튼 (a) | YAGNI — 히스토리는 후속 |
| 아키텍처 | main 소유 스트리밍 ChatService (1안) | 키는 main에만(기존 보안 원칙). 렌더러 직접 호출(2안)은 원칙 위반 기각, 비스트리밍(3안)은 긴 응답 UX 문제로 기각 |
| 오류 전달 | kind 고정 문자열만 IPC 통과 | completion과 동일 — 키 에코 방어 원칙 유지 |
| main 상태 | ChatService는 무상태(이력은 렌더러 소유) | 프로세스 경계 단순화 — 대화 상태의 단일 소유자는 렌더러 store |

## 3. 구조

```
src/main/chat/
  service.ts        ChatService — 어댑터 선택(completion 설정 재사용)/스트리밍 중계/취소
  adapters.ts       AnthropicChat/OpenAIChat — messages.stream / stream:true,
                    클라이언트 생성은 completion 어댑터와 동일 옵션 (주입 가능)
src/main/main.ts    ipc: chat:send(messages, context?) / chat:cancel / chat:event(push)
src/preload         chatSend / chatCancel / onChatEvent
src/renderer/src/
  chat-context.ts   컨텍스트 빌더 (순수) — 선택/커서 주변/시그니처 → ChatContext
  components/ChatPanel.tsx   메시지 목록/입력/중단/새 대화/컨텍스트 표시줄
  components/RelationPanel 영역   탭 전환 래퍼 (Relation | AI 채팅)
  store.ts          chatMessages/chatStreaming/rightTab — setProject 리셋 포함
```

- **ipc 계약**: `chat:send(messages: {role:'user'|'assistant', content:string}[], context: ChatContext | null)` → 스트리밍 시작(동시 1개 — 진행 중이면 거부). `chat:event` payload: `{type:'chunk', text}` | `{type:'done'}` | `{type:'error', kind:'auth'|'transient'|'other'}`. `chat:cancel` → AbortController.abort.
- **시스템 프롬프트**(main): "코드 어시스턴트. 간결하게 한국어로 답한다." + context가 있으면 파일 경로/언어/시그니처/코드 블록 포함.
- **ChatContext**: `{ path, languageId, code, isSelection, startLine, signatures: string[] }`.

## 4. 데이터 흐름·오류 처리

1. 사용자 전송 → 렌더러: 컨텍스트 빌드(토글 켬일 때) → store에 사용자 메시지 추가 → `chat:send`(전체 이력 + 컨텍스트) → 어시스턴트 자리(빈 메시지) 추가
2. provider 미설정 처리는 **렌더러 단락이 1차** — 전송 전에 설정을 확인해 패널에 "Cmd+,에서 AI provider를 설정하세요" 안내를 표시하고 IPC를 보내지 않는다. main은 방어적으로 provider 'none'이면 `{type:'error', kind:'other'}`를 push (2차 방어)
3. 스트리밍 청크 → `chat:event {chunk}` → store의 마지막 어시스턴트 메시지에 append
4. done → 입력 재활성화. error → 해당 메시지에 kind별 안내 표시("인증 오류 — 설정 확인" 등) 후 재활성화. cancel → 부분 응답 유지 + "(중단됨)" 표기
5. 프로젝트 전환 → store 리셋 + 진행 중이면 `chat:cancel`
6. 동시성: 스트리밍 중 입력 비활성(중단 버튼만). main도 동시 1개 가드(진행 중 chat:send 거부)

## 5. 테스트

- **단위(TDD)**: chat-context 빌더(선택/커서/토글/시그니처 절단), 채팅 어댑터 2종(fake 클라이언트 — 요청 파라미터·스트리밍 청크 순서·abort 시 중단·오류 분류), ChatService(동시 1개 가드, 오류 kind 고정 문자열)
- **통합**: OpenAI 채팅 어댑터를 로컬 fake HTTP 스트리밍 서버(SSE)로 실왕복 (completion-openai-integration 패턴)
- **E2E**: fake OpenAI 서버 + 설정 심은 SI_USER_DATA로 앱 구동 → AI 채팅 탭 → 질문 전송 → 스트리밍 응답 렌더 확인 → 새 대화 리셋 확인
