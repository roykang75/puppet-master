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
