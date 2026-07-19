# Puppet Master

AI 시대의 코드 리뷰·구조 탐색 데스크톱 에디터. Source Insight의 구조 탐색 경험을 현대적으로 재해석하고, 터미널에서 AI 에이전트(Claude Code 등)가 만든 대량의 코드 변경을 **심볼 단위로 파악·리뷰**하는 데 초점을 맞췄습니다.

Electron + React + Monaco 위에 tree-sitter 기반 자체 인덱서(SQLite/FTS5)를 얹은 로컬 우선 앱입니다. 코드는 외부로 전송되지 않으며, AI 기능은 사용자가 등록한 API 키로만 동작합니다.

## 핵심 기능

### 구조 탐색 (인덱서)
- **6개 언어 심볼 인덱싱** — TypeScript/JavaScript, Python, Java, C, C++ (tree-sitter → SQLite, SHA1 증분, .gitignore 존중, 파일 워처로 실시간 갱신)
- **Relation 패널** — 커서 심볼의 호출자/피호출/상속 관계를 즉시 표시
- **전체 검색** — FTS5 전문 검색 + 줄 단위 결과, 하단 미리보기(구문 강조), 더블클릭 이동
- **Smart Rename** — 인덱스 기반 프로젝트 전역 이름 변경(확인/미확인 구분)
- **HTTP 경계 추적** — 프론트 호출(fetch/axios)과 백엔드 라우트(FastAPI/Flask/Spring/Next)를 경로 정규화로 양방향 매칭, 파일별 Flow와 blast radius(`getImpact`) 제공

### 변경 리뷰 센터
터미널에서 AI가 코드를 대량 생성/수정할 때 "무엇이 어떻게 바뀌었는지"를 따라잡기 위한 기능입니다.
- **리뷰 베이스라인** — 마지막으로 확인한 커밋 이후의 누적 변경(커밋 + 워킹트리 + 미추적 파일)을 한 큐로 수집
- **심볼 단위 diff** — 줄이 아니라 함수/클래스 단위로 추가·수정·삭제를 표시, 클릭 시 해당 위치로 diff 열기
- **영향 배지** — 심볼별 콜러 수·API 연관(엔드포인트 핸들러/백엔드 호출)을 배지로, 위험한 변경부터 정렬. 삭제됐는데 호출부가 남은 심볼은 경고
- **리뷰 체크 + 진행률** — GitHub PR "Viewed"처럼 심볼별 체크, 완료 시 베이스라인 전진
- **diff 줄 주석 → AI 피드백** — diff에서 줄에 코멘트를 달아 모아서 채팅으로 전달

### 에디터
- Monaco 에디터 + TextMate 문법(Groovy/Jenkinsfile 포함), 파일 탭, 세로 분할, 마크다운 미리보기
- **LSP** — TypeScript(tsserver)·Python(pyright) 진단/완성/호버/정의 이동/시그니처 도움말
- 파일·디렉터리 비교(diff), 북마크, 레이아웃 프리셋, git 변경 거터 표시
- **통합 터미널**(node-pty) — Claude Code 등 CLI 도구를 앱 안에서 실행

### AI
- **인라인 자동완성 / 채팅** — Anthropic·OpenAI 프로파일 등록, 커서 컨텍스트 + 인덱서 검색 결과 자동 첨부, 스레드 저장/검색
- **에이전트 모드** — 파일 쓰기·셸 실행에 더해 인덱서 도구(find_symbol, call graph, impact, trace_http)를 쓰는 구조 인지 에이전트
- **신뢰 프리셋 4단계** — 탐색만 / 신중(쓰기·셸 승인) / 편집 자동(셸만 승인) / 전체 자동
- **격리 모드** — 에이전트가 프로젝트 밖 git worktree에서 작업하고, 리뷰 후 적용/폐기
- Context7 연동 — 라이브러리 최신 문서 조회

## 설치

[Releases](https://github.com/roykang75/puppet-master/releases)에서 내려받습니다.

| 플랫폼 | 파일 |
|---|---|
| macOS (Apple Silicon) | `Puppet.Master-<버전>-arm64.dmg` |
| Windows 11 (x64) | `Puppet-Master-Setup-<버전>.exe` |

현재 무서명 빌드입니다.
- **macOS**: 첫 실행 시 우클릭 → 열기 (Gatekeeper 경고 허용)
- **Windows**: SmartScreen 경고에서 "추가 정보 → 실행"

## 개발

```bash
npm install        # postinstall이 네이티브 모듈 ABI 마커를 관리
npm run dev        # Vite HMR + Electron
npm test           # vitest (node ABI로 자동 전환)
npm run test:e2e   # Playwright E2E
npm run package    # macOS 설치본 빌드 (release/)
```

네이티브 모듈(better-sqlite3, tree-sitter, node-pty)은 앱 실행 시 Electron ABI, 테스트 시 Node ABI가 필요합니다. `scripts/abi.js`가 `predev`/`pretest`에서 마커(`node_modules/.abi`)를 보고 자동 재빌드하므로 신경 쓸 필요 없습니다.

릴리스 설치본은 GitHub Actions(`.github/workflows/release.yml`)가 macOS/Windows 러너에서 빌드합니다 — `v*` 태그 push 또는 수동 실행.

## 기술 스택

Electron · React · Monaco Editor · tree-sitter · better-sqlite3 (FTS5) · node-pty · vscode-textmate · typescript-language-server / pyright · Vite · vitest · Playwright
