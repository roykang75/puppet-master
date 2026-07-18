# Plan 12: 프로젝트 스택 감지 + Context7 온디맨드 문서 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 열 때 언어/프레임워크(버전)를 로컬 감지하고, AI가 필요 시 Context7에서 최신 라이브러리 문서를 온디맨드로 조회한다.

**Architecture:** 감지는 main에서 매니페스트를 fs로 읽어 순수 파서(`detectStack`)로 처리(네트워크 X). 요약은 프롬프트에 상주. 문서는 `library_docs` 에이전트 도구로 Context7 `libs/search`→`context` 조회(세션 캐시). 기존 읽기 전용 도구 루프·`AgentToolDeps` 주입·설정 키 패턴 재사용.

**Tech Stack:** TypeScript, Electron(main), 전역 `fetch`, vitest. Context7 API v2.

**스펙**: `docs/superpowers/specs/2026-07-18-plan12-context7-stack-docs-design.md`

## Global Constraints

- 순수 모듈은 electron 임포트 금지(node ABI 테스트): `detect.ts`, `stack-summary.ts`, `context7/client.ts`.
- Context7 키: 평문 저장(파일 `0o600`), IPC로 값 미전달 — `hasContext7Key: boolean`만 공개. LLM 키와 동일 원칙.
- 열기는 네트워크에 막히지 않음 — 감지는 로컬 파싱만, 실패해도 열기 성공.
- `library_docs`는 읽기 전용(네트워크 조회) — 승인 불필요, 실패 시 예외 대신 사람이 읽을 안내 문자열 반환.
- Context7 API v2: 검색 `GET https://context7.com/api/v2/libs/search?libraryName={name}&query={q}`, 문서 `GET https://context7.com/api/v2/context?libraryId={id}&query={q}&type=json`, 인증 `Authorization: Bearer {key}`(선택), 초과 429.
- 라이브러리 요약 상한 20개.
- 커밋 메시지 한국어, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: 스택 감지 모듈 (매니페스트 파서)

**Files:**
- Create: `src/main/stack/detect.ts`
- Create: `tests/stack-detect.test.ts`
- Modify: `src/shared/protocol.ts` (ProjectStack 타입 추가)

**Interfaces:**
- Produces: `ProjectStack = { languages: string[]; libraries: { name: string; version?: string }[] }` (shared/protocol.ts). `detectStack(files: { path: string; content: string }[]): ProjectStack`

- [ ] **Step 1: ProjectStack 타입 추가** — `src/shared/protocol.ts`에 추가:

```ts
export interface ProjectStack {
  languages: string[];
  libraries: { name: string; version?: string }[];
}
```

- [ ] **Step 2: 실패 테스트 작성** — `tests/stack-detect.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectStack, MAX_LIBRARIES } from '../src/main/stack/detect';

describe('detectStack', () => {
  it('package.json deps+devDeps 추출', () => {
    const s = detectStack([{ path: 'package.json', content: JSON.stringify({
      dependencies: { react: '^18.3.1', zustand: '4.5.0' },
      devDependencies: { vite: '^5.2.0' },
    }) }]);
    const names = s.libraries.map((l) => l.name);
    expect(names).toContain('react');
    expect(names).toContain('vite');
    expect(s.libraries.find((l) => l.name === 'react')?.version).toBe('^18.3.1');
  });

  it('requirements.txt 파싱 (버전 지정자 분리)', () => {
    const s = detectStack([{ path: 'requirements.txt', content: 'flask==3.0.0\nrequests>=2.31\n# 주석\n\nnumpy' }]);
    expect(s.libraries.find((l) => l.name === 'flask')?.version).toBe('3.0.0');
    expect(s.libraries.map((l) => l.name)).toEqual(expect.arrayContaining(['flask', 'requests', 'numpy']));
  });

  it('go.mod require 블록 파싱', () => {
    const s = detectStack([{ path: 'go.mod', content: 'module x\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgolang.org/x/sync v0.6.0\n)\n' }]);
    expect(s.libraries.find((l) => l.name === 'github.com/gin-gonic/gin')?.version).toBe('v1.9.1');
  });

  it('pom.xml dependency 파싱', () => {
    const s = detectStack([{ path: 'pom.xml', content: '<project><dependencies><dependency><groupId>org.springframework</groupId><artifactId>spring-core</artifactId><version>6.1.0</version></dependency></dependencies></project>' }]);
    expect(s.libraries.find((l) => l.name === 'org.springframework:spring-core')?.version).toBe('6.1.0');
  });

  it('언어는 확장자 빈도로 집계', () => {
    const s = detectStack([
      { path: 'a.ts', content: '' }, { path: 'b.ts', content: '' }, { path: 'c.py', content: '' },
    ]);
    expect(s.languages[0]).toBe('TypeScript'); // 최다
    expect(s.languages).toContain('Python');
  });

  it('라이브러리 상한 + 중복 제거', () => {
    const deps = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`lib${i}`, '1.0.0']));
    const s = detectStack([{ path: 'package.json', content: JSON.stringify({ dependencies: deps }) }]);
    expect(s.libraries.length).toBeLessThanOrEqual(MAX_LIBRARIES);
  });

  it('매니페스트 없거나 파싱 실패해도 안전 (부분 결과)', () => {
    expect(detectStack([{ path: 'package.json', content: '{ broken' }])).toEqual({ languages: [], libraries: [] });
    expect(detectStack([])).toEqual({ languages: [], libraries: [] });
  });
});
```

- [ ] **Step 3: 테스트 실패 확인** — Run: `npx vitest run tests/stack-detect.test.ts` → FAIL (모듈 없음)

- [ ] **Step 4: 구현** — `src/main/stack/detect.ts`:

```ts
// 프로젝트 스택 감지 — 순수 모듈 (electron 임포트 금지, node ABI 테스트).
import type { ProjectStack } from '../../shared/protocol';

export const MAX_LIBRARIES = 20;

const EXT_LANG: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript',
  py: 'Python', go: 'Go', java: 'Java', kt: 'Kotlin', rb: 'Ruby', rs: 'Rust', php: 'PHP',
  c: 'C', h: 'C', cpp: 'C++', cc: 'C++', hpp: 'C++', cs: 'C#', css: 'CSS', scss: 'CSS', html: 'HTML',
};

type Lib = { name: string; version?: string };

function base(p: string): string {
  return p.split('/').pop() ?? p;
}

function parsePackageJson(content: string): Lib[] {
  try {
    const j = JSON.parse(content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return [
      ...Object.entries(j.dependencies ?? {}),
      ...Object.entries(j.devDependencies ?? {}),
    ].map(([name, version]) => ({ name, version }));
  } catch {
    return [];
  }
}

function parseRequirements(content: string): Lib[] {
  const out: Lib[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;
    const m = line.match(/^([A-Za-z0-9._-]+)\s*(?:[=<>!~]=?\s*([A-Za-z0-9._*-]+))?/);
    if (m) out.push({ name: m[1], version: m[2] });
  }
  return out;
}

function parseGoMod(content: string): Lib[] {
  const out: Lib[] = [];
  // require ( ... ) 블록 및 단일 require 라인
  const re = /^\s*(?:require\s+)?([\w./-]+\.[\w./-]+\/[\w./-]+|[\w.-]+\.[\w-]+\/[\w./-]+)\s+(v[\w.\-+]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) out.push({ name: m[1], version: m[2] });
  return out;
}

function parsePomXml(content: string): Lib[] {
  const out: Lib[] = [];
  const re = /<dependency>([\s\S]*?)<\/dependency>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const body = m[1];
    const g = body.match(/<groupId>\s*([^<]+?)\s*<\/groupId>/);
    const a = body.match(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/);
    const v = body.match(/<version>\s*([^<]+?)\s*<\/version>/);
    if (g && a) out.push({ name: `${g[1]}:${a[1]}`, version: v?.[1] });
  }
  return out;
}

function parseGradle(content: string): Lib[] {
  const out: Lib[] = [];
  // implementation 'group:artifact:version' 또는 "..."
  const re = /(?:implementation|api|compile|testImplementation)\s*[('"]+\s*([\w.-]+):([\w.-]+):([\w.\-+]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) out.push({ name: `${m[1]}:${m[2]}`, version: m[3] });
  return out;
}

function parsePyproject(content: string): Lib[] {
  const out: Lib[] = [];
  // [project] dependencies = ["flask>=3", ...] 및 poetry [tool.poetry.dependencies]
  const arr = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (arr) {
    for (const q of arr[1].match(/["']([^"']+)["']/g) ?? []) {
      const dep = q.slice(1, -1);
      const m = dep.match(/^([A-Za-z0-9._-]+)\s*(?:[=<>!~]=?\s*([A-Za-z0-9._*-]+))?/);
      if (m) out.push({ name: m[1], version: m[2] });
    }
  }
  return out;
}

/** 매니페스트 파일들과 소스 확장자로 언어·라이브러리를 감지한다. 실패한 파서는 스킵(부분 결과). */
export function detectStack(files: { path: string; content: string }[]): ProjectStack {
  const libs: Lib[] = [];
  const extCount = new Map<string, number>();
  for (const f of files) {
    const name = base(f.path).toLowerCase();
    if (name === 'package.json') libs.push(...parsePackageJson(f.content));
    else if (name === 'requirements.txt') libs.push(...parseRequirements(f.content));
    else if (name === 'pyproject.toml') libs.push(...parsePyproject(f.content));
    else if (name === 'go.mod') libs.push(...parseGoMod(f.content));
    else if (name === 'pom.xml') libs.push(...parsePomXml(f.content));
    else if (name === 'build.gradle' || name === 'build.gradle.kts') libs.push(...parseGradle(f.content));
    const ext = name.includes('.') ? name.split('.').pop()! : '';
    const lang = EXT_LANG[ext];
    if (lang) extCount.set(lang, (extCount.get(lang) ?? 0) + 1);
  }
  // 중복 제거(첫 등장 우선) + 상한
  const seen = new Set<string>();
  const libraries: Lib[] = [];
  for (const l of libs) {
    if (seen.has(l.name)) continue;
    seen.add(l.name);
    libraries.push(l);
    if (libraries.length >= MAX_LIBRARIES) break;
  }
  const languages = [...extCount.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
  return { languages, libraries };
}
```

- [ ] **Step 5: 테스트 통과 확인** — Run: `npx vitest run tests/stack-detect.test.ts` → PASS

- [ ] **Step 6: 커밋**

```bash
git add src/main/stack/detect.ts tests/stack-detect.test.ts src/shared/protocol.ts
git commit -m "Plan 12 Task 1: 스택 감지 매니페스트 파서 (package.json/requirements/go.mod/pom/gradle/pyproject)"
```

---

### Task 2: 스택 요약 + 프롬프트 첨부

**Files:**
- Create: `src/shared/stack-summary.ts`
- Create: `tests/stack-summary.test.ts`
- Modify: `src/shared/protocol.ts` (`ChatContext.stack?`)
- Modify: `src/main/chat/prompt.ts` (stack 섹션)
- Modify: `tests/chat-prompt.test.ts` (stack 렌더 테스트)

**Interfaces:**
- Consumes: `ProjectStack` (Task 1)
- Produces: `buildStackSummary(stack: ProjectStack): string`. `ChatContext.stack?: string`.

- [ ] **Step 1: 실패 테스트** — `tests/stack-summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildStackSummary } from '../src/shared/stack-summary';

describe('buildStackSummary', () => {
  it('언어 + 라이브러리(버전) 한 줄', () => {
    const s = buildStackSummary({ languages: ['TypeScript', 'CSS'], libraries: [{ name: 'react', version: '18.3.1' }, { name: 'vite' }] });
    expect(s).toContain('TypeScript');
    expect(s).toContain('react@18.3.1');
    expect(s).toContain('vite'); // 버전 없으면 이름만
  });
  it('빈 스택 → 빈 문자열', () => {
    expect(buildStackSummary({ languages: [], libraries: [] })).toBe('');
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/stack-summary.test.ts` → FAIL

- [ ] **Step 3: 구현** — `src/shared/stack-summary.ts`:

```ts
// 스택 요약 문자열 — 순수 모듈(shared, renderer/main 공용).
import type { ProjectStack } from './protocol';

export function buildStackSummary(stack: ProjectStack): string {
  const parts: string[] = [];
  if (stack.languages.length) parts.push(`언어: ${stack.languages.join(', ')}`);
  if (stack.libraries.length) {
    const libs = stack.libraries.map((l) => (l.version ? `${l.name}@${l.version}` : l.name)).join(', ');
    parts.push(`라이브러리: ${libs}`);
  }
  return parts.join(' · ');
}
```

- [ ] **Step 4: `ChatContext.stack?` 추가** — `src/shared/protocol.ts`의 `ChatContext`에 `stack?: string; // 프로젝트 스택 요약(자동 감지)` 필드 추가.

- [ ] **Step 5: 프롬프트 렌더** — `src/main/chat/prompt.ts` `buildChatSystemPrompt`에서 `retrieved` 섹션 앞에 추가:

```ts
  if (context?.stack) {
    lines.push('');
    lines.push(`이 프로젝트의 스택(참고): ${context.stack}`);
  }
```

- [ ] **Step 6: 프롬프트 테스트 추가** — `tests/chat-prompt.test.ts`에 케이스 추가:

```ts
  it('스택 요약 섹션 렌더', () => {
    const s = buildChatSystemPrompt({ stack: '언어: TypeScript · 라이브러리: react@18.3.1' });
    expect(s).toContain('이 프로젝트의 스택(참고): 언어: TypeScript');
  });
```

- [ ] **Step 7: 테스트 통과** — Run: `npx vitest run tests/stack-summary.test.ts tests/chat-prompt.test.ts` → PASS

- [ ] **Step 8: 커밋**

```bash
git add src/shared/stack-summary.ts tests/stack-summary.test.ts src/shared/protocol.ts src/main/chat/prompt.ts tests/chat-prompt.test.ts
git commit -m "Plan 12 Task 2: 스택 요약 + 시스템 프롬프트 첨부(ChatContext.stack)"
```

---

### Task 3: Context7 클라이언트

**Files:**
- Create: `src/main/context7/client.ts`
- Create: `tests/context7-client.test.ts`

**Interfaces:**
- Produces:
  - `class RateLimitError extends Error`
  - `searchLibrary(name: string, query: string, apiKey: string | null, fetchImpl?: typeof fetch): Promise<string | null>` (라이브러리 id 또는 null)
  - `getDocs(libraryId: string, query: string, apiKey: string | null, fetchImpl?: typeof fetch): Promise<string>` (스니펫 텍스트, 상한 절단)

- [ ] **Step 1: 실패 테스트** — `tests/context7-client.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { searchLibrary, getDocs, RateLimitError, DOCS_CAP } from '../src/main/context7/client';

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('searchLibrary', () => {
  it('최적 매치 id 반환 + Bearer 헤더', async () => {
    let seen: Request | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = new Request(url, init);
      return jsonRes({ results: [{ id: '/facebook/react' }, { id: '/x/y' }] });
    }) as unknown as typeof fetch;
    const id = await searchLibrary('react', 'hooks', 'ctx7sk_abc', fetchImpl);
    expect(id).toBe('/facebook/react');
    expect(seen?.headers.get('authorization')).toBe('Bearer ctx7sk_abc');
    expect(seen?.url).toContain('libraryName=react');
  });
  it('매치 없으면 null', async () => {
    const fetchImpl = (async () => jsonRes({ results: [] })) as unknown as typeof fetch;
    expect(await searchLibrary('nope', 'x', null, fetchImpl)).toBeNull();
  });
  it('429 → RateLimitError', async () => {
    const fetchImpl = (async () => jsonRes({}, 429)) as unknown as typeof fetch;
    await expect(searchLibrary('react', 'x', null, fetchImpl)).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe('getDocs', () => {
  it('스니펫 텍스트 반환 + 키 없으면 헤더 없음', async () => {
    let seen: Request | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = new Request(url, init);
      return jsonRes({ snippets: [{ code: 'const x=1', description: 'desc' }] });
    }) as unknown as typeof fetch;
    const txt = await getDocs('/facebook/react', 'hooks', null, fetchImpl);
    expect(txt).toContain('const x=1');
    expect(seen?.headers.get('authorization')).toBeNull();
  });
  it('상한 절단', async () => {
    const big = 'x'.repeat(DOCS_CAP + 5000);
    const fetchImpl = (async () => jsonRes({ snippets: [{ code: big }] })) as unknown as typeof fetch;
    const txt = await getDocs('/a/b', 'q', null, fetchImpl);
    expect(txt.length).toBeLessThanOrEqual(DOCS_CAP + 100);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/context7-client.test.ts` → FAIL

- [ ] **Step 3: 구현** — `src/main/context7/client.ts`:

```ts
// Context7 API v2 클라이언트 — electron-free(전역 fetch), fetchImpl 주입으로 테스트.
export const BASE = 'https://context7.com/api/v2';
export const DOCS_CAP = 12 * 1024; // 스니펫 응답 절단

export class RateLimitError extends Error {
  constructor() { super('rate limited'); this.name = 'RateLimitError'; }
}
export class Context7Error extends Error {
  constructor(msg: string) { super(msg); this.name = 'Context7Error'; }
}

function headers(apiKey: string | null): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function getJson(url: string, apiKey: string | null, fetchImpl: typeof fetch): Promise<any> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: headers(apiKey) });
  } catch (e) {
    throw new Context7Error(e instanceof Error ? e.message : 'network');
  }
  if (res.status === 429) throw new RateLimitError();
  if (!res.ok) throw new Context7Error(`http ${res.status}`);
  return res.json();
}

/** 라이브러리명을 Context7 id로 해석 (최적=첫 매치). 없으면 null. */
export async function searchLibrary(
  name: string, query: string, apiKey: string | null, fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = `${BASE}/libs/search?libraryName=${encodeURIComponent(name)}&query=${encodeURIComponent(query)}`;
  const body = await getJson(url, apiKey, fetchImpl);
  const results = (body?.results ?? body?.libraries ?? []) as { id?: string }[];
  return results[0]?.id ?? null;
}

/** 라이브러리 문서(질의 기반 스니펫)를 텍스트로. 상한 절단. */
export async function getDocs(
  libraryId: string, query: string, apiKey: string | null, fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = `${BASE}/context?libraryId=${encodeURIComponent(libraryId)}&query=${encodeURIComponent(query)}&type=json`;
  const body = await getJson(url, apiKey, fetchImpl);
  const snippets = (body?.snippets ?? []) as { code?: string; description?: string }[];
  const text = snippets
    .map((s) => [s.description, s.code].filter(Boolean).join('\n'))
    .join('\n\n')
    || (typeof body === 'string' ? body : JSON.stringify(body));
  return text.length > DOCS_CAP ? text.slice(0, DOCS_CAP) + '\n…(잘림)' : text;
}
```

> 구현 주의: 실제 응답 스키마(`results`/`libraries`, `snippets` 키)가 다를 수 있다. 위 파서는 방어적으로 여러 키를 시도한다. 통합 시 실제 응답을 로그로 확인해 필드명을 조정하라(테스트는 모킹이라 무관).

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/context7-client.test.ts` → PASS

- [ ] **Step 5: 커밋**

```bash
git add src/main/context7/client.ts tests/context7-client.test.ts
git commit -m "Plan 12 Task 3: Context7 API v2 클라이언트(search/getDocs, 429 처리, fetch 주입)"
```

---

### Task 4: Context7 서비스 (캐시 + 키)

**Files:**
- Create: `src/main/context7/service.ts`
- Create: `tests/context7-service.test.ts`

**Interfaces:**
- Consumes: `searchLibrary`, `getDocs`, `RateLimitError` (Task 3)
- Produces: `class Context7Service { constructor(deps: { getApiKey(): string | null; fetchImpl?: typeof fetch }); libraryDocs(library: string, query: string): Promise<string> }`

- [ ] **Step 1: 실패 테스트** — `tests/context7-service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Context7Service } from '../src/main/context7/service';

const okFetch = (idBody: unknown, docBody: unknown) => {
  let n = 0;
  return (async () => {
    n++;
    const body = n === 1 ? idBody : docBody;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
};

describe('Context7Service', () => {
  it('resolve→fetch 후 스니펫 반환', async () => {
    const svc = new Context7Service({ getApiKey: () => null, fetchImpl: okFetch({ results: [{ id: '/a/b' }] }, { snippets: [{ code: 'CODE' }] }) });
    expect(await svc.libraryDocs('react', 'hooks')).toContain('CODE');
  });

  it('캐시: 같은 (library, query) 두 번째 호출은 fetch 미발생', async () => {
    const impl = vi.fn(okFetch({ results: [{ id: '/a/b' }] }, { snippets: [{ code: 'CODE' }] }));
    const svc = new Context7Service({ getApiKey: () => null, fetchImpl: impl as unknown as typeof fetch });
    await svc.libraryDocs('react', 'hooks');
    const calls = impl.mock.calls.length;
    await svc.libraryDocs('react', 'hooks');
    expect(impl.mock.calls.length).toBe(calls); // 캐시 히트
  });

  it('미해석(id 없음) → 안내 문자열', async () => {
    const svc = new Context7Service({ getApiKey: () => null, fetchImpl: (async () => new Response(JSON.stringify({ results: [] }), { status: 200 })) as unknown as typeof fetch });
    expect(await svc.libraryDocs('nope', 'x')).toContain('찾지 못');
  });

  it('429 → 안내 문자열(예외 아님)', async () => {
    const svc = new Context7Service({ getApiKey: () => null, fetchImpl: (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch });
    const r = await svc.libraryDocs('react', 'x');
    expect(r).toContain('제한');
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/context7-service.test.ts` → FAIL

- [ ] **Step 3: 구현** — `src/main/context7/service.ts`:

```ts
// Context7 서비스 — 세션 인메모리 캐시 + 키 결합. 실패는 안내 문자열 반환(예외 미전파).
import { searchLibrary, getDocs, RateLimitError } from './client';

export class Context7Service {
  private idCache = new Map<string, string | null>();     // library → id(or null)
  private docCache = new Map<string, string>();           // `${id}\n${query}` → docs
  private readonly getApiKey: () => string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: { getApiKey: () => string | null; fetchImpl?: typeof fetch }) {
    this.getApiKey = deps.getApiKey;
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  async libraryDocs(library: string, query: string): Promise<string> {
    const key = this.getApiKey();
    try {
      let id = this.idCache.get(library);
      if (id === undefined) {
        id = await searchLibrary(library, query, key, this.fetchImpl);
        this.idCache.set(library, id);
      }
      if (!id) return `'${library}' 라이브러리를 Context7에서 찾지 못했습니다.`;
      const dk = `${id}\n${query.trim().toLowerCase()}`;
      const cached = this.docCache.get(dk);
      if (cached !== undefined) return cached;
      const docs = await getDocs(id, query, key, this.fetchImpl);
      this.docCache.set(dk, docs);
      return docs;
    } catch (e) {
      if (e instanceof RateLimitError) {
        return key
          ? 'Context7 요청 제한에 도달했습니다. 잠시 후 다시 시도하세요.'
          : 'Context7 요청 제한(키 없음)에 도달했습니다. 설정에서 API 키를 등록하면 완화됩니다.';
      }
      return `Context7 문서를 가져오지 못했습니다: ${e instanceof Error ? e.message : '오류'}`;
    }
  }
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/context7-service.test.ts` → PASS

- [ ] **Step 5: 커밋**

```bash
git add src/main/context7/service.ts tests/context7-service.test.ts
git commit -m "Plan 12 Task 4: Context7 서비스(세션 캐시 + 키 결합, 실패 안내 문자열)"
```

---

### Task 5: library_docs 에이전트 도구

**Files:**
- Modify: `src/main/agent/tools.ts` (스키마, `AgentToolDeps.libraryDocs`, executeTool, toolSummary, 도구셋)
- Modify: `tests/agent-tools.test.ts`
- Modify: `src/renderer/src/components/ChatPanel.tsx` (`TOOL_META`)

**Interfaces:**
- Consumes: `Context7Service.libraryDocs` (Task 4) — main이 `AgentToolDeps.libraryDocs`로 주입
- Produces: `library_docs` 도구가 `AGENT_TOOLS`·`READONLY_AGENT_TOOLS`에 포함

- [ ] **Step 1: 실패 테스트** — `tests/agent-tools.test.ts`에 추가:

```ts
  it('library_docs: 도구셋 포함 + deps.libraryDocs 호출', async () => {
    expect(READONLY_AGENT_TOOLS.map((t) => t.name)).toContain('library_docs');
    expect(AGENT_TOOLS.map((t) => t.name)).toContain('library_docs');
    const out = await executeTool('library_docs', { library: 'react', query: 'hooks' }, deps({
      libraryDocs: async (lib, q) => `DOCS:${lib}:${q}`,
    }));
    expect(out).toBe('DOCS:react:hooks');
  });

  it('library_docs: 주입 없으면 안내', async () => {
    const out = await executeTool('library_docs', { library: 'react', query: 'x' }, deps());
    expect(out).toContain('사용할 수 없');
  });
```

  그리고 `deps()` 헬퍼(파일 상단)에 `libraryDocs`를 override 가능하게 확장(기존 `...over` 스프레드가 이미 처리하지만, 타입상 옵셔널이라 무변경).

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/agent-tools.test.ts` → FAIL

- [ ] **Step 3: 구현 — 스키마/도구셋** — `src/main/agent/tools.ts`:
  - `AGENT_TOOLS` 배열 끝(run_command 뒤)에 추가:

```ts
  {
    name: 'library_docs',
    description: '라이브러리/프레임워크의 최신 문서를 Context7에서 가져온다. library=패키지명(예: react), query=알고 싶은 주제.',
    parameters: { type: 'object', properties: { library: { type: 'string', description: '패키지/라이브러리 이름' }, query: { type: 'string', description: '알고 싶은 주제/질문' } }, required: ['library', 'query'] },
  },
```

  - `READONLY_AGENT_TOOLS` 필터에 `library_docs` 포함되도록 수정:

```ts
export const READONLY_AGENT_TOOLS: ToolSpec[] = AGENT_TOOLS.filter(
  (t) => t.name !== 'write_file' && t.name !== 'run_command',
);
```

  (필터가 제외 목록 방식이라 `library_docs`는 자동 포함 — 무변경. 단 Task 1 주석 확인.)

- [ ] **Step 4: 구현 — deps + executeTool + toolSummary** — `src/main/agent/tools.ts`:
  - `AgentToolDeps`에 추가: `libraryDocs?: (library: string, query: string) => Promise<string>;`
  - `executeTool` switch에 case 추가:

```ts
      case 'library_docs': {
        if (!deps.libraryDocs) return '오류: 라이브러리 문서 도구를 사용할 수 없습니다 (Context7 미구성).';
        return await deps.libraryDocs(String(args.library ?? ''), String(args.query ?? ''));
      }
```

  - `toolSummary`에 `library_docs` → `String(args.library ?? '')` 반환하도록 분기 추가.

- [ ] **Step 5: TOOL_META** — `src/renderer/src/components/ChatPanel.tsx`:
  - import에 `VscBook` 추가(react-icons/vsc)
  - `TOOL_META`에 `library_docs: { icon: <VscBook />, label: 'Docs' },`

- [ ] **Step 6: 통과 확인** — Run: `npx vitest run tests/agent-tools.test.ts` → PASS. 빌드: `npm run build` → 오류 없음.

- [ ] **Step 7: 커밋**

```bash
git add src/main/agent/tools.ts tests/agent-tools.test.ts src/renderer/src/components/ChatPanel.tsx
git commit -m "Plan 12 Task 5: library_docs 에이전트 도구(읽기전용/에이전트 도구셋, deps 주입, Docs 배지)"
```

---

### Task 6: 설정 — Context7 API 키

**Files:**
- Modify: `src/main/settings.ts` (`context7ApiKey`, get/set, toPublic `hasContext7Key`)
- Modify: `src/shared/protocol.ts` (`CompletionSettings.hasContext7Key`)
- Modify: `src/main/main.ts` (IPC `settings:context7:set-key`)
- Modify: `src/preload/preload.ts` (`setContext7Key`)
- Modify: `src/renderer/src/components/SettingsOverlay.tsx` (키 입력 필드)
- Modify: `tests/settings.test.ts` (있으면 — 키 저장/공개 테스트)

**Interfaces:**
- Produces: `settingsStore.getContext7Key(): string | null`, `settingsStore.setContext7Key(key: string): void`, `toPublic().hasContext7Key: boolean`

- [ ] **Step 1: settings.ts** — `SettingsFile`/`Normalized`에 `context7ApiKey?: string` 추가. `read()`가 이를 보존하도록 `normalize`/`write` 반영. 메서드 추가:

```ts
  getContext7Key(): string | null {
    return this.read().context7ApiKey ?? null;
  }
  setContext7Key(key: string): void {
    const prev = this.read();
    // '' = 삭제
    this.write({ ...prev, context7ApiKey: key || undefined });
  }
```

  `toPublic()` 반환 객체에 `hasContext7Key: !!this.read().context7ApiKey` 추가.

- [ ] **Step 2: protocol.ts** — `CompletionSettings`에 `hasContext7Key: boolean;` 추가.

- [ ] **Step 3: IPC** — `src/main/main.ts` 설정 IPC 근처에 추가:

```ts
  ipcMain.handle('settings:context7:set-key', (_e, key: string) => settingsStore.setContext7Key(key));
```

- [ ] **Step 4: preload** — `src/preload/preload.ts`에 추가:

```ts
  setContext7Key: (key: string): Promise<void> => ipcRenderer.invoke('settings:context7:set-key', key),
```

- [ ] **Step 5: SettingsOverlay** — LLM 프로파일 키 입력과 동일 UX로 Context7 키 입력 필드 추가. `getCompletionSettings()`의 `hasContext7Key`로 "설정됨" 표시, 입력 시 `window.si.setContext7Key(value)` 호출. (기존 키 필드 컴포넌트/패턴을 그대로 따른다 — 파일을 읽고 동일 스타일 적용.)

- [ ] **Step 6: 테스트** — 설정 테스트가 있으면 `context7ApiKey` 저장 후 `toPublic().hasContext7Key === true`, 값이 공개 객체에 없음(`!('context7ApiKey' in pub)`)을 확인. 빌드: `npm run build` → 오류 없음.

- [ ] **Step 7: 커밋**

```bash
git add src/main/settings.ts src/shared/protocol.ts src/main/main.ts src/preload/preload.ts src/renderer/src/components/SettingsOverlay.tsx tests/settings.test.ts
git commit -m "Plan 12 Task 6: 설정에 Context7 API 키(평문 0600, hasContext7Key만 공개)"
```

---

### Task 7: 통합 배선 (main + preload + ChatPanel)

**Files:**
- Modify: `src/main/main.ts` (detectStack on open, `currentStack`, `stack:get` IPC, `getToolDeps.libraryDocs`, Context7Service 생성)
- Modify: `src/preload/preload.ts` (`getProjectStack`)
- Modify: `src/renderer/src/components/ChatPanel.tsx` (`send()`에서 stack 첨부)
- Create/Modify: `tests/e2e/context7-stack.spec.ts` (통합 E2E — 선택적, 시간 허용 시)

**Interfaces:**
- Consumes: `detectStack`(T1), `buildStackSummary`(T2), `Context7Service`(T4), `settingsStore.getContext7Key`(T6)

- [ ] **Step 1: detectStack on open** — `src/main/main.ts` `openProjectInMain`에서 `currentRoot = root;` 이후, 프로젝트 루트의 매니페스트 후보를 fs로 읽어 감지:

```ts
    // 스택 감지 (로컬 파싱만 — 네트워크 X, 실패해도 열기 성공)
    try {
      const CANDS = ['package.json', 'requirements.txt', 'pyproject.toml', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts'];
      const manifest = CANDS
        .map((n) => ({ p: path.join(root, n), n }))
        .filter((c) => fs.existsSync(c.p))
        .map((c) => ({ path: c.n, content: fs.readFileSync(c.p, 'utf8') }));
      // 언어 감지용 소스 확장자 표본 — 루트 파일 목록만(재귀 없음, 값싸게)
      const sample = fs.readdirSync(root).map((n) => ({ path: n, content: '' }));
      currentStack = detectStack([...manifest, ...sample]);
    } catch {
      currentStack = null;
    }
```

  파일 상단에 `let currentStack: ProjectStack | null = null;` 선언, `import { detectStack } from './stack/detect';` 및 `import { buildStackSummary } from '../shared/stack-summary';` 추가.

  > 주의: 언어 감지는 루트 표본만으로 부족할 수 있다. MVP는 매니페스트 존재로 주 언어가 드러나므로 충분. (정밀 언어 통계는 인덱서 연동 — v2)

- [ ] **Step 2: stack:get IPC** — `src/main/main.ts`:

```ts
  ipcMain.handle('stack:get', () => (currentStack ? buildStackSummary(currentStack) : null));
```

- [ ] **Step 3: Context7Service + getToolDeps 배선** — `src/main/main.ts`:
  - 상단에 `import { Context7Service } from './context7/service';`
  - AgentService 생성 근처에 `const context7 = new Context7Service({ getApiKey: () => settingsStore.getContext7Key() });`
  - `getToolDeps` 반환 객체에 추가: `libraryDocs: (library: string, query: string) => context7.libraryDocs(library, query),`

- [ ] **Step 4: preload** — `src/preload/preload.ts`:

```ts
  getProjectStack: (): Promise<string | null> => ipcRenderer.invoke('stack:get'),
```

- [ ] **Step 5: ChatPanel stack 첨부** — `src/renderer/src/components/ChatPanel.tsx` `send()`에서 컨텍스트 구성 시 stack 병합:

```ts
    const stack = await window.si.getProjectStack().catch(() => null);
    const base = retrieved.length > 0 ? { ...(activeCtx ?? {}), retrieved } : activeCtx;
    const context: ChatContext | null =
      stack ? { ...(base ?? {}), stack } : base;
```

  (기존 `const context = retrieved.length > 0 ? ... : activeCtx;` 라인을 위로 대체.)

- [ ] **Step 6: 빌드 + 전체 테스트** — Run: `npm run build` → 오류 없음. `npx vitest run` → 전체 PASS (네이티브 ABI 필요 시 `npm run rebuild:node` 선행).

- [ ] **Step 7: (선택) E2E** — 시간 허용 시 `tests/e2e/context7-stack.spec.ts`: 가짜 Context7 서버 없이 감지만 검증하기 어려우므로, 최소한 `stack:get`이 package.json 있는 픽처에서 요약 문자열을 반환하는지, ChatPanel 전송 요청의 system 프롬프트에 "스택" 섹션이 포함되는지 확인(하이브리드 컨텍스트 E2E `.superpowers/ctx-e2e.mjs` 패턴 재사용).

- [ ] **Step 8: 커밋**

```bash
git add src/main/main.ts src/preload/preload.ts src/renderer/src/components/ChatPanel.tsx
git commit -m "Plan 12 Task 7: 배선 — 열 때 스택 감지, stack:get IPC, getToolDeps.libraryDocs, ChatPanel stack 첨부"
```

---

## 완료 기준
- 프로젝트 열면 스택이 감지되어 채팅 프롬프트에 요약이 들어간다(오프라인에서도 열기 정상).
- 질문/에이전트 모드에서 LLM이 `library_docs`로 Context7 문서를 온디맨드 조회할 수 있다(도구 카드 "Docs" 배지).
- Context7 키는 설정에 저장되고 값은 IPC로 노출되지 않는다.
- 전체 테스트 통과(신규: 스택 파서, 요약, Context7 클라이언트/서비스, 도구 편입, 프롬프트 렌더).
