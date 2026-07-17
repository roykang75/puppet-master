// LSP 원시 응답 → 중립 타입 순수 변환 — electron/모나코 임포트 금지
import type { LspCompletionItemN, LspHoverN, LspLocationN, LspDiagnosticN } from '../../shared/protocol';

export const MAX_DIAGNOSTICS = 500;

interface RawItem {
  label?: string; kind?: number; detail?: string; sortText?: string;
  insertText?: string; insertTextFormat?: number;
  textEdit?: { newText?: string };
}

export function toCompletionItems(raw: unknown): LspCompletionItemN[] {
  const items: RawItem[] = Array.isArray(raw)
    ? (raw as RawItem[])
    : Array.isArray((raw as { items?: unknown })?.items)
      ? ((raw as { items: RawItem[] }).items)
      : [];
  return items
    .filter((i) => typeof i.label === 'string')
    .map((i) => ({
      label: i.label as string,
      kind: typeof i.kind === 'number' ? i.kind : 1,
      insertText: i.textEdit?.newText ?? i.insertText ?? (i.label as string),
      isSnippet: i.insertTextFormat === 2,
      detail: i.detail,
      sortText: i.sortText,
    }));
}

type MarkedString = string | { language: string; value: string };

function markedToMd(m: MarkedString): string {
  if (typeof m === 'string') return m;
  return '```' + m.language + '\n' + m.value + '\n```';
}

export function toHover(raw: unknown): LspHoverN | null {
  const contents = (raw as { contents?: unknown })?.contents;
  if (!contents) return null;
  let md: string;
  if (typeof contents === 'string') md = contents;
  else if (Array.isArray(contents)) md = (contents as MarkedString[]).map(markedToMd).join('\n\n');
  else if (typeof (contents as { value?: unknown }).value === 'string') md = (contents as { value: string }).value;
  else return null;
  return md.trim() ? { markdown: md } : null;
}

interface RawRange { start: { line: number; character: number } }
interface RawLoc { uri?: string; range?: RawRange; targetUri?: string; targetRange?: RawRange; targetSelectionRange?: RawRange }

export function toLocations(raw: unknown, uriToRel: (uri: string) => string | null): LspLocationN[] {
  const arr: RawLoc[] = raw == null ? [] : Array.isArray(raw) ? (raw as RawLoc[]) : [raw as RawLoc];
  const out: LspLocationN[] = [];
  for (const l of arr) {
    const uri = l.targetUri ?? l.uri;
    const range = l.targetSelectionRange ?? l.targetRange ?? l.range;
    if (!uri || !range) continue;
    const rel = uriToRel(uri);
    if (rel == null) continue; // 프로젝트 밖 → 제외 (호출측이 폴백)
    out.push({ path: rel, line: range.start.line, col: range.start.character });
  }
  return out;
}

interface RawDiag {
  message?: string; severity?: number;
  range?: { start: { line: number; character: number }; end: { line: number; character: number } };
}

export function toDiagnostics(raw: unknown[]): LspDiagnosticN[] {
  return (raw as RawDiag[])
    .filter((d) => d?.range && typeof d.message === 'string')
    .slice(0, MAX_DIAGNOSTICS)
    .map((d) => ({
      message: d.message as string,
      severity: (d.severity === 1 || d.severity === 2 || d.severity === 3 || d.severity === 4 ? d.severity : 1) as 1 | 2 | 3 | 4,
      startLine: d.range!.start.line,
      startCol: d.range!.start.character,
      endLine: d.range!.end.line,
      endCol: d.range!.end.character,
    }));
}
