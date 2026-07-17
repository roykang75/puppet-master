# Plan 7: TextMate 문법 + 테마 + 스니펫 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VS Code 생태계 자산(tmLanguage 문법 6종, 테마 JSON 4종+임포트, 스니펫 JSON)을 Monaco에 통합해 구문 강조 품질·외관·입력 생산성을 올린다.

**Architecture:** 렌더러에 vscode-textmate+oniguruma(WASM은 main이 ipc로 공급) 토크나이저 어댑터를 얹고(공개 API `setTokensProvider`만), 테마 JSON→{Monaco defineTheme 규칙, 앱 CSS 변수} 순수 변환기로 에디터·UI를 한 번에 테마화한다. 스니펫은 VS Code JSON 포맷을 파싱해 CompletionItemProvider(kind=Snippet)로 노출한다. 모든 실패는 조용한 폴백(monarch 유지/Dark+ 폴백/파일 무시).

**Tech Stack:** vscode-textmate 9.3.2, vscode-oniguruma 2.0.1(WASM), VS Code 저장소 문법/테마(MIT), Monaco 공개 API

**스펙**: `docs/superpowers/specs/2026-07-17-plan7-textmate-theme-snippet-design.md`

## Global Constraints

- Monaco **공개 API만** 사용 — `_themeService` 등 내부 접근 금지. 토크나이저는 `tokenizeLine`(비인코딩) + `setTokensProvider` + `defineTheme` 접두사 매칭
- 폴백 원칙: 문법/WASM 실패 → monarch 유지, 테마 손상 → Dark+ 폴백, 스니펫 손상 → 해당 파일 무시. 어떤 실패도 편집/인덱싱/LSP에 영향 금지
- 테마 CSS 변수는 기존 theme.css `:root` 10종(`--bg --bg-panel --bg-hover --bg-active --border --fg --fg-dim --accent --warn` + 신규 sem 변수)을 덮어쓰는 방식 — 변수명 변경 금지
- 벤더링 자산은 원본 그대로 + `assets/grammars/LICENSE.md`/`assets/themes/LICENSE.md`에 출처·라이선스 고지
- 시맨틱 토큰(.sem-*)은 테마 kind(dark/light)별 프리셋 2벌로 전환하되 기존 데코레이션 구조 유지
- 커밋 메시지 한국어 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 트레일러. `git add`는 명시적 파일 나열만(-A 금지)
- `npm test`는 node ABI 필요. E2E/패키징 태스크는 종료 시 `npm run rebuild:node` + `npm test`로 휴지 상태 복원·보고

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/renderer/assets/grammars/*.tmLanguage.json` (신규 6) | 벤더링 문법 |
| `src/renderer/assets/themes/*.json` (신규 4) | 벤더링 테마 (include 병합 완료본) |
| `scripts/vendor-assets.mjs` (신규) | 벤더링 재현 스크립트 (다운로드+테마 include 병합) |
| `src/renderer/src/theming/convert.ts` (신규) | 테마 JSON → {monacoTheme, uiVars, kind} 순수 변환 |
| `src/renderer/src/theming/apply.ts` (신규) | defineTheme/setTheme + CSS 변수 주입 + kind dataset |
| `src/renderer/src/theming/bundled.ts` (신규) | 번들 테마 정적 목록/로더 |
| `src/renderer/src/snippets.ts` (신규) | 스니펫 파서 + provider 등록/재로드 |
| `src/renderer/assets/snippets/*.json` (신규 6) | 번들 기본 스니펫 |
| `src/renderer/src/textmate/registry.ts` (신규) | WASM 로드(ipc) + Registry + 언어별 지연 등록 |
| `src/renderer/src/textmate/adapter.ts` (신규) | TokensProvider 어댑터 (순수 변환 분리) |
| `src/main/settings.ts` (수정) | `appearance: { theme: string }` |
| `src/main/main.ts` (수정) | ipc: tm:onigWasm, theme:list/read/import, snippets:read/openFolder, settings:appearance:* |
| `src/preload/preload.ts` (수정) | 대응 API 노출 |
| `src/renderer/src/components/SettingsOverlay.tsx` (수정) | 외관 섹션 (테마 select/임포트/스니펫 폴더) |
| `src/renderer/src/components/EditorPane.tsx` (수정) | vs-dark 제거, TextMate 지연 등록 훅, 스니펫 provider 등록 |
| `src/renderer/src/components/ContextPanel.tsx` (수정) | vs-dark 제거 (si-theme 공유) |
| `src/renderer/src/theme.css` (수정) | sem 변수 프리셋 2벌 |
| `src/renderer/src/App.tsx` (수정) | 시작 시 테마 적용 |

---

### Task 1: 의존성 + 자산 벤더링 (문법 6, 테마 4, 라이선스)

**Files:**
- Modify: `package.json` (vscode-textmate, vscode-oniguruma → dependencies)
- Create: `scripts/vendor-assets.mjs`, `src/renderer/assets/grammars/*` (6+LICENSE.md), `src/renderer/assets/themes/*` (4+LICENSE.md)
- Test: `tests/vendored-assets.test.ts`

**Interfaces (Produces):** 자산 파일 경로 규약 — 문법: `c.tmLanguage.json`(source.c), `cpp.tmLanguage.json`(source.cpp), `python.tmLanguage.json`(source.python), `typescript.tmLanguage.json`(source.ts), `javascript.tmLanguage.json`(source.js), `java.tmLanguage.json`(source.java). 테마: `dark-plus.json`, `light-plus.json`, `monokai.json`, `one-dark-pro.json` (include 병합 완료, 각각 `name` 필드 보유).

- [ ] **Step 1: 의존성 설치**

```bash
npm i vscode-textmate vscode-oniguruma
```

- [ ] **Step 2: 벤더링 스크립트 작성** — `scripts/vendor-assets.mjs`

```js
// 벤더링 재현 스크립트 — VS Code 저장소(MIT)와 One Dark Pro(MIT)에서 문법/테마를 받아
// assets에 저장한다. 테마의 include 체인은 병합해 단일 파일로 만든다. (1회성/재현용)
import * as fs from 'fs';
import * as path from 'path';

const VSCODE = 'https://raw.githubusercontent.com/microsoft/vscode/1.101.0';
const GRAMMARS = [
  ['c.tmLanguage.json', `${VSCODE}/extensions/cpp/syntaxes/c.tmLanguage.json`],
  ['cpp.tmLanguage.json', `${VSCODE}/extensions/cpp/syntaxes/cpp.tmLanguage.json`],
  ['python.tmLanguage.json', `${VSCODE}/extensions/python/syntaxes/MagicPython.tmLanguage.json`],
  ['typescript.tmLanguage.json', `${VSCODE}/extensions/typescript-basics/syntaxes/TypeScript.tmLanguage.json`],
  ['javascript.tmLanguage.json', `${VSCODE}/extensions/javascript/syntaxes/JavaScript.tmLanguage.json`],
  ['java.tmLanguage.json', `${VSCODE}/extensions/java/syntaxes/java.tmLanguage.json`],
];
// [저장명, 메인 URL, include 체인 URL(안쪽부터)]
const THEMES = [
  ['dark-plus.json', `${VSCODE}/extensions/theme-defaults/themes/dark_plus.json`, [`${VSCODE}/extensions/theme-defaults/themes/dark_vs.json`]],
  ['light-plus.json', `${VSCODE}/extensions/theme-defaults/themes/light_plus.json`, [`${VSCODE}/extensions/theme-defaults/themes/light_vs.json`]],
  ['monokai.json', `${VSCODE}/extensions/theme-monokai/themes/monokai-color-theme.json`, []],
  ['one-dark-pro.json', 'https://raw.githubusercontent.com/Binaryify/OneDark-Pro/master/themes/OneDark-Pro.json', []],
];

const gDir = 'src/renderer/assets/grammars';
const tDir = 'src/renderer/assets/themes';
fs.mkdirSync(gDir, { recursive: true });
fs.mkdirSync(tDir, { recursive: true });

const fetchJson = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};

for (const [name, url] of GRAMMARS) {
  const j = await fetchJson(url);
  fs.writeFileSync(path.join(gDir, name), JSON.stringify(j));
  console.log('grammar', name, j.scopeName);
}

for (const [name, mainUrl, includes] of THEMES) {
  let merged = { colors: {}, tokenColors: [] };
  for (const incUrl of includes) {
    const inc = await fetchJson(incUrl);
    merged.colors = { ...merged.colors, ...(inc.colors ?? {}) };
    merged.tokenColors = [...merged.tokenColors, ...(inc.tokenColors ?? [])];
    merged.type = inc.type ?? merged.type;
  }
  const main = await fetchJson(mainUrl);
  merged = {
    name: main.name ?? name.replace('.json', ''),
    type: main.type ?? merged.type ?? 'dark',
    colors: { ...merged.colors, ...(main.colors ?? {}) },
    tokenColors: [...merged.tokenColors, ...(main.tokenColors ?? [])],
  };
  fs.writeFileSync(path.join(tDir, name), JSON.stringify(merged));
  console.log('theme', name, merged.type, merged.tokenColors.length, 'rules');
}
```

Run: `node scripts/vendor-assets.mjs`
Expected: 문법 6개(scopeName 출력)와 테마 4개(type/규칙 수 출력) 저장.

- [ ] **Step 3: LICENSE 고지 작성**

`src/renderer/assets/grammars/LICENSE.md`:
```md
# 출처 및 라이선스
아래 문법 파일은 microsoft/vscode 저장소(태그 1.101.0)에서 가져왔으며 MIT 라이선스를 따른다.
- c/cpp: extensions/cpp/syntaxes/ · python: extensions/python/syntaxes/MagicPython.tmLanguage.json
- typescript: extensions/typescript-basics/syntaxes/ · javascript: extensions/javascript/syntaxes/
- java: extensions/java/syntaxes/
MIT License — Copyright (c) Microsoft Corporation
```

`src/renderer/assets/themes/LICENSE.md`:
```md
# 출처 및 라이선스
- dark-plus/light-plus/monokai: microsoft/vscode(1.101.0) theme-defaults·theme-monokai — MIT, © Microsoft Corporation
  (include 체인을 scripts/vendor-assets.mjs로 병합한 단일 파일)
- one-dark-pro: Binaryify/OneDark-Pro — MIT, © Binaryify
```

- [ ] **Step 4: 벤더링 검증 테스트** — `tests/vendored-assets.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const G = 'src/renderer/assets/grammars';
const T = 'src/renderer/assets/themes';

describe('벤더링 자산', () => {
  it('문법 6종 존재 + scopeName 일치', () => {
    const expected: Record<string, string> = {
      'c.tmLanguage.json': 'source.c',
      'cpp.tmLanguage.json': 'source.cpp',
      'python.tmLanguage.json': 'source.python',
      'typescript.tmLanguage.json': 'source.ts',
      'javascript.tmLanguage.json': 'source.js',
      'java.tmLanguage.json': 'source.java',
    };
    for (const [file, scope] of Object.entries(expected)) {
      const j = JSON.parse(fs.readFileSync(path.join(G, file), 'utf8'));
      expect(j.scopeName, file).toBe(scope);
      expect(j.patterns?.length, file).toBeGreaterThan(0);
    }
  });

  it('테마 4종 존재 + 병합 완료 형태(name/type/colors/tokenColors, include 없음)', () => {
    for (const file of ['dark-plus.json', 'light-plus.json', 'monokai.json', 'one-dark-pro.json']) {
      const j = JSON.parse(fs.readFileSync(path.join(T, file), 'utf8'));
      expect(j.name, file).toBeTruthy();
      expect(['dark', 'light']).toContain(j.type);
      expect(Object.keys(j.colors).length, file).toBeGreaterThan(5);
      expect(j.tokenColors.length, file).toBeGreaterThan(5);
      expect(j.include, file).toBeUndefined();
    }
  });
});
```

Run: `npx vitest run tests/vendored-assets.test.ts` → PASS (실패하면 벤더링 재실행/URL 확인 — 스크립트의 URL이 404면 같은 저장소 내 최신 경로로 조정하고 보고서에 기록).

- [ ] **Step 5: 커밋** (자산 파일 전부 명시적 나열 — 디렉터리 단위 `git add src/renderer/assets/grammars src/renderer/assets/themes`는 허용, 신규 디렉터리라 스크래치 섞일 위험 없음)

```bash
git add package.json package-lock.json scripts/vendor-assets.mjs src/renderer/assets/grammars src/renderer/assets/themes tests/vendored-assets.test.ts
git commit -m "TextMate 기반: 의존성 + 문법 6종/테마 4종 벤더링 (라이선스 고지 포함)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 테마 변환기 theming/convert.ts (TDD)

**Files:**
- Create: `src/renderer/src/theming/convert.ts`
- Test: `tests/theming-convert.test.ts`

**Interfaces (Produces):**

```ts
export interface ConvertedTheme {
  name: string;
  kind: 'dark' | 'light';
  monacoTheme: {
    base: 'vs' | 'vs-dark';
    inherit: true;
    rules: { token: string; foreground?: string; fontStyle?: string }[];
    colors: Record<string, string>;
  };
  uiVars: Record<string, string>; // '--bg' 등 theme.css 변수 → 색
}
export function convertTheme(raw: unknown): ConvertedTheme | null; // 손상 시 null
```

**uiVars 매핑표 (theme.css 변수 ← VS Code colors 키, 앞선 키 우선·없으면 항목 생략):**

| CSS 변수 | VS Code colors 키 (우선순위순) |
|---|---|
| `--bg` | `editor.background` |
| `--bg-panel` | `sideBar.background`, `editor.background` |
| `--bg-hover` | `list.hoverBackground` |
| `--bg-active` | `list.activeSelectionBackground` |
| `--border` | `panel.border`, `editorGroup.border`, `contrastBorder` |
| `--fg` | `foreground`, `editor.foreground` |
| `--fg-dim` | `descriptionForeground` |
| `--accent` | `focusBorder`, `button.background` |
| `--warn` | `editorWarning.foreground` |
| `--sem-kind` | (직접 매핑 없음 — Task 6의 kind 프리셋이 담당, uiVars에 미포함) |

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/theming-convert.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { convertTheme } from '../src/renderer/src/theming/convert';

const sample = {
  name: 'Sample', type: 'light',
  colors: {
    'editor.background': '#ffffff', 'sideBar.background': '#f3f3f3',
    'foreground': '#333333', 'focusBorder': '#0090f1',
    'list.hoverBackground': '#e8e8e8',
  },
  tokenColors: [
    { scope: 'comment', settings: { foreground: '#008000', fontStyle: 'italic' } },
    { scope: ['string.quoted', 'string.template'], settings: { foreground: '#a31515' } },
    { scope: 'keyword.control, storage.type', settings: { foreground: '#0000ff' } },
    { settings: { foreground: '#333333' } }, // scope 없음 = 전역 기본 → rules 제외
    { scope: 'invalid.token', settings: {} }, // foreground/fontStyle 없음 → 제외
  ],
};

describe('convertTheme', () => {
  it('kind/base 판별과 rules 생성 (배열/쉼표 scope 전개, # 제거)', () => {
    const t = convertTheme(sample)!;
    expect(t.kind).toBe('light');
    expect(t.monacoTheme.base).toBe('vs');
    expect(t.monacoTheme.inherit).toBe(true);
    const tokens = t.monacoTheme.rules.map((r) => r.token);
    expect(tokens).toEqual(['comment', 'string.quoted', 'string.template', 'keyword.control', 'storage.type']);
    expect(t.monacoTheme.rules[0]).toEqual({ token: 'comment', foreground: '008000', fontStyle: 'italic' });
    expect(t.monacoTheme.rules[1].foreground).toBe('a31515');
  });

  it('monacoTheme.colors에 editor.* 색 전달 + uiVars 매핑표 적용', () => {
    const t = convertTheme(sample)!;
    expect(t.monacoTheme.colors['editor.background']).toBe('#ffffff');
    expect(t.uiVars['--bg']).toBe('#ffffff');
    expect(t.uiVars['--bg-panel']).toBe('#f3f3f3');
    expect(t.uiVars['--fg']).toBe('#333333');
    expect(t.uiVars['--accent']).toBe('#0090f1');
    expect(t.uiVars['--bg-hover']).toBe('#e8e8e8');
    expect(t.uiVars['--warn']).toBeUndefined(); // 원본에 없음 → 생략(기존 CSS 기본값 유지)
  });

  it('type 없으면 dark, 손상 입력은 null', () => {
    expect(convertTheme({ name: 'x', colors: {}, tokenColors: [] })!.kind).toBe('dark');
    expect(convertTheme(null)).toBeNull();
    expect(convertTheme({ tokenColors: 'oops' })).toBeNull();
    expect(convertTheme('not object')).toBeNull();
  });

  it('번들 테마 4종 실변환 스모크', () => {
    for (const f of ['dark-plus.json', 'light-plus.json', 'monokai.json', 'one-dark-pro.json']) {
      const raw = JSON.parse(fs.readFileSync(`src/renderer/assets/themes/${f}`, 'utf8'));
      const t = convertTheme(raw);
      expect(t, f).not.toBeNull();
      expect(t!.monacoTheme.rules.length, f).toBeGreaterThan(5);
      expect(t!.uiVars['--bg'], f).toBeTruthy();
    }
    expect(convertTheme(JSON.parse(fs.readFileSync('src/renderer/assets/themes/light-plus.json', 'utf8')))!.kind).toBe('light');
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/theming-convert.test.ts` → 모듈 없음 FAIL

- [ ] **Step 3: convert.ts 구현**

```ts
// VS Code 테마 JSON → Monaco defineTheme + 앱 CSS 변수. 순수 함수 — DOM/monaco 임포트 금지.
export interface ConvertedTheme {
  name: string;
  kind: 'dark' | 'light';
  monacoTheme: {
    base: 'vs' | 'vs-dark';
    inherit: true;
    rules: { token: string; foreground?: string; fontStyle?: string }[];
    colors: Record<string, string>;
  };
  uiVars: Record<string, string>;
}

// theme.css 변수 ← VS Code colors 키 (앞선 키 우선)
const UI_VAR_SOURCES: Record<string, string[]> = {
  '--bg': ['editor.background'],
  '--bg-panel': ['sideBar.background', 'editor.background'],
  '--bg-hover': ['list.hoverBackground'],
  '--bg-active': ['list.activeSelectionBackground'],
  '--border': ['panel.border', 'editorGroup.border', 'contrastBorder'],
  '--fg': ['foreground', 'editor.foreground'],
  '--fg-dim': ['descriptionForeground'],
  '--accent': ['focusBorder', 'button.background'],
  '--warn': ['editorWarning.foreground'],
};

interface RawTokenColor { scope?: string | string[]; settings?: { foreground?: string; fontStyle?: string } }

export function convertTheme(raw: unknown): ConvertedTheme | null {
  if (raw == null || typeof raw !== 'object') return null;
  const t = raw as { name?: string; type?: string; colors?: Record<string, string>; tokenColors?: unknown };
  if (t.tokenColors != null && !Array.isArray(t.tokenColors)) return null;
  const colors = t.colors && typeof t.colors === 'object' ? t.colors : {};
  const kind: 'dark' | 'light' = t.type === 'light' ? 'light' : 'dark';

  const rules: ConvertedTheme['monacoTheme']['rules'] = [];
  for (const tc of (t.tokenColors ?? []) as RawTokenColor[]) {
    if (!tc?.scope || !tc.settings) continue; // 전역 기본(scope 없음)은 base가 담당
    const { foreground, fontStyle } = tc.settings;
    if (!foreground && !fontStyle) continue;
    const scopes = (Array.isArray(tc.scope) ? tc.scope : tc.scope.split(','))
      .map((s) => s.trim())
      .filter(Boolean);
    for (const scope of scopes) {
      const rule: (typeof rules)[number] = { token: scope };
      if (foreground) rule.foreground = foreground.replace(/^#/, '');
      if (fontStyle) rule.fontStyle = fontStyle;
      rules.push(rule);
    }
  }

  const uiVars: Record<string, string> = {};
  for (const [cssVar, sources] of Object.entries(UI_VAR_SOURCES)) {
    for (const key of sources) {
      const v = colors[key];
      if (typeof v === 'string' && v) {
        uiVars[cssVar] = v;
        break;
      }
    }
  }

  return {
    name: typeof t.name === 'string' && t.name ? t.name : 'theme',
    kind,
    monacoTheme: { base: kind === 'light' ? 'vs' : 'vs-dark', inherit: true, rules, colors },
    uiVars,
  };
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run tests/theming-convert.test.ts` → PASS

- [ ] **Step 5: 커밋**

```bash
git add src/renderer/src/theming/convert.ts tests/theming-convert.test.ts
git commit -m "테마 변환기: VS Code 테마 JSON → Monaco 규칙 + 앱 CSS 변수 (순수 함수)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 스니펫 파서 + 번들 기본 세트 (TDD)

**Files:**
- Create: `src/renderer/src/snippets.ts` (파서·병합 순수 부분 + provider 등록 함수), `src/renderer/assets/snippets/{typescript,javascript,python,java,c,cpp}.json`
- Test: `tests/snippets.test.ts`

**Interfaces (Produces):**

```ts
export interface SnippetDef { label: string; prefix: string; body: string; description?: string }
export function parseSnippetFile(raw: unknown): SnippetDef[];           // 손상 항목 무시
export function mergeSnippets(bundled: SnippetDef[], user: SnippetDef[]): SnippetDef[]; // 같은 prefix는 user 우선
export function registerSnippetProviders(monaco: typeof Monaco): void;  // 앱 수명 1회
export function refreshSnippets(): void;                                // 사용자 파일 캐시 무효화(설정 저장 시)
```

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/snippets.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { parseSnippetFile, mergeSnippets } from '../src/renderer/src/snippets';

describe('parseSnippetFile', () => {
  it('VS Code 포맷: body 배열은 \\n join, placeholder 보존', () => {
    const raw = {
      'Console log': { prefix: 'log', body: ['console.log($1);', '$0'], description: '로그' },
      'If': { prefix: 'if', body: 'if (${1:cond}) { $0 }' },
    };
    const out = parseSnippetFile(raw);
    expect(out).toEqual([
      { label: 'Console log', prefix: 'log', body: 'console.log($1);\n$0', description: '로그' },
      { label: 'If', prefix: 'if', body: 'if (${1:cond}) { $0 }', description: undefined },
    ]);
  });

  it('손상 항목만 무시 (prefix/body 누락, 비정형 입력)', () => {
    const raw = {
      good: { prefix: 'g', body: 'x' },
      noPrefix: { body: 'x' },
      noBody: { prefix: 'n' },
      weird: 42,
    };
    expect(parseSnippetFile(raw).map((s) => s.prefix)).toEqual(['g']);
    expect(parseSnippetFile(null)).toEqual([]);
    expect(parseSnippetFile('str')).toEqual([]);
  });
});

describe('mergeSnippets', () => {
  it('같은 prefix는 사용자 우선, 나머지는 합집합', () => {
    const bundled = [
      { label: 'B-log', prefix: 'log', body: 'B' },
      { label: 'B-if', prefix: 'if', body: 'B' },
    ];
    const user = [{ label: 'U-log', prefix: 'log', body: 'U' }];
    const out = mergeSnippets(bundled, user);
    expect(out.find((s) => s.prefix === 'log')!.label).toBe('U-log');
    expect(out.find((s) => s.prefix === 'if')!.label).toBe('B-if');
    expect(out).toHaveLength(2);
  });
});

describe('번들 기본 세트', () => {
  it('6언어 파일이 파스되고 각 3개 이상', () => {
    for (const lang of ['typescript', 'javascript', 'python', 'java', 'c', 'cpp']) {
      const raw = JSON.parse(fs.readFileSync(`src/renderer/assets/snippets/${lang}.json`, 'utf8'));
      expect(parseSnippetFile(raw).length, lang).toBeGreaterThanOrEqual(3);
    }
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/snippets.test.ts` → FAIL

- [ ] **Step 3: 번들 기본 세트 작성** — 각 언어 파일 (VS Code 포맷 그대로):

`typescript.json` (javascript.json도 동일 내용으로 저장):
```json
{
  "Console log": { "prefix": "log", "body": ["console.log($1);$0"], "description": "console.log" },
  "Arrow function": { "prefix": "fn", "body": ["const ${1:name} = (${2:args}) => {", "\t$0", "};"], "description": "화살표 함수" },
  "If": { "prefix": "if", "body": ["if (${1:condition}) {", "\t$0", "}"] },
  "For of": { "prefix": "forof", "body": ["for (const ${1:item} of ${2:items}) {", "\t$0", "}"] },
  "Try/catch": { "prefix": "try", "body": ["try {", "\t$1", "} catch (e) {", "\t$0", "}"] }
}
```

`python.json`:
```json
{
  "Function": { "prefix": "def", "body": ["def ${1:name}(${2:args}):", "\t$0"] },
  "Main guard": { "prefix": "main", "body": ["if __name__ == \"__main__\":", "\t$0"] },
  "For": { "prefix": "for", "body": ["for ${1:item} in ${2:items}:", "\t$0"] },
  "Try/except": { "prefix": "try", "body": ["try:", "\t$1", "except ${2:Exception} as e:", "\t$0"] },
  "Class": { "prefix": "class", "body": ["class ${1:Name}:", "\tdef __init__(self$2):", "\t\t$0"] }
}
```

`java.json`:
```json
{
  "Main method": { "prefix": "psvm", "body": ["public static void main(String[] args) {", "\t$0", "}"] },
  "Print": { "prefix": "sout", "body": ["System.out.println($1);$0"] },
  "For": { "prefix": "fori", "body": ["for (int ${1:i} = 0; $1 < ${2:n}; $1++) {", "\t$0", "}"] },
  "Try/catch": { "prefix": "try", "body": ["try {", "\t$1", "} catch (${2:Exception} e) {", "\t$0", "}"] }
}
```

`c.json` (cpp.json도 동일 + 아래 cout 추가):
```json
{
  "Main": { "prefix": "main", "body": ["int main(int argc, char *argv[]) {", "\t$0", "\treturn 0;", "}"] },
  "For": { "prefix": "for", "body": ["for (int ${1:i} = 0; $1 < ${2:n}; $1++) {", "\t$0", "}"] },
  "Include": { "prefix": "inc", "body": ["#include <${1:stdio.h}>$0"] },
  "Printf": { "prefix": "pr", "body": ["printf(\"${1:%d}\\n\", $2);$0"] }
}
```
(`cpp.json`에는 추가로 `"Cout": { "prefix": "cout", "body": ["std::cout << $1 << std::endl;$0"] }`.)

- [ ] **Step 4: snippets.ts 구현**

```ts
// VS Code 스니펫 JSON 포맷 지원 — 파서/병합은 순수, provider 등록은 Monaco 배선.
import type * as Monaco from 'monaco-editor';

export interface SnippetDef { label: string; prefix: string; body: string; description?: string }

export function parseSnippetFile(raw: unknown): SnippetDef[] {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const out: SnippetDef[] = [];
  for (const [label, def] of Object.entries(raw as Record<string, unknown>)) {
    const d = def as { prefix?: unknown; body?: unknown; description?: unknown };
    if (typeof d?.prefix !== 'string' || !d.prefix) continue;
    const body = Array.isArray(d.body)
      ? (d.body as unknown[]).filter((l) => typeof l === 'string').join('\n')
      : typeof d.body === 'string'
        ? d.body
        : null;
    if (body == null || body === '') continue;
    out.push({
      label,
      prefix: d.prefix,
      body,
      description: typeof d.description === 'string' ? d.description : undefined,
    });
  }
  return out;
}

export function mergeSnippets(bundled: SnippetDef[], user: SnippetDef[]): SnippetDef[] {
  const byPrefix = new Map<string, SnippetDef>();
  for (const s of bundled) byPrefix.set(s.prefix, s);
  for (const s of user) byPrefix.set(s.prefix, s); // 사용자 우선
  return [...byPrefix.values()];
}

// ── Monaco 배선 (앱 수명 1회) ──
const SNIPPET_LANGS = ['typescript', 'javascript', 'python', 'java', 'c', 'cpp'] as const;

// 번들 세트 — vite json import (정적)
import tsSnip from '../assets/snippets/typescript.json';
import jsSnip from '../assets/snippets/javascript.json';
import pySnip from '../assets/snippets/python.json';
import javaSnip from '../assets/snippets/java.json';
import cSnip from '../assets/snippets/c.json';
import cppSnip from '../assets/snippets/cpp.json';

const BUNDLED: Record<(typeof SNIPPET_LANGS)[number], unknown> = {
  typescript: tsSnip, javascript: jsSnip, python: pySnip, java: javaSnip, c: cSnip, cpp: cppSnip,
};

let registered = false;
const userCache = new Map<string, SnippetDef[]>(); // lang → 사용자 스니펫

export function refreshSnippets(): void {
  userCache.clear(); // 다음 완성 요청 때 재로드
}

async function snippetsFor(lang: (typeof SNIPPET_LANGS)[number]): Promise<SnippetDef[]> {
  let user = userCache.get(lang);
  if (!user) {
    const raw = await window.si.snippetsRead(lang).catch(() => null);
    user = raw ? parseSnippetFile(raw) : [];
    userCache.set(lang, user);
  }
  return mergeSnippets(parseSnippetFile(BUNDLED[lang]), user);
}

export function registerSnippetProviders(monaco: typeof Monaco): void {
  if (registered) return;
  registered = true;
  monaco.languages.registerCompletionItemProvider([...SNIPPET_LANGS], {
    async provideCompletionItems(model, position) {
      const lang = model.getLanguageId() as (typeof SNIPPET_LANGS)[number];
      if (!SNIPPET_LANGS.includes(lang)) return { suggestions: [] };
      const defs = await snippetsFor(lang);
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, position.column);
      return {
        suggestions: defs.map((s) => ({
          label: { label: s.prefix, description: s.label },
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: s.body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: s.description ?? s.label,
          range,
        })),
      };
    },
  });
}
```

**주의**: `window.si.snippetsRead`는 Task 5에서 추가된다 — 이 태스크의 vitest는 순수 부분(parse/merge/번들 파스)만 대상이라 typecheck를 위해 Task 5 이전에는 `(window as any).si?.snippetsRead` 형태를 쓰지 말고, 이 파일의 커밋을 **파서/병합/자산까지만** 하고 provider 부분은 주석 없이 포함하되 `npm run build`는 Task 5 완료 후에만 요구된다면 순서 꼬임이 생긴다. **해결: 이 태스크에서는 provider 포함 전체를 작성하되, preload 타입(`snippetsRead`)을 Task 5가 아니라 이 태스크에서 미리 추가한다** — preload에 `snippetsRead: (lang: string): Promise<unknown | null> => ipcRenderer.invoke('snippets:read', lang)` 1줄과 main에 최소 핸들러(`ipcMain.handle('snippets:read', ...)` — userData/snippets/<lang>.json 읽기, 없으면 null)를 함께 넣는다. Files에 `src/preload/preload.ts`, `src/main/main.ts` 추가.

main 핸들러 (registerIpc 안):
```ts
  ipcMain.handle('snippets:read', (_e, lang: string) => {
    if (!/^[a-z]+$/.test(lang)) return null; // 경로 주입 방어
    const p = path.join(app.getPath('userData'), 'snippets', `${lang}.json`);
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null; // 없음/손상 → 번들만 사용
    }
  });
```
(main.ts에 `import * as fs from 'fs';` 필요 시 추가.)

- [ ] **Step 5: 통과 확인 + 빌드** — `npx vitest run tests/snippets.test.ts` PASS, `npm run build` 그린

- [ ] **Step 6: 커밋**

```bash
git add src/renderer/src/snippets.ts src/renderer/assets/snippets tests/snippets.test.ts src/preload/preload.ts src/main/main.ts
git commit -m "스니펫: VS Code 포맷 파서/병합 + 번들 기본 세트 + 완성 provider (사용자 파일 ipc 포함)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: TextMate registry + adapter + 통합 테스트/벤치

**Files:**
- Create: `src/renderer/src/textmate/registry.ts`, `src/renderer/src/textmate/adapter.ts`
- Modify: `src/main/main.ts`, `src/preload/preload.ts` (tm:onigWasm ipc)
- Test: `tests/textmate-grammars.test.ts` (통합 — 실문법 scope 검증 + 벤치)

**Interfaces:**
- Consumes: 자산(Task 1)
- Produces:
  - `ensureLanguageRegistered(monaco, languageId): Promise<boolean>` — 지연 등록, 성공/실패 반환 (registry.ts)
  - `tmTokensToMonaco(tokens: IToken[]): { startIndex: number; scopes: string }[]` — 순수 변환 (adapter.ts)
  - preload: `onigWasm(): Promise<ArrayBuffer>`

**WASM 공급 경로 (설계 §3 보강 — file:// fetch 제약 회피):** 렌더러가 WASM을 fetch하지 않고 **main이 ipc로 바이트를 공급**한다. main은 `require.resolve('vscode-oniguruma')`(→ release/main.js)의 디렉터리에서 `onig.wasm`을 `fs.readFileSync`로 읽는다 — asar 투명 읽기가 되므로 패키지 앱에서도 동일 경로로 동작한다.

- [ ] **Step 1: main + preload에 WASM ipc**

main.ts registerIpc에:
```ts
  ipcMain.handle('tm:onigWasm', () => {
    const dir = path.dirname(require.resolve('vscode-oniguruma'));
    return fs.readFileSync(path.join(dir, 'onig.wasm')); // Buffer → 렌더러에서 ArrayBuffer
  });
```
preload:
```ts
  onigWasm: async (): Promise<ArrayBuffer> => {
    const buf: Uint8Array = await ipcRenderer.invoke('tm:onigWasm');
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  },
```

- [ ] **Step 2: adapter.ts 구현 (순수 변환 분리)**

```ts
// TextMate 토큰 → Monaco TokensProvider. tm scope의 마지막(최상세) scope를 Monaco 토큰 문자열로 사용
// — defineTheme 규칙이 점 표기 접두사 매칭하므로 테마 scope와 자연 정합.
import type * as Monaco from 'monaco-editor';
import type { IGrammar, StateStack } from 'vscode-textmate';

const MAX_LINE_LEN = 10_000; // 초장문 라인은 토크나이즈 생략 (성능 가드)
const TOKENIZE_TIME_LIMIT_MS = 50;

export function tmTokensToMonaco(
  tokens: { startIndex: number; scopes: string[] }[],
): { startIndex: number; scopes: string }[] {
  return tokens.map((t) => ({ startIndex: t.startIndex, scopes: t.scopes[t.scopes.length - 1] ?? '' }));
}

class TmState implements Monaco.languages.IState {
  constructor(public readonly stack: StateStack) {}
  clone(): TmState {
    return new TmState(this.stack);
  }
  equals(other: Monaco.languages.IState): boolean {
    return other instanceof TmState && other.stack === this.stack;
  }
}

export function createTokensProvider(grammar: IGrammar, initial: StateStack): Monaco.languages.TokensProvider {
  return {
    getInitialState: () => new TmState(initial),
    tokenize(line, state) {
      const stack = (state as TmState).stack;
      if (line.length > MAX_LINE_LEN) {
        return { tokens: [{ startIndex: 0, scopes: '' }], endState: state.clone() };
      }
      const r = grammar.tokenizeLine(line, stack, TOKENIZE_TIME_LIMIT_MS);
      return { tokens: tmTokensToMonaco(r.tokens), endState: new TmState(r.ruleStack) };
    },
  };
}
```

- [ ] **Step 3: registry.ts 구현**

```ts
// oniguruma WASM(ipc 공급) + vscode-textmate Registry. 언어별 지연 등록, 실패 시 monarch 잔존(자연 폴백).
import type * as Monaco from 'monaco-editor';
import { Registry, parseRawGrammar, INITIAL } from 'vscode-textmate';
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma';
import { createTokensProvider } from './adapter';

// vite ?raw — 문법 JSON 원문 문자열
import cRaw from '../../assets/grammars/c.tmLanguage.json?raw';
import cppRaw from '../../assets/grammars/cpp.tmLanguage.json?raw';
import pyRaw from '../../assets/grammars/python.tmLanguage.json?raw';
import tsRaw from '../../assets/grammars/typescript.tmLanguage.json?raw';
import jsRaw from '../../assets/grammars/javascript.tmLanguage.json?raw';
import javaRaw from '../../assets/grammars/java.tmLanguage.json?raw';

const LANG_TO_SCOPE: Record<string, string> = {
  c: 'source.c', cpp: 'source.cpp', python: 'source.python',
  typescript: 'source.ts', javascript: 'source.js', java: 'source.java',
};
const SCOPE_TO_RAW: Record<string, string> = {
  'source.c': cRaw, 'source.cpp': cppRaw, 'source.python': pyRaw,
  'source.ts': tsRaw, 'source.js': jsRaw, 'source.java': javaRaw,
};

let registryPromise: Promise<Registry | null> | null = null;
const registeredLangs = new Set<string>();

function getRegistry(): Promise<Registry | null> {
  registryPromise ??= (async () => {
    try {
      await loadWASM(await window.si.onigWasm());
      return new Registry({
        onigLib: Promise.resolve({
          createOnigScanner: (patterns) => new OnigScanner(patterns),
          createOnigString: (s) => new OnigString(s),
        }),
        loadGrammar: async (scopeName) => {
          const raw = SCOPE_TO_RAW[scopeName];
          return raw ? parseRawGrammar(raw, `${scopeName}.json`) : null;
        },
      });
    } catch (e) {
      console.error('[textmate] WASM/Registry 초기화 실패 — monarch 유지:', e);
      return null;
    }
  })();
  return registryPromise;
}

/** 언어의 TextMate 토크나이저를 지연 등록. 성공 여부 반환 (실패 시 monarch 유지). */
export async function ensureLanguageRegistered(monaco: typeof Monaco, languageId: string): Promise<boolean> {
  const scope = LANG_TO_SCOPE[languageId];
  if (!scope) return false;
  if (registeredLangs.has(languageId)) return true;
  const registry = await getRegistry();
  if (!registry) return false;
  try {
    const grammar = await registry.loadGrammar(scope);
    if (!grammar) return false;
    monaco.languages.setTokensProvider(languageId, createTokensProvider(grammar, INITIAL));
    registeredLangs.add(languageId);
    return true;
  } catch (e) {
    console.error(`[textmate] ${languageId} 문법 등록 실패 — monarch 유지:`, e);
    return false;
  }
}
```

- [ ] **Step 4: 통합 테스트 작성** — `tests/textmate-grammars.test.ts` (node 환경 — WASM은 node_modules에서 직접 읽음, 렌더러 모듈이 아니라 vscode-textmate 코어를 검증)

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Registry, parseRawGrammar, INITIAL } from 'vscode-textmate';
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma';
import { tmTokensToMonaco } from '../src/renderer/src/textmate/adapter';

const G = 'src/renderer/assets/grammars';
let registry: Registry;

const SCOPE_FILE: Record<string, string> = {
  'source.c': 'c.tmLanguage.json', 'source.cpp': 'cpp.tmLanguage.json',
  'source.python': 'python.tmLanguage.json', 'source.ts': 'typescript.tmLanguage.json',
  'source.js': 'javascript.tmLanguage.json', 'source.java': 'java.tmLanguage.json',
};

beforeAll(async () => {
  const wasmDir = path.dirname(require.resolve('vscode-oniguruma'));
  const wasm = fs.readFileSync(path.join(wasmDir, 'onig.wasm'));
  await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (p) => new OnigScanner(p),
      createOnigString: (s) => new OnigString(s),
    }),
    loadGrammar: async (scope) => {
      const f = SCOPE_FILE[scope];
      return f ? parseRawGrammar(fs.readFileSync(path.join(G, f), 'utf8'), f) : null;
    },
  });
});

async function scopesOf(scope: string, line: string): Promise<string[]> {
  const grammar = (await registry.loadGrammar(scope))!;
  const r = grammar.tokenizeLine(line, INITIAL);
  return r.tokens.flatMap((t) => t.scopes);
}

describe('실문법 scope 검증 (언어별 대표 라인)', () => {
  it('TS 문자열/키워드', async () => {
    const scopes = await scopesOf('source.ts', "const s = 'hello';");
    expect(scopes.some((s) => s.startsWith('string.quoted'))).toBe(true);
    expect(scopes.some((s) => s.startsWith('storage.type') || s.startsWith('keyword'))).toBe(true);
  });
  it('Python 함수 정의', async () => {
    const scopes = await scopesOf('source.python', 'def greet(name):');
    expect(scopes.some((s) => s.includes('function'))).toBe(true);
  });
  it('Java 클래스 키워드', async () => {
    const scopes = await scopesOf('source.java', 'public class Main {');
    expect(scopes.some((s) => s.startsWith('storage.modifier') || s.startsWith('keyword'))).toBe(true);
  });
  it('C 전처리기', async () => {
    const scopes = await scopesOf('source.c', '#include <stdio.h>');
    expect(scopes.some((s) => s.includes('include') || s.includes('preprocessor'))).toBe(true);
  });
  it('C++ / JS 주석', async () => {
    expect((await scopesOf('source.cpp', '// comment')).some((s) => s.startsWith('comment'))).toBe(true);
    expect((await scopesOf('source.js', '// comment')).some((s) => s.startsWith('comment'))).toBe(true);
  });
});

describe('어댑터 순수 변환', () => {
  it('마지막 scope를 Monaco 토큰으로', () => {
    expect(
      tmTokensToMonaco([{ startIndex: 0, scopes: ['source.ts', 'string.quoted.single.ts'] }]),
    ).toEqual([{ startIndex: 0, scopes: 'string.quoted.single.ts' }]);
    expect(tmTokensToMonaco([{ startIndex: 0, scopes: [] }])).toEqual([{ startIndex: 0, scopes: '' }]);
  });
});

describe('벤치 (회귀 기준선 기록)', () => {
  it('TS 3000줄 tokenize 시간 측정', async () => {
    const grammar = (await registry.loadGrammar('source.ts'))!;
    const line = "export function compute(a: number, b: string): string { return `${a}-${b}`.toUpperCase(); } // note";
    let stack = INITIAL;
    const t0 = performance.now();
    for (let i = 0; i < 3000; i++) stack = grammar.tokenizeLine(line, stack).ruleStack;
    const ms = performance.now() - t0;
    console.log(`[bench] TS 3000줄 tokenize: ${Math.round(ms)}ms`);
    expect(ms).toBeLessThan(5_000); // 넉넉한 상한 — 회귀 감지용
  });
});
```

- [ ] **Step 5: 실행/통과** — `npx vitest run tests/textmate-grammars.test.ts` → PASS (scope 기대값이 실문법과 어긋나면 실제 scope에 맞게 조정하되 "해당 구문이 유의미한 scope를 받는다" 검증 의도 유지, 조정은 보고서에 기록). `npm run build` 그린 확인 (renderer 타입체크에 registry/adapter 포함, `?raw` import는 vite 전용이라 `src/renderer/src/vite-env.d.ts` 또는 기존 글로벌 선언에 `declare module '*.tmLanguage.json?raw'`가 필요하면 추가).

- [ ] **Step 6: 커밋**

```bash
git add src/renderer/src/textmate/registry.ts src/renderer/src/textmate/adapter.ts src/main/main.ts src/preload/preload.ts tests/textmate-grammars.test.ts
git commit -m "TextMate 토크나이저: WASM ipc 공급 + Registry 지연 등록 + Monaco 어댑터 (실문법 검증/벤치)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 테마 저장/ipc — settings appearance + theme:list/read/import

**Files:**
- Modify: `src/main/settings.ts`, `src/main/main.ts`, `src/preload/preload.ts`
- Test: `tests/settings-store.test.ts` (appearance 케이스 추가)

**Interfaces (Produces):**
- SettingsStore: `getAppearance(): { theme: string }` (기본 `{ theme: 'dark-plus' }`), `setAppearance(a: { theme: string }): void`
- preload: `getAppearance()`, `setAppearance(a)`, `themeList(): Promise<{ id: string; name: string }[]>` (임포트된 것만), `themeRead(id): Promise<unknown | null>` (임포트된 것만 — 번들은 렌더러 정적), `themeImport(): Promise<{ id: string; name: string } | { error: string } | null>` (다이얼로그 취소 시 null), `snippetsOpenFolder(): Promise<void>`

- [ ] **Step 1: settings-store 테스트 추가** (기존 describe 뒤에)

```ts
describe('appearance', () => {
  it('기본값 dark-plus, set→get 라운드트립, completion과 독립', () => {
    const store = new SettingsStore(baseDir);
    expect(store.getAppearance()).toEqual({ theme: 'dark-plus' });
    store.setAppearance({ theme: 'monokai' });
    expect(store.getAppearance()).toEqual({ theme: 'monokai' });
    store.setCompletion({ provider: 'none', model: '' });
    expect(store.getAppearance()).toEqual({ theme: 'monokai' }); // completion 저장이 appearance 보존
    const store2 = new SettingsStore(baseDir);
    expect(store2.getAppearance().theme).toBe('monokai');
  });
});
```

- [ ] **Step 2: settings.ts 구현** — `SettingsFile`에 `appearance?: { theme: string }` 추가, read/write가 보존하도록 (기존 `read()`는 completion만 검사하므로 파일 전체를 유지·병합하는 형태로 수정):

```ts
interface SettingsFile {
  completion: StoredCompletionSettings;
  appearance?: { theme: string };
}
```

`setCompletion`의 `this.write({ completion: next })`를 `this.write({ ...file, completion: next })`로 변경 (appearance 보존). 추가 메서드:

```ts
  getAppearance(): { theme: string } {
    return this.read().appearance ?? { theme: 'dark-plus' };
  }

  setAppearance(a: { theme: string }): void {
    const file = this.read();
    this.write({ ...file, appearance: { theme: a.theme } });
  }
```

- [ ] **Step 3: main ipc** (registerIpc에)

```ts
  ipcMain.handle('settings:appearance:get', () => settingsStore.getAppearance());
  ipcMain.handle('settings:appearance:set', (_e, a: { theme: string }) => settingsStore.setAppearance(a));

  const themesDir = () => path.join(app.getPath('userData'), 'themes');
  ipcMain.handle('theme:list', () => {
    try {
      return fs.readdirSync(themesDir())
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const id = `user:${f.slice(0, -5)}`;
          try {
            const name = (JSON.parse(fs.readFileSync(path.join(themesDir(), f), 'utf8')) as { name?: string }).name;
            return { id, name: name || f.slice(0, -5) };
          } catch {
            return { id, name: f.slice(0, -5) };
          }
        });
    } catch {
      return []; // 폴더 없음
    }
  });
  ipcMain.handle('theme:read', (_e, id: string) => {
    if (!id.startsWith('user:') || id.includes('..') || id.includes('/')) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(themesDir(), `${id.slice(5)}.json`), 'utf8'));
    } catch {
      return null;
    }
  });
  ipcMain.handle('theme:import', async () => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'VS Code 테마', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')) as { name?: string; colors?: unknown; tokenColors?: unknown };
      if (!raw.tokenColors && !raw.colors) return { error: 'VS Code 테마 형식이 아닙니다 (colors/tokenColors 없음)' };
      fs.mkdirSync(themesDir(), { recursive: true });
      const base = path.basename(r.filePaths[0], '.json').replace(/[^\w-]/g, '_');
      fs.writeFileSync(path.join(themesDir(), `${base}.json`), JSON.stringify(raw));
      return { id: `user:${base}`, name: raw.name || base };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('snippets:openFolder', async () => {
    const dir = path.join(app.getPath('userData'), 'snippets');
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
  });
```
(`shell`을 electron import에 추가.)

- [ ] **Step 4: preload API 추가** — 위 Interfaces의 6개 함수를 ipc invoke로 배선 (기존 api 객체 스타일 그대로).

- [ ] **Step 5: 검증 + 커밋** — `npx vitest run tests/settings-store.test.ts` PASS, `npm run build` 그린.

```bash
git add src/main/settings.ts src/main/main.ts src/preload/preload.ts tests/settings-store.test.ts
git commit -m "테마 저장/ipc: appearance 설정 + 테마 목록/읽기/임포트 + 스니펫 폴더 열기

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 렌더러 배선 — 테마 적용/전환 UI + TextMate/스니펫 훅 + sem 프리셋

**Files:**
- Create: `src/renderer/src/theming/apply.ts`, `src/renderer/src/theming/bundled.ts`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/components/EditorPane.tsx`, `src/renderer/src/components/ContextPanel.tsx`, `src/renderer/src/components/SettingsOverlay.tsx`, `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: convert(Task 2), registry(Task 4), snippets(Task 3), preload(Task 5)
- Produces: `applyThemeById(monaco, id): Promise<void>` — 번들/user: 해석→convert→적용, 실패 시 dark-plus 폴백 (apply.ts), `BUNDLED_THEMES: { id, name }[]` (bundled.ts)

- [ ] **Step 1: bundled.ts**

```ts
// 번들 테마 정적 목록 — vite json import
import darkPlus from '../../assets/themes/dark-plus.json';
import lightPlus from '../../assets/themes/light-plus.json';
import monokai from '../../assets/themes/monokai.json';
import oneDarkPro from '../../assets/themes/one-dark-pro.json';

export const BUNDLED_THEME_DATA: Record<string, unknown> = {
  'dark-plus': darkPlus, 'light-plus': lightPlus, monokai, 'one-dark-pro': oneDarkPro,
};
export const BUNDLED_THEMES = [
  { id: 'dark-plus', name: 'Dark+ (기본)' },
  { id: 'light-plus', name: 'Light+' },
  { id: 'monokai', name: 'Monokai' },
  { id: 'one-dark-pro', name: 'One Dark Pro' },
];
```

- [ ] **Step 2: apply.ts**

```ts
// 테마 적용 — defineTheme/setTheme + CSS 변수 주입 + kind dataset (sem 프리셋 전환)
import type * as Monaco from 'monaco-editor';
import { convertTheme } from './convert';
import { BUNDLED_THEME_DATA } from './bundled';

const UI_VARS = ['--bg', '--bg-panel', '--bg-hover', '--bg-active', '--border', '--fg', '--fg-dim', '--accent', '--warn'];

async function resolveThemeData(id: string): Promise<unknown | null> {
  if (id.startsWith('user:')) return window.si.themeRead(id).catch(() => null);
  return BUNDLED_THEME_DATA[id] ?? null;
}

export async function applyThemeById(monaco: typeof Monaco, id: string): Promise<void> {
  let converted = convertTheme(await resolveThemeData(id));
  if (!converted) converted = convertTheme(BUNDLED_THEME_DATA['dark-plus'])!; // 폴백 (스펙 §2)
  monaco.editor.defineTheme('si-theme', converted.monacoTheme as Monaco.editor.IStandaloneThemeData);
  monaco.editor.setTheme('si-theme');
  const rootStyle = document.documentElement.style;
  for (const v of UI_VARS) rootStyle.removeProperty(v); // 이전 테마 잔여 제거 → CSS 기본값 복귀
  for (const [k, val] of Object.entries(converted.uiVars)) rootStyle.setProperty(k, val);
  document.documentElement.dataset.themeKind = converted.kind; // sem 프리셋 전환
}
```

- [ ] **Step 3: theme.css — sem 프리셋 2벌**

기존 `.sem-*` 규칙의 고정 색들을 변수 참조로 바꾸고, `:root`에 다크 기본값 + 라이트 오버라이드를 추가한다. 형태:

```css
:root {
  /* (기존 10개 변수 유지) */
  --sem-function: #dcdcaa; --sem-class: #4ec9b0; --sem-variable: #9cdcfe;
  --sem-field: #c8c8c8; --sem-macro: #beb7ff; --sem-enum: #b8d7a3;
}
:root[data-theme-kind='light'] {
  --sem-function: #795e26; --sem-class: #267f99; --sem-variable: #001080;
  --sem-field: #333333; --sem-macro: #811f3f; --sem-enum: #0f7b6c;
}
```

기존 `.monaco-editor .sem-*` 색을 해당 변수로 교체한다 (실제 클래스 이름·개수는 theme.css의 기존 `.sem-*` 블록을 따르며, 위 6종과 이름이 다르면 기존 이름 기준으로 변수를 만들고 다크 기본값은 기존 색 그대로 사용).

- [ ] **Step 4: 시작 적용 + vs-dark 제거**

- App.tsx 최초 마운트 effect: `window.si.getAppearance().then(a => applyThemeById(monaco, a.theme))` (monaco는 `../monaco-setup`에서 import; EditorPane 마운트 전이어도 defineTheme/setTheme는 유효).
- EditorPane.tsx / ContextPanel.tsx의 `theme: 'vs-dark'` 줄 **삭제** (전역 setTheme('si-theme')가 적용됨 — Monaco 테마는 전역이라 옵션 불필요).

- [ ] **Step 5: TextMate/스니펫 훅 (EditorPane)**

- `registerLspFeatures(monaco)` 옆에 `registerSnippetProviders(monaco);`
- 파일 열기(모델 준비) 지점에서 언어 확인 후: `void ensureLanguageRegistered(monaco, model.getLanguageId());` (비동기 — 실패해도 monarch 유지, await 불요)

- [ ] **Step 6: SettingsOverlay 외관 섹션**

기존 AI 설정 섹션 아래에 추가 (같은 `.settings-field` 스타일):
- 테마 `<select>`: `BUNDLED_THEMES` + `themeList()` 결과 합산 옵션. 열릴 때 `getAppearance()`로 현재값 로드.
- "테마 가져오기…" 버튼: `themeImport()` → `{error}`면 오류 표시, 성공 시 목록 갱신 + 해당 테마 선택.
- "스니펫 폴더 열기" 버튼: `snippetsOpenFolder()`.
- 저장 시: `setAppearance({theme})` → `applyThemeById(monaco, theme)` 즉시 적용 → `refreshSnippets()` (스니펫 재로드 규약, 스펙 §4) → 기존 완성 설정 저장 흐름과 함께 닫기.

- [ ] **Step 7: 검증 + 커밋** — `npm run build` 그린, `npm test` 전체 회귀 통과.

```bash
git add src/renderer/src/theming/apply.ts src/renderer/src/theming/bundled.ts src/renderer/src/App.tsx src/renderer/src/components/EditorPane.tsx src/renderer/src/components/ContextPanel.tsx src/renderer/src/components/SettingsOverlay.tsx src/renderer/src/theme.css
git commit -m "렌더러 테마 배선: 시작 적용/즉시 전환/임포트 UI + TextMate·스니펫 훅 + sem 프리셋 2벌

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: E2E — 테마 전환 + 스니펫 삽입

**Files:**
- Create: `tests/e2e/theme-snippet.spec.ts`

- [ ] **Step 1: 스펙 작성** (기존 하니스 관례 — smoke.spec.ts 참조)

```ts
import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

test('테마 전환(Light+) + 스니펫 삽입(log)', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-theme-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'a.ts'), 'const x = 1;\n');

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SI_OPEN_PROJECT: proj, SI_USER_DATA: path.join(work, 'ud') },
  });
  try {
    const page = await app.firstWindow();
    const item = page.locator('.tree-item', { hasText: 'a.ts' });
    await expect(item).toBeVisible({ timeout: 15_000 });
    await item.click();
    await expect(page.locator('.editor-host')).toContainText('const', { timeout: 15_000 });

    // 초기(다크) 배경 기록
    const bgBefore = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    // 설정 → 테마 Light+ → 저장
    await page.keyboard.press('ControlOrMeta+,');
    await page.locator('.settings-box').waitFor({ timeout: 5_000 });
    await page.locator('.settings-box select#theme-select').selectOption('light-plus');
    await page.locator('.settings-box button.primary').click();
    await page.locator('.settings-box').waitFor({ state: 'hidden', timeout: 10_000 });

    // body 배경이 밝게 변경 (CSS 변수 주입) + 에디터 배경 변경
    await expect
      .poll(async () => page.evaluate(() => getComputedStyle(document.body).backgroundColor), { timeout: 10_000 })
      .not.toBe(bgBefore);
    const kind = await page.evaluate(() => document.documentElement.dataset.themeKind);
    expect(kind).toBe('light');

    // 스니펫: 파일 끝에서 'log' 타이핑 → 드롭다운에 Snippet 항목 → 선택 삽입
    await page.locator('.editor-host').click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('log');
    const widget = page.locator('.suggest-widget.visible');
    await expect(widget).toBeVisible({ timeout: 15_000 });
    await expect(widget).toContainText('log', { timeout: 5_000 });
    // 스니펫 항목이 선택되도록 — 첫 항목이 아닐 수 있으므로 라벨 클릭
    await widget.locator('.monaco-list-row', { hasText: 'log' }).first().click();
    await expect(page.locator('.editor-host')).toContainText('console.log', { timeout: 5_000 });
  } finally {
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
```

**주의**: `select#theme-select`는 Task 6에서 테마 select에 `id="theme-select"`를 달아야 매칭된다 (SettingsOverlay의 provider select와 구분) — Task 6 Step 6 구현 시 반영 필수. 셀렉터가 실제 구현과 다르면 구현 쪽 관례에 맞춘다.

- [ ] **Step 2: 실행** — `npm run test:e2e` → 전체 E2E(기존 4 + 신규 1) PASS. LSP 완성/스니펫이 같은 드롭다운에 섞이므로 'log' 항목 매칭이 모호하면 스니펫 라벨(description) 기준으로 좁힌다.

- [ ] **Step 3: 휴지 복원 + 커밋** — `npm run rebuild:node && npm test` 전체 통과 확인.

```bash
git add tests/e2e/theme-snippet.spec.ts
git commit -m "E2E: 테마 전환(Light+, UI 변수/kind 검증) + 스니펫 삽입

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 패키징 검증 — WASM/자산 asar 동작

**Files:**
- Modify: 필요 시 `electron-builder.yml` (검증 결과에 따라)

- [ ] **Step 1: 패키징** — `npm run package` → exit 0.

- [ ] **Step 2: 패키지 앱 TextMate/테마 실증** — Playwright(executablePath)로 패키지 바이너리 구동(Task 9/Plan 6의 `.superpowers/pkg-lsp-verify.mjs` 방식 참조, 임시 스크립트 미커밋):
1. ts fixture 프로젝트 열기 → 파일 열림 확인.
2. `document.documentElement.dataset.themeKind`가 'dark'(기본 테마 적용 증거)인지 확인.
3. TextMate 동작 증거: 렌더러에서 `document.querySelector('.view-line span')`들의 색이 2가지 이상인지 + main 콘솔에 `[textmate]` 오류 로그가 없는지 확인 (오류 로그가 있으면 WASM ipc 경로가 asar에서 실패한 것).
4. 스니펫: 'log' 타이핑 → 드롭다운 항목 확인.

wasm ipc(`require.resolve('vscode-oniguruma')` + fs.readFileSync)는 asar 투명 읽기로 동작해야 한다 — 실패 시 electron-builder.yml asarUnpack에 `node_modules/vscode-oniguruma/**` 추가 후 재패키징으로 해결하고 보고서에 기록.

- [ ] **Step 3: 휴지 복원 + 커밋** — `npm run rebuild:node && npm test` 통과.

```bash
# electron-builder.yml을 수정한 경우에만:
git add electron-builder.yml
git commit -m "패키징: TextMate WASM asar 경로 보정

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
# 수정이 없으면 검증 결과만 보고서에 기록 (커밋 없음)
```

---

## Self-Review (작성 후 점검 결과)

1. **스펙 커버리지**: §1 문법 전체 도입(Task 1·4)·테마 번들/임포트/UI 연동(Task 1·2·5·6)·스니펫(Task 3·5·6) / §2 공개 API·tokenizeLine(Task 4)·sem 프리셋(Task 6)·폴백 전 지점(Task 4 registry/adapter, Task 6 apply, Task 3 파서, Task 5 theme:read) / §4 시작 적용·지연 등록·즉시 전환·스니펫 재로드(Task 6) / §5 단위(Task 2·3·5)·통합/벤치(Task 4)·E2E(Task 7) — 전 항목 매핑. 패키징 검증은 스펙 §5에 없으나 WASM asar 리스크로 추가(Task 8).
2. **Placeholder 스캔**: TBD/TODO 없음. Task 6 theme.css 단계는 기존 파일의 실제 `.sem-*` 클래스명을 따르라는 조건부 지시(구체 규칙 포함)로 완결.
3. **타입 일관성**: `ConvertedTheme`(Task 2 ↔ Task 6 apply), `SnippetDef/parseSnippetFile/mergeSnippets/refreshSnippets`(Task 3 ↔ 6), `ensureLanguageRegistered/tmTokensToMonaco`(Task 4 ↔ 6·테스트), preload 함수명(`onigWasm/snippetsRead/getAppearance/setAppearance/themeList/themeRead/themeImport/snippetsOpenFolder` — Task 3·4·5 ↔ 6) 일치 확인.
