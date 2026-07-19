import { LanguageSpec, getParser, getQuery } from './languages';
import { extractHttp, EndpointRow, HttpCallRow } from './http';

export interface SymbolRow {
  name: string;
  kind: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  nameLine: number;
  nameCol: number;
  scope: string;
  signature: string;
}

export type RefKind = 'call' | 'import' | 'extends';

export interface RefRow {
  name: string;
  kind: RefKind;
  line: number;
  col: number;
  enclosingIndex: number | null;
}

export interface ExtractResult {
  symbols: SymbolRow[];
  refs: RefRow[];
  endpoints: EndpointRow[];
  httpCalls: HttpCallRow[];
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

/** 좌표를 포함하는 가장 안쪽 SCOPE_KINDS 심볼의 인덱스 — refs·http_calls 공용. */
export function findEnclosingIndex(symbols: SymbolRow[], line: number, col: number): number | null {
  const enclosing = symbols
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => SCOPE_KINDS.has(s.kind) && containsPoint(s, line, col))
    .sort((a, b) => rangeSize(a.s) - rangeSize(b.s))[0];
  return enclosing ? enclosing.i : null;
}

export function extractFile(source: string, spec: LanguageSpec, relPath = ''): ExtractResult {
  if (Buffer.byteLength(source) > MAX_FILE_BYTES) return { symbols: [], refs: [], endpoints: [], httpCalls: [] };
  const tree = getParser(spec).parse(source);
  const query = getQuery(spec);
  const symbols: SymbolRow[] = [];
  const rawRefs: { name: string; kind: RefKind; line: number; col: number }[] = [];
  const seen = new Set<string>();

  for (const match of query.matches(tree.rootNode)) {
    const defCap = match.captures.find((c) => c.name.startsWith('def.'));
    const nameCap = match.captures.find((c) => c.name === 'name');
    const refCap = match.captures.find((c) => c.name.startsWith('ref.'));
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
        nameLine: nameCap.node.startPosition.row,
        nameCol: nameCap.node.startPosition.column,
        scope: '',
        signature: firstLine(d.text),
      });
    } else if (refCap) {
      const kind = refCap.name.slice(4) as RefKind;
      // import 대상은 따옴표/꺾쇠를 제거해 순수 경로/모듈 문자열로 정규화
      const text = kind === 'import' ? refCap.node.text.replace(/^["'<]+|[">']+$/g, '') : refCap.node.text;
      rawRefs.push({
        name: text,
        kind,
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

  const refs: RefRow[] = rawRefs.map((r) => ({
    name: r.name,
    kind: r.kind,
    line: r.line,
    col: r.col,
    enclosingIndex: findEnclosingIndex(symbols, r.line, r.col),
  }));

  // HTTP 경계 추출 (v3) — 기존 쿼리와 분리된 트리 워크. 지원 외 언어는 빈 결과.
  const { endpoints, httpCalls } = extractHttp(tree.rootNode, spec.id, symbols, relPath);

  return { symbols, refs, endpoints, httpCalls };
}
