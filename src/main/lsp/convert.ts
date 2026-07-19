// LSP 원시 응답 → 중립 타입 순수 변환 — electron/모나코 임포트 금지
import type { LspCompletionItemN, LspHoverN, LspLocationN, LspDiagnosticN, LspSignatureHelpN, LspTextEditN } from '../../shared/protocol';

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

interface RawEdit {
  range?: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText?: string;
}

export function toTextEdits(raw: unknown): LspTextEditN[] {
  const arr = Array.isArray(raw) ? (raw as RawEdit[]) : [];
  return arr
    .filter((e) => e?.range && typeof e.newText === 'string')
    .map((e) => ({
      startLine: e.range!.start.line,
      startCol: e.range!.start.character,
      endLine: e.range!.end.line,
      endCol: e.range!.end.character,
      newText: e.newText as string,
    }));
}

interface RawSigLabel { label?: string | [number, number]; documentation?: unknown }
interface RawSignature { label?: string; documentation?: unknown; parameters?: RawSigLabel[] }
interface RawSigHelp { signatures?: RawSignature[]; activeSignature?: number; activeParameter?: number }

function docToString(d: unknown): string | undefined {
  if (typeof d === 'string') return d || undefined;
  if (d && typeof (d as { value?: unknown }).value === 'string') return (d as { value: string }).value || undefined;
  return undefined;
}

export function toSignatureHelp(raw: unknown): LspSignatureHelpN | null {
  const sh = raw as RawSigHelp | null;
  const sigs = Array.isArray(sh?.signatures) ? sh!.signatures : [];
  if (sigs.length === 0) return null;
  return {
    activeSignature: typeof sh?.activeSignature === 'number' ? sh.activeSignature : 0,
    activeParameter: typeof sh?.activeParameter === 'number' ? sh.activeParameter : 0,
    signatures: sigs
      .filter((s) => typeof s.label === 'string')
      .map((s) => ({
        label: s.label as string,
        documentation: docToString(s.documentation),
        parameters: (Array.isArray(s.parameters) ? s.parameters : []).map((p) => ({
          // label은 문자열이거나 시그니처 문자열 내 [start,end] 오프셋 — Monaco는 둘 다 허용
          label: p.label ?? '',
          documentation: docToString(p.documentation),
        })),
      })),
  };
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
