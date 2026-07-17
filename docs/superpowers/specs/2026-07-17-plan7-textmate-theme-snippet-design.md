# Plan 7 (v2): TextMate 문법 + 테마 + 스니펫 — 설계 문서

**작성일**: 2026-07-17
**상태**: 설계 섹션별 사용자 승인 완료 (대화형 브레인스토밍)
**선행**: Plan 6 (LSP 보강, main 병합 `4a093f9`)

## 1. 범위

포함:
- **TextMate 문법 전체 도입**: Microsoft 공식 `vscode-textmate`(엔진) + `vscode-oniguruma`(WASM), Monaco 연결 어댑터 직접 작성. 6언어 tmLanguage JSON 번들 (VS Code 저장소, MIT — 라이선스 고지 포함)
- **테마**: 번들 4종(Dark+, Light+, Monokai, One Dark Pro — 모두 MIT. Dark+/Light+/Monokai는 VS Code 저장소, One Dark Pro는 Binaryify 저장소에서 벤더링. Dracula는 배포 파일 경로 불안정으로 Monokai로 대체) + **VS Code 테마 JSON 임포트**(파일 선택 → userData/themes 복사) + **앱 UI 연동**(패널/트리/탭/상태바 CSS 변수를 테마에서 유도). 설정 오버레이에서 선택, 즉시 적용
- **스니펫**: VS Code 스니펫 JSON 포맷(`prefix`/`body`/`description`, `$1`/`${2:기본값}`), 언어별 번들 기본 세트 + 사용자 정의(`userData/snippets/<언어>.json`), 완성 드롭다운 통합(kind=Snippet, placeholder Tab 이동), 설정에 "스니펫 폴더 열기" 버튼

제외 (명시):
- Clip Window 패널(후속), 테마 마켓/검색, 스니펫 편집 UI, 사용자 문법 추가, 파일 워칭 기반 스니펫 자동 재로드(설정 저장 시 재로드로 대체)

## 2. 결정 기록 (사용자 답변)

| 결정 | 선택 | 근거 |
|---|---|---|
| 문법 도입 수준 | 전체 도입 (a) | VS Code 테마는 tm scope 기준 색 정의 — 문법 없인 테마가 근사치. 시맨틱 토큰과 결합 시 하이라이팅 품질 상급 |
| 테마 범위 | 번들 4종 + 임포트 + 앱 UI 연동 (a) | 라이트 테마 도입에 필요한 theme.css 변수화 포함. 에디터만 바꾸면 UI 괴리로 라이트 테마 사실상 불가 |
| 스니펫 | VS Code 포맷 + 사용자 정의 + 완성 통합 (a) | Clip Window는 완성 드롭다운 통합으로 실사용 충분 — 후속 |
| 통합 방식 | 공식 패키지 2종 + 자체 어댑터 (1안) | 서드파티 글루(monaco-editor-textmate)와 @codingame 포크는 Monaco 버전 결합 — Plan 6과 같은 원칙으로 기각 |
| 토크나이저 어댑터 | `tokenizeLine`(비인코딩) + `setTokensProvider` + `defineTheme` 접두사 매칭 | 공개 API만 사용. tokenizeLine2(인코딩)는 Monaco 비공개 _themeService 훅 필요 — 버전 취약. 성능은 벤치로 실측 |
| 시맨틱 토큰 공존 | 테마 kind(dark/light)별 `.sem-*` 색 프리셋 2벌 (CSS 변수) | 기존 데코레이션 덧입힘 구조 유지 |
| 폴백 원칙 | 문법/WASM 실패 → monarch 유지, 테마 손상 → Dark+ 폴백, 스니펫 손상 → 해당 파일 무시 | 어떤 실패도 편집/인덱싱/LSP 무영향 |

## 3. 구조

```
src/renderer/src/
  textmate/registry.ts   oniguruma WASM 로드 + vscode-textmate Registry (scope→문법, 지연 로드)
  textmate/adapter.ts    setTokensProvider 어댑터 — tokenizeLine 상태 체인, tm scope → Monaco 토큰
  theming/convert.ts     테마 JSON → { monacoTheme, uiVars(CSS 변수), kind } 순수 변환
  theming/apply.ts       defineTheme + setTheme + document CSS 변수 주입
  snippets.ts            스니펫 JSON 파서 + CompletionItemProvider (kind=Snippet)
assets/grammars/*.tmLanguage.json  6언어 (c, cpp, python, typescript, javascript, java)
  ※ 한계: Monaco는 .tsx/.jsx를 typescript/javascript languageId로 묶으므로 base 문법 적용 —
    JSX 구문의 정밀 하이라이팅은 VS Code 대비 낮음 (React 전용 문법은 languageId 분리가 필요해 후속)
assets/themes/*.json               번들 4종
src/main/
  settings.ts            appearance: { theme: string } (기본 'dark-plus')
  main.ts ipc            theme:list / theme:import(유효성 검사 후 userData/themes 복사)
                         / theme:read / snippets:read / snippets:openFolder
```

- `vs-dark` 하드코딩 2곳(EditorPane, ContextPanel) 제거 — applyTheme가 단일 소스.
- theme.css의 다크 고정 상수를 CSS 변수로 전환 (uiVars가 주입).

## 4. 데이터 흐름

- **시작**: appearance.theme 로드 → theme:read → convert → applyTheme. WASM/Registry는 첫 에디터 마운트 1회.
- **파일 열기**: 언어 문법 미등록 시 지연 로드 후 setTokensProvider (언어당 1회, 실패 시 monarch 잔존 = 자연 폴백).
- **테마 변경**: select → 저장 → 즉시 applyTheme (재시작 불요). 임포트는 main이 JSON 파스 + tokenColors/colors 존재 검사 후 복사.
- **스니펫**: 언어 최초 열림 시 번들+사용자 병합 로드(같은 prefix는 사용자 우선) → provider 등록. 설정 오버레이 저장 시 재로드.

## 5. 테스트

- **단위(TDD)**: theming/convert (tokenColors→규칙, colors→CSS 변수, kind 판별, 손상 폴백), 스니펫 파서(body 배열 join, placeholder 보존, 손상 무시, 사용자 우선), settings appearance 라운드트립.
- **통합**: 실제 문법 6종 Registry 로드 + 대표 라인 scope 검증(예: TS 문자열 → `string.quoted` 계열), 번들 테마 4종 convert 스모크, 수천 줄 파일 tokenize 시간 벤치 기록.
- **E2E**: 테마 전환(Light+ 선택 → 에디터+패널 배경 변경) + 스니펫 삽입(prefix → 드롭다운 → 삽입) 1스펙.
