// Monaco provider 배선 + 진단 마커 + 상태 이벤트 — 앱 수명 1회 등록
import type * as Monaco from 'monaco-editor';
import { lspSync, isLspPath } from './lsp-sync';
import { useAppStore } from './store';
import { jumpTo } from './navigation';
import type { LspCompletionItemN, LspDiagnosticN, LspHoverN, LspLocationN, LspSignatureHelpN } from '../../shared/protocol';

let registered = false;
let monacoRef: typeof Monaco | null = null;

// LSP 언어 대상 Monaco languageId — provider 등록 셀렉터
export const LSP_MONACO_LANGS = ['typescript', 'javascript', 'python'];

// LSP CompletionItemKind(1~25) → Monaco CompletionItemKind
function toMonacoKind(monaco: typeof Monaco, k: number): Monaco.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  const map: Record<number, Monaco.languages.CompletionItemKind> = {
    1: K.Text, 2: K.Method, 3: K.Function, 4: K.Constructor, 5: K.Field, 6: K.Variable,
    7: K.Class, 8: K.Interface, 9: K.Module, 10: K.Property, 11: K.Unit, 12: K.Value,
    13: K.Enum, 14: K.Keyword, 15: K.Snippet, 16: K.Color, 17: K.File, 18: K.Reference,
    19: K.Folder, 20: K.EnumMember, 21: K.Constant, 22: K.Struct, 23: K.Event,
    24: K.Operator, 25: K.TypeParameter,
  };
  return map[k] ?? K.Text;
}

function pathOf(model: Monaco.editor.ITextModel): string | null {
  if (model.uri.scheme !== 'file') return null;
  return model.uri.path.replace(/^\//, '');
}

export function registerLspFeatures(monaco: typeof Monaco): void {
  if (registered) return;
  registered = true;
  monacoRef = monaco;

  monaco.languages.registerCompletionItemProvider(LSP_MONACO_LANGS, {
    triggerCharacters: ['.'],
    async provideCompletionItems(model, position) {
      const path = pathOf(model);
      if (!path || !isLspPath(path)) return { suggestions: [] };
      await lspSync.lspFlush();
      const items = (await window.si
        .lspCall('completion', { path, line: position.lineNumber - 1, col: position.column - 1 })
        .catch(() => null)) as LspCompletionItemN[] | null;
      if (!items) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, position.column);
      return {
        suggestions: items.map((i) => ({
          label: i.label,
          kind: toMonacoKind(monaco, i.kind),
          insertText: i.insertText,
          insertTextRules: i.isSnippet
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          detail: i.detail,
          sortText: i.sortText,
          range,
        })),
      };
    },
  });

  monaco.languages.registerHoverProvider(LSP_MONACO_LANGS, {
    async provideHover(model, position) {
      const path = pathOf(model);
      if (!path || !isLspPath(path)) return null;
      await lspSync.lspFlush();
      const hover = (await window.si
        .lspCall('hover', { path, line: position.lineNumber - 1, col: position.column - 1 })
        .catch(() => null)) as LspHoverN | null;
      if (!hover) return null;
      return { contents: [{ value: hover.markdown }] };
    },
  });

  // 참조 찾기 — Shift+F12 네이티브 피크. 열린 파일/동일 파일은 본문 미리보기, 그 외는 위치·이동만.
  monaco.languages.registerReferenceProvider(LSP_MONACO_LANGS, {
    async provideReferences(model, position) {
      const path = pathOf(model);
      if (!path || !isLspPath(path)) return [];
      await lspSync.lspFlush();
      const locs = (await window.si
        .lspCall('references', { path, line: position.lineNumber - 1, col: position.column - 1 })
        .catch(() => null)) as LspLocationN[] | null;
      if (!locs) return [];
      return locs.map((l) => ({
        uri: monaco.Uri.file('/' + l.path),
        range: new monaco.Range(l.line + 1, l.col + 1, l.line + 1, l.col + 1),
      }));
    },
  });

  // 시그니처 도움말 — '(' ',' 트리거 팝업
  monaco.languages.registerSignatureHelpProvider(LSP_MONACO_LANGS, {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    async provideSignatureHelp(model, position) {
      const path = pathOf(model);
      if (!path || !isLspPath(path)) return null;
      await lspSync.lspFlush();
      const sh = (await window.si
        .lspCall('signatureHelp', { path, line: position.lineNumber - 1, col: position.column - 1 })
        .catch(() => null)) as LspSignatureHelpN | null;
      if (!sh || sh.signatures.length === 0) return null;
      return {
        value: {
          signatures: sh.signatures.map((s) => ({
            label: s.label,
            documentation: s.documentation,
            parameters: s.parameters.map((p) => ({ label: p.label, documentation: p.documentation })),
          })),
          activeSignature: sh.activeSignature,
          activeParameter: sh.activeParameter,
        },
        dispose() {},
      };
    },
  });

  // 진단 마커 + 상태 이벤트
  window.si.onLspEvent((e) => {
    if (e.event === 'status') {
      useAppStore.getState().setLspStopped(e.payload.lang, e.payload.state === 'stopped');
      return;
    }
    const monacoNS = monacoRef;
    if (!monacoNS) return;
    const { path, diagnostics } = e.payload;
    const model = monacoNS.editor.getModel(monacoNS.Uri.file('/' + path));
    if (!model) return;
    monacoNS.editor.setModelMarkers(model, 'lsp', diagnostics.map((d: LspDiagnosticN) => ({
      message: d.message,
      severity: ({ 1: 8, 2: 4, 3: 2, 4: 1 } as const)[d.severity], // LSP → MarkerSeverity
      startLineNumber: d.startLine + 1,
      startColumn: d.startCol + 1,
      endLineNumber: d.endLine + 1,
      endColumn: d.endCol + 1,
    })));
  });
}

// F12/Ctrl+클릭 — LSP 우선(내부 1.5초 타임아웃은 main), 성공 시 jumpTo 후 true
export async function tryLspDefinition(path: string, line1: number, col1: number): Promise<boolean> {
  if (!isLspPath(path)) return false;
  await lspSync.lspFlush();
  const locs = (await window.si
    .lspCall('definition', { path, line: line1 - 1, col: col1 - 1 })
    .catch(() => null)) as LspLocationN[] | null;
  if (!locs || locs.length === 0) return false;
  jumpTo(locs[0].path, locs[0].line + 1, locs[0].col + 1);
  return true;
}
