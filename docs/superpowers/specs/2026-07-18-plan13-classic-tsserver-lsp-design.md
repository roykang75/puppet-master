# Plan 13: TypeScript LSP를 정식 tsserver로 교체 — 설계 문서

**상위 스펙**: `2026-07-15-sourceinsight-clone-design.md` §5 "이 모듈만 교체하면 v2에서 LSP 보강으로 확장된다"

## 1. 배경 / 문제

에디터에서 `import "./globals.css";` 같은 **정상 코드에 가짜 오류(TS2307)**가 뜬다.
같은 파일을 VS Code 계열(Google Antigravity)에서 열면 오류가 없다 → **프로젝트는 정상,
우리 TS LSP가 문제**로 확정.

원인: 현재 TS LSP가 **tsgo**(`@typescript/native-preview` = `typescript@7` 네이티브 프리뷰,
`src/main/lsp/servers.ts:37`, `tsgoExePath()` `--lsp --stdio`)다. tsgo는 아직 프리뷰라
CSS/자산 import의 앰비언트 모듈 선언(`declare module '*.css'`; next-env.d.ts / vite/client)을
정식 tsserver만큼 해석하지 못해 잘못된 진단을 낸다. 실측: `node_modules/typescript@7.0.2`의
`lib/`엔 `tsserver.js`가 없다(`getExePath.js`/`tsc.js`뿐).

## 2. 목표

에디터 TS/JS 언어 진단·인텔리전스를 **정식 tsserver 기반(typescript-language-server)**으로 교체해
VS Code/Antigravity와 동일하게 동작시킨다. 가짜 CSS/자산 import 오류 제거, 진짜 오류는 유지.

**비목표**: 앱 자체 빌드/타입체크(`tsc -p tsconfig.json`)는 그대로 tsgo(`typescript@7`) 사용 — 건드리지 않는다.

## 3. 접근

**tsgo는 빌드용으로 유지, 에디터 LSP만 클래식 tsserver로 교체.** 기존 pyright(Electron-as-node
스폰) 패턴을 그대로 재사용한다.

### 3.1 의존성 (LSP 전용, 추가)
- `typescript-language-server@^5.3` — tsserver를 감싼 표준 LSP 서버. 실측: bin 엔트리 `lib/cli.mjs`(ESM), `--stdio`.
- **클래식 TypeScript를 npm 별칭으로**: `"typescript-classic": "npm:typescript@^5.9"` (실측 최신 5.9.3).
  모든 TS 5.x는 `lib/tsserver.js`를 제공 → `node_modules/typescript-classic/lib/tsserver.js`. 기존 `typescript@7`(빌드용)과 이름 충돌 없이 공존.

### 3.2 서버 스폰 (`src/main/lsp/servers.ts`)
- `ts`의 `resolveSpawn`을 pyright와 동일 패턴으로 교체:
  ```
  command: process.execPath,                 // Electron 바이너리를 node로
  args: [tsLangServerEntryPath(), '--stdio'],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  ```
- `tsLangServerEntryPath()` = `unpacked(require.resolve('typescript-language-server/lib/cli.mjs'))`.
  (구현 시 실제 bin 엔트리 경로를 package.json `bin`으로 확인 — 다르면 조정.)
- 서버 정의(`LspServerDef`)에 옵션 필드 `initializationOptions?: Record<string, unknown>` 추가.
  `ts`에 `{ tsserver: { path: classicTsserverPath() } }` 지정.
  `classicTsserverPath()` = `unpacked(require.resolve('typescript-classic/lib/tsserver.js'))`.
- `tsgoExePath()`는 빌드/타입체크가 계속 쓰므로 **함수는 남기되 `LSP_SERVERS`에서만 미사용**.

### 3.3 LSP 초기화 배선 (`src/main/lsp/client.ts`, `manager.ts`)
- `LspClient`의 opts에 `initializationOptions?: Record<string, unknown>` 추가.
- `initialize()`의 initialize 요청 payload에 `initializationOptions`를 포함(현재 미전송).
- `manager.ts` `spawnEntry`: `def.resolveSpawn()`이 반환하는(또는 `def`가 가진) `initializationOptions`를
  `new LspClient(..., { rootUri, onDiagnostics, initializationOptions })`로 전달.

### 3.4 패키징 (`electron-builder.yml`)
- `asarUnpack`에 추가:
  - `node_modules/typescript-language-server/**`
  - `node_modules/typescript-classic/**`
  (tsserver는 node로 스폰되고 파일을 읽으므로 asar 밖 실물 배치 필요 — pyright와 동일 이유.)
- `unpacked()` 헬퍼가 dev/패키지 경로를 이미 정규화하므로 코드 변경은 없음.

### 3.5 내장 워커 진단 (유지)
직전 커밋(`monaco-setup.ts`의 `typescriptDefaults/javascriptDefaults` 진단 off)은 그대로 둔다.
이제 진단은 정식 tsserver가 담당하고 내장 워커 중복 진단은 계속 꺼둔다.

## 4. 데이터 흐름 (변경 후)

```
.ts/.tsx/.js 열기 → manager: serverForExt('ts') → resolveSpawn(typescript-language-server, node)
  → LspClient.initialize({ rootUri, initializationOptions:{ tsserver:{ path: 클래식 tsserver.js } } })
  → tsserver가 프로젝트 tsconfig/node_modules/next-env.d.ts 로드 → 정확한 진단/완성/hover/정의
진단 이벤트 → manager.onDiagnostics → renderer lsp-features → setModelMarkers owner 'lsp'
```

## 5. 검증 (필수)
- **가짜 오류 제거**: node_modules가 설치된 TS 프로젝트에서 `import "./globals.css"`(또는 자산 import)에
  오류 마커가 없다(Antigravity와 동일).
- **진짜 오류 유지**: 존재하지 않는 코드 모듈 import(오타)는 여전히 오류.
- **기능 유지**: 완성/hover/정의가 .ts/.tsx/.js에서 동작.
- **스폰 실측**: typescript-language-server가 Electron-as-node로 기동하고 initialize가 성공한다
  (dev 기준. 패키징 unpacked 경로는 코드리뷰로 확인, 전체 패키지 빌드는 범위 밖).

## 6. 오류 처리 / 폴백
- typescript-language-server 기동 실패/크래시는 기존 `manager.ts` 크래시 카운터·상태('stopped')로 처리 —
  추가 로직 없음. LSP가 죽어도 편집·인덱서·완성(별도)은 계속 동작.
- `initializationOptions.tsserver.path`가 잘못돼도 tsserver가 워크스페이스/자체 폴백으로 resolve 시도.

## 7. 테스트
- `servers.ts`: `ts` 스폰 스펙이 node(process.execPath)+cli.mjs+`--stdio`+`ELECTRON_RUN_AS_NODE`이고,
  `initializationOptions.tsserver.path`가 클래식 tsserver.js를 가리킨다(경로 존재 검증).
- `client.ts`: `initialize()`가 `initializationOptions`를 요청 payload에 포함한다(가짜 conn으로 캡처).
- 기존 LSP 관련 테스트(manager/convert) 회귀 없음.
- 통합(수동/관찰): dev 앱에서 TS 프로젝트 열어 CSS import 오류 없음 + 완성 동작 확인.

## 8. 범위 밖 (v2 백로그)
- 전체 패키지(dmg) 빌드 검증(수동), tsgo 완전 제거(빌드 타입체커까지 교체), TS 버전 선택 UI,
  프로젝트별 tsserver 버전(워크스페이스 typescript 우선) 정교화.

## 9. 리스크
- ESM `cli.mjs`가 `ELECTRON_RUN_AS_NODE`로 정상 기동하는지 → Task 1에서 실측.
- `typescript-language-server`가 `initializationOptions.tsserver.path`로 클래식 tsserver.js를 잡는지 → 실측.
- 두 TypeScript(7 네이티브 + 5 클래식 별칭) 공존 — 격리돼 무해하나 설치 용량↑.
