// 비-AI 심볼 자동완성 — LSP가 없는 인덱싱 언어(c/cpp/java)에 인덱서 심볼 DB 기반 완성 제공.
// LSP 언어(ts/js/py)는 lsp-features의 LSP 완성이 담당하므로 여기서 제외.
import type * as Monaco from 'monaco-editor';
import type { SymbolHit } from '../../indexer/api';

// LSP 미지원 · 인덱서가 심볼을 추출하는 언어들 (Monaco languageId 기준)
export const NON_LSP_COMPLETION_LANGS = ['c', 'cpp', 'java'];

// 인덱서 kind 문자열(def.<kind>) → Monaco CompletionItemKind
export function symbolKindToMonaco(monaco: typeof Monaco, kind: string): Monaco.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  switch (kind) {
    case 'function': return K.Function;
    case 'method': return K.Method;
    case 'class': return K.Class;
    case 'struct': return K.Struct;
    case 'enum': return K.Enum;
    case 'interface': return K.Interface;
    case 'field': return K.Field;
    case 'namespace': return K.Module;
    case 'macro': return K.Constant;
    case 'type': return K.TypeParameter;
    default: return K.Variable;
  }
}

/** 이름 기준 중복 제거 — 여러 파일의 동명 심볼을 완성 목록엔 1개로. 입력 순서(관련도순) 유지. */
export function dedupeByName(hits: SymbolHit[]): SymbolHit[] {
  const seen = new Set<string>();
  const out: SymbolHit[] = [];
  for (const h of hits) {
    if (seen.has(h.name)) continue;
    seen.add(h.name);
    out.push(h);
  }
  return out;
}

let registered = false;

export function registerSymbolCompletion(monaco: typeof Monaco): void {
  if (registered) return;
  registered = true;
  monaco.languages.registerCompletionItemProvider(NON_LSP_COMPLETION_LANGS, {
    async provideCompletionItems(model, position) {
      if (model.uri.scheme !== 'file') return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const prefix = word.word;
      if (prefix.length < 1) return { suggestions: [] };
      const hits = (await window.si.searchSymbols(prefix).catch(() => [])) as SymbolHit[];
      if (hits.length === 0) return { suggestions: [] };
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, position.column);
      return {
        suggestions: dedupeByName(hits).map((h) => ({
          label: h.name,
          kind: symbolKindToMonaco(monaco, h.kind),
          insertText: h.name,
          detail: h.signature || `${h.kind} · ${h.path}`,
          range,
        })),
      };
    },
  });
}
