import { LanguageSpec, getParser, getQuery } from './languages';

export interface SymbolRow {
  name: string;
  kind: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  scope: string;
  signature: string;
}

export interface RefRow {
  name: string;
  kind: 'call';
  line: number;
  col: number;
  enclosingIndex: number | null;
}

export interface ExtractResult {
  symbols: SymbolRow[];
  refs: RefRow[];
}

const SCOPE_KINDS = new Set(['function', 'method', 'class', 'struct', 'interface', 'namespace']);
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB 초과 파일은 스킵 (생성 코드 방어)

function firstLine(text: string): string {
  const nl = text.indexOf('\n');
  return (nl === -1 ? text : text.slice(0, nl)).slice(0, 200).trim();
}

function posLE(aL: number, aC: number, bL: number, bC: number): boolean {
  return aL < bL || (aL === bL && aC <= bC);
}

function containsPoint(s: SymbolRow, line: number, col: number): boolean {
  return posLE(s.startLine, s.startCol, line, col) && posLE(line, col, s.endLine, s.endCol);
}

function containsRange(outer: SymbolRow, inner: SymbolRow): boolean {
  return (
    (outer.startLine !== inner.startLine || outer.startCol !== inner.startCol || outer.endLine !== inner.endLine) &&
    posLE(outer.startLine, outer.startCol, inner.startLine, inner.startCol) &&
    posLE(inner.endLine, inner.endCol, outer.endLine, outer.endCol)
  );
}

function rangeSize(s: SymbolRow): number {
  return (s.endLine - s.startLine) * 100000 + (s.endCol - s.startCol);
}

export function extractFile(source: string, spec: LanguageSpec): ExtractResult {
  if (Buffer.byteLength(source) > MAX_FILE_BYTES) return { symbols: [], refs: [] };
  const tree = getParser(spec).parse(source);
  const query = getQuery(spec);
  const symbols: SymbolRow[] = [];
  const rawRefs: { name: string; line: number; col: number }[] = [];
  const seen = new Set<string>();

  for (const match of query.matches(tree.rootNode)) {
    const defCap = match.captures.find((c) => c.name.startsWith('def.'));
    const nameCap = match.captures.find((c) => c.name === 'name');
    const refCap = match.captures.find((c) => c.name === 'ref.call');
    if (defCap && nameCap) {
      const d = defCap.node;
      const key = `${nameCap.node.text}:${d.startIndex}:${defCap.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      symbols.push({
        name: nameCap.node.text,
        kind: defCap.name.slice(4),
        startLine: d.startPosition.row,
        startCol: d.startPosition.column,
        endLine: d.endPosition.row,
        endCol: d.endPosition.column,
        scope: '',
        signature: firstLine(d.text),
      });
    } else if (refCap) {
      rawRefs.push({
        name: refCap.node.text,
        line: refCap.node.startPosition.row,
        col: refCap.node.startPosition.column,
      });
    }
  }

  // 스코프: 자신을 포함하는 SCOPE_KINDS 정의들의 이름을 바깥→안 순서로 연결
  for (const s of symbols) {
    const containers = symbols
      .filter((o) => SCOPE_KINDS.has(o.kind) && containsRange(o, s))
      .sort((a, b) => rangeSize(b) - rangeSize(a));
    s.scope = containers.map((c) => c.name).join('::');
  }

  const refs: RefRow[] = rawRefs.map((r) => {
    const enclosing = symbols
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => SCOPE_KINDS.has(s.kind) && containsPoint(s, r.line, r.col))
      .sort((a, b) => rangeSize(a.s) - rangeSize(b.s))[0];
    return { name: r.name, kind: 'call', line: r.line, col: r.col, enclosingIndex: enclosing ? enclosing.i : null };
  });

  return { symbols, refs };
}
