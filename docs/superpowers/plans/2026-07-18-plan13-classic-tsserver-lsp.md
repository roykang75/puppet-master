# Plan 13: TypeScript LSP를 정식 tsserver로 교체 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 에디터 TS/JS LSP를 tsgo(네이티브 프리뷰)에서 정식 tsserver(typescript-language-server)로 교체해 VS Code/Antigravity와 동일하게 동작시킨다. 가짜 CSS/자산 import 오류 제거.

**Architecture:** typescript-language-server를 pyright처럼 Electron-as-node로 스폰하고, `initializationOptions.tsserver.path`로 별칭 설치한 클래식 typescript의 tsserver.js를 가리킨다. tsgo(`typescript@7`)는 앱 빌드/타입체크용으로 유지.

**Tech Stack:** TypeScript, Electron(main), `vscode-jsonrpc/node`, vitest, electron-builder.

**스펙**: `docs/superpowers/specs/2026-07-18-plan13-classic-tsserver-lsp-design.md`

## Global Constraints

- 앱 빌드/타입체크(`tsc`)가 쓰는 `typescript@7`(tsgo)와 `@typescript/*`는 **건드리지 않는다**. `tsgoExePath()` 함수도 남긴다(빌드가 참조).
- LSP 순수/main 모듈은 electron 임포트 금지 규칙 유지(테스트는 node ABI). `servers.ts`/`client.ts`는 electron 임포트 없음.
- 스폰은 pyright와 동일 패턴: `command: process.execPath`, `env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }`.
- 실측 버전(npm view): `typescript-language-server@^5.3`(bin `lib/cli.mjs`), 클래식 `typescript@^5.9`(모든 5.x에 `lib/tsserver.js`).
- 별칭 설치: `"typescript-classic": "npm:typescript@^5.9"`.
- 커밋 메시지 한국어 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: 의존성 추가 + servers.ts 교체 (TS 스폰을 tsserver로)

**Files:**
- Modify: `package.json` (deps 2개 추가)
- Modify: `src/main/lsp/servers.ts`
- Modify: `tests/lsp-servers.test.ts`

**Interfaces:**
- Produces: `LspSpawnSpec`에 `initializationOptions?: Record<string, unknown>` 추가. `ts` 서버가 node+cli.mjs로 스폰되고 `initializationOptions.tsserver.path`를 반환.

- [ ] **Step 1: 의존성 설치**

```bash
npm install --save-dev typescript-language-server@^5.3 "typescript-classic@npm:typescript@^5.9"
```

Run: 설치 후 `ls node_modules/typescript-language-server/lib/cli.mjs node_modules/typescript-classic/lib/tsserver.js` → 두 파일 모두 존재해야 함. (없으면 BLOCKED 보고.)

- [ ] **Step 2: 실패 테스트 작성** — `tests/lsp-servers.test.ts`에 케이스 추가(기존 import/스타일에 맞춤):

```ts
import * as fs from 'fs';
// ... 기존 import 유지, serverForExt / LSP_SERVERS import 되어 있음

describe('ts 서버: 정식 tsserver(typescript-language-server) 스폰', () => {
  it('node(process.execPath)로 cli.mjs --stdio를 ELECTRON_RUN_AS_NODE로 스폰', () => {
    const def = serverForExt('.ts')!;
    const spec = def.resolveSpawn();
    expect(spec.command).toBe(process.execPath);
    expect(spec.args.some((a) => a.endsWith('cli.mjs'))).toBe(true);
    expect(spec.args).toContain('--stdio');
    expect(spec.env?.ELECTRON_RUN_AS_NODE).toBe('1');
  });
  it('initializationOptions.tsserver.path가 실존하는 클래식 tsserver.js를 가리킨다', () => {
    const spec = serverForExt('.tsx')!.resolveSpawn();
    const p = (spec.initializationOptions as any)?.tsserver?.path as string;
    expect(typeof p).toBe('string');
    expect(p.endsWith('tsserver.js')).toBe(true);
    expect(fs.existsSync(p)).toBe(true);
  });
  it('.js/.jsx도 같은 ts 서버가 담당', () => {
    expect(serverForExt('.js')?.lang).toBe('ts');
    expect(serverForExt('.jsx')?.lang).toBe('ts');
  });
});
```

- [ ] **Step 3: 실패 확인** — Run: `npx vitest run tests/lsp-servers.test.ts` → FAIL (아직 tsgo 스폰이라 command가 process.execPath 아님 / initializationOptions 없음)

- [ ] **Step 4: 구현** — `src/main/lsp/servers.ts`:
  - `LspSpawnSpec`에 필드 추가:

```ts
export interface LspSpawnSpec { command: string; args: string[]; env?: NodeJS.ProcessEnv; initializationOptions?: Record<string, unknown> }
```

  - 리졸버 함수 추가(기존 `tsgoExePath`/`pyrightEntryPath` 아래):

```ts
export function tsLangServerEntryPath(): string {
  return unpacked(require.resolve('typescript-language-server/lib/cli.mjs'));
}
export function classicTsserverPath(): string {
  return unpacked(require.resolve('typescript-classic/lib/tsserver.js'));
}
```

  - `LSP_SERVERS`의 `ts` 항목 `resolveSpawn`을 교체(exts는 그대로):

```ts
    resolveSpawn: () => ({
      command: process.execPath, // Electron 바이너리를 node로 — pyright와 동일
      args: [tsLangServerEntryPath(), '--stdio'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      initializationOptions: { tsserver: { path: classicTsserverPath() } },
    }),
```

  `tsgoExePath()`는 삭제하지 않는다(빌드/타입체크가 참조).

- [ ] **Step 5: 통과 확인** — Run: `npx vitest run tests/lsp-servers.test.ts` → PASS. 빌드: `npm run build` → 오류 없음.

- [ ] **Step 6: 커밋**

```bash
git add package.json package-lock.json src/main/lsp/servers.ts tests/lsp-servers.test.ts
git commit -m "Plan 13 Task 1: TS LSP를 typescript-language-server(정식 tsserver)로 교체 — 의존성 + servers.ts"
```

---

### Task 2: initializationOptions 배선 (client + manager)

**Files:**
- Modify: `src/main/lsp/client.ts` (`LspClientOpts`, `initialize()`)
- Modify: `src/main/lsp/manager.ts` (`spawnEntry`에서 spec.initializationOptions 전달)
- Modify: `tests/lsp-client.test.ts`

**Interfaces:**
- Consumes: `LspSpawnSpec.initializationOptions` (Task 1)
- Produces: `LspClient`가 `initializationOptions`를 받아 initialize 요청에 포함.

- [ ] **Step 1: 실패 테스트** — `tests/lsp-client.test.ts`에 케이스 추가(기존 스트림 주입 패턴 재사용). 기존 테스트가 initialize 요청을 어떻게 캡처하는지 보고 동일 방식으로:

```ts
it('initialize 요청에 initializationOptions가 포함된다', async () => {
  // 기존 테스트의 가짜 서버/스트림 셋업을 재사용해, initialize params를 캡처.
  // LspClient를 initializationOptions: { tsserver: { path: '/x/tsserver.js' } }로 생성하고
  // initialize() 호출 후, 서버가 받은 initialize params.initializationOptions가 그 값과 같은지 단언.
  // (기존 파일의 헬퍼/픽스처 이름에 맞춰 작성)
});
```

  구현자는 `tests/lsp-client.test.ts`의 기존 initialize 테스트를 읽고 동일한 가짜 커넥션 방식으로 `initializationOptions`가 payload에 실리는지 검증하는 케이스를 추가한다. 새 픽스처를 만들 필요 없으면 기존 것 재사용.

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/lsp-client.test.ts` → FAIL

- [ ] **Step 3: 구현** — `src/main/lsp/client.ts`:
  - `LspClientOpts`에 추가: `initializationOptions?: Record<string, unknown>;`
  - `initialize()`의 `sendRequest('initialize', { ... })` 객체에 필드 추가(rootUri 근처):

```ts
      initializationOptions: this.opts.initializationOptions,
```

  (undefined면 tsserver가 무시하므로 pyright 등 다른 서버에 무해.)

- [ ] **Step 4: manager 배선** — `src/main/lsp/manager.ts` `spawnEntry`에서 `resolveSpawn()` 결과의 initializationOptions를 클라이언트로 전달:

```ts
      const spec = def.resolveSpawn();
      // ... proc 스폰(기존) ...
      const client = new LspClient(proc.stdout, proc.stdin, {
        rootUri: pathToFileURL(this.deps.root).toString(),
        onDiagnostics: (uri, raw) => { /* 기존 그대로 */ },
        initializationOptions: spec.initializationOptions,
      });
```

  (기존 `const spec = def.resolveSpawn();`가 try 블록 안에 있으니, spec를 client 생성까지 스코프에서 쓸 수 있게 유지. 필요하면 spec를 바깥 let으로.)

- [ ] **Step 5: 통과 확인** — Run: `npx vitest run tests/lsp-client.test.ts tests/lsp-manager.test.ts` → PASS. 빌드: `npm run build` → 오류 없음.

- [ ] **Step 6: 커밋**

```bash
git add src/main/lsp/client.ts src/main/lsp/manager.ts tests/lsp-client.test.ts
git commit -m "Plan 13 Task 2: LSP initialize에 initializationOptions 배선(tsserver.path 주입)"
```

---

### Task 3: 패키징 (asarUnpack)

**Files:**
- Modify: `electron-builder.yml`

**Interfaces:** 없음 (설정 전용, 유닛 테스트 없음 — 검증은 코드 인스펙션).

- [ ] **Step 1: asarUnpack 추가** — `electron-builder.yml`의 `asarUnpack` 목록에 두 줄 추가(pyright 줄 근처):

```yaml
  - "node_modules/typescript-language-server/**"   # 정식 tsserver LSP — ELECTRON_RUN_AS_NODE 스폰
  - "node_modules/typescript-classic/**"            # tsserver.js(클래식 TS) — node로 로드
```

- [ ] **Step 2: 검증** — `grep -n "typescript-language-server\|typescript-classic" electron-builder.yml`로 두 항목 존재 확인. YAML이 깨지지 않았는지 `npm run build`가 여전히 성공하는지 확인(빌드는 electron-builder를 호출하지 않지만 회귀 확인용).

- [ ] **Step 3: 커밋**

```bash
git add electron-builder.yml
git commit -m "Plan 13 Task 3: 패키징 — typescript-language-server/typescript-classic asarUnpack"
```

---

## 최종 검증 (오케스트레이터 수행, 서브에이전트 아님)

전체 유닛 스위트(`npx vitest run`) 통과 확인 후, 관찰용 dev 앱으로 실측한다:
1. `import "./globals.css"`를 쓰는 실제 TS 프로젝트(node_modules 설치됨)를 연다.
2. 해당 줄에 **에러 마커(빨간 줄)가 없다**(Antigravity와 동일).
3. 존재하지 않는 코드 모듈 import(오타)는 **여전히 오류**로 표시된다.
4. .ts 파일에서 **자동완성/hover가 동작**한다(tsserver 기동 확인).
5. LSP 상태가 'running'이고 크래시 루프가 없다(관찰 로그).

만약 tsserver가 기동하지 않으면(ESM cli.mjs가 ELECTRON_RUN_AS_NODE에서 실패 등), 폴백:
- cli 엔트리를 `bin`으로 재확인, 또는 `require.resolve('typescript-language-server')`의 package `main` 사용.
- `initializationOptions.tsserver.path` 대신 `--tsserver-path`(구버전) 또는 워크스페이스 typescript 자동 resolve 시도.

## 완료 기준
- 전체 유닛 테스트 통과(신규: servers 스폰 스펙 + client initializationOptions).
- dev 앱에서 CSS import 가짜 오류 소멸 + 진짜 오류 유지 + 완성/hover 동작(실측).
- 빌드 클린. tsgo(빌드/타입체크)는 무변경.
