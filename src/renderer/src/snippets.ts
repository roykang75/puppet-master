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
