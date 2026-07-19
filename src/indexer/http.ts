// HTTP 경계 추출 (v3 스펙 §A) — 프론트 호출부(fetch/axios)와 백엔드 라우트(FastAPI/Flask/Spring/Next)를
// 기존 파스 트리에서 걷어(descendantsOfType) 추출한다. 기존 tree-sitter 쿼리는 무변경 — 회귀 격리.
// 매칭의 핵심은 경로 정규화: 파라미터 세그먼트({x}/[x]/:x/${...})를 전부 '{}'로 통일한다.
import type { SyntaxNode } from 'tree-sitter';
import { SymbolRow, findEnclosingIndex } from './extractor';

export interface EndpointRow {
  method: string; // GET/POST/… 또는 '*'(불명)
  path: string; // 정규화 경로 — 매칭 키
  rawPath: string; // 원문 (표시용)
  line: number;
  symbolIndex: number | null; // 핸들러 심볼 (symbols 배열 인덱스)
}

export interface HttpCallRow {
  method: string;
  path: string; // 정규화 경로 — ''이면 unresolved(동적 URL, 매칭 불가·정직 표시용)
  rawPath: string;
  line: number;
  col: number;
  enclosingIndex: number | null;
}

export interface HttpExtract {
  endpoints: EndpointRow[];
  httpCalls: HttpCallRow[];
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);
const AXIOS_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);
const PY_ROUTE_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);
const SPRING_MAPPINGS: Record<string, string> = {
  GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT',
  DeleteMapping: 'DELETE', PatchMapping: 'PATCH', RequestMapping: '*',
};

/** 경로 정규화 — 스킴+호스트/쿼리 제거, 파라미터 세그먼트({x}/[x]/:x/${} 흔적) → '{}'. 빈 입력은 ''. */
export function normalizeHttpPath(raw: string): string {
  let p = raw.trim();
  if (!p) return '';
  p = p.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*/, ''); // http://host 제거 → 경로만
  p = p.split(/[?#]/)[0];
  if (!p) return '';
  const segs = p.split('/').filter((s) => s !== '');
  if (segs.length === 0) return '/';
  const norm = segs.map((s) => (/^:|[{}[\]$]/.test(s) ? '{}' : s));
  return '/' + norm.join('/');
}

/** a + b 경로 결합 (Spring 클래스 prefix용) — 슬래시 중복/누락 정리. */
export function joinHttpPaths(a: string, b: string): string {
  const l = a.replace(/\/+$/, '');
  const r = b.replace(/^\/+/, '');
  if (!l) return r ? '/' + r : '';
  if (!r) return l;
  return `${l}/${r}`;
}

// ── 문자열 리터럴 추출 유틸 ──

/** TS string/template_string → 원문 경로 (substitution은 '{}'). 리터럴 아님 → null. */
function tsStringValue(n: SyntaxNode | null): string | null {
  if (!n) return null;
  if (n.type === 'string') return n.text.slice(1, -1);
  if (n.type === 'template_string') {
    let out = '';
    for (const c of n.children) {
      if (c.type === 'string_fragment') out += c.text;
      else if (c.type === 'template_substitution') out += '{}';
    }
    return out;
  }
  return null;
}

/** Python string → 따옴표/프리픽스(f,r,b) 제거. */
function pyStringValue(n: SyntaxNode | null): string | null {
  if (!n || n.type !== 'string') return null;
  return n.text.replace(/^[a-zA-Z]*("""|'''|"|')/, '').replace(/("""|'''|"|')$/, '');
}

function javaStringValue(n: SyntaxNode | null): string | null {
  if (!n || n.type !== 'string_literal') return null;
  return n.text.replace(/^"/, '').replace(/"$/, '');
}

/** 호출부 raw 경로 → 정규화. 선행 '{}'(=`${API_BASE}` 류 베이스 URL 치환)는 벗겨낸다. */
function normalizeCallPath(raw: string): string {
  let r = raw;
  while (r.startsWith('{}')) r = r.replace(/^\{\}\/?/, ''); // `${BASE}/users` → 'users'
  if (!r) return ''; // 전부 동적 → unresolved
  return normalizeHttpPath(r);
}

// ── TS/TSX: fetch/axios 호출부 ──

function extractTsCalls(root: SyntaxNode, symbols: SymbolRow[]): HttpCallRow[] {
  const out: HttpCallRow[] = [];
  const push = (raw: string | null, method: string, node: SyntaxNode) => {
    const rawPath = raw ?? node.text.slice(0, 120);
    out.push({
      method,
      path: raw == null ? '' : normalizeCallPath(raw),
      rawPath,
      line: node.startPosition.row,
      col: node.startPosition.column,
      enclosingIndex: findEnclosingIndex(symbols, node.startPosition.row, node.startPosition.column),
    });
  };
  for (const call of root.descendantsOfType('call_expression')) {
    const fn = call.childForFieldName('function');
    const args = call.childForFieldName('arguments')?.namedChildren ?? [];
    if (!fn) continue;
    if (fn.type === 'identifier' && fn.text === 'fetch') {
      push(tsStringValue(args[0] ?? null), fetchMethod(args[1] ?? null), call);
    } else if (fn.type === 'member_expression') {
      const obj = fn.childForFieldName('object');
      const prop = fn.childForFieldName('property');
      if (obj?.type === 'identifier' && obj.text === 'axios' && prop && AXIOS_METHODS.has(prop.text)) {
        push(tsStringValue(args[0] ?? null), prop.text.toUpperCase(), call);
      }
    } else if (fn.type === 'identifier' && fn.text === 'axios' && args[0]) {
      if (args[0].type === 'object') {
        let url: string | null = null;
        let method = 'GET';
        for (const pair of args[0].namedChildren) {
          if (pair.type !== 'pair') continue;
          const key = pair.childForFieldName('key')?.text.replace(/['"]/g, '');
          const value = pair.childForFieldName('value');
          if (key === 'url') url = tsStringValue(value);
          if (key === 'method' && value?.type === 'string') method = value.text.slice(1, -1).toUpperCase();
        }
        if (url !== null) push(url, method, call);
      } else {
        push(tsStringValue(args[0]), 'GET', call);
      }
    }
  }
  return out;
}

/** fetch 2번째 인자 객체에서 method 리터럴 추출 — 없으면 GET, 비리터럴이면 '*'. */
function fetchMethod(init: SyntaxNode | null): string {
  if (!init || init.type !== 'object') return 'GET';
  for (const pair of init.namedChildren) {
    if (pair.type !== 'pair') continue;
    const key = pair.childForFieldName('key')?.text.replace(/['"]/g, '');
    if (key !== 'method') continue;
    const value = pair.childForFieldName('value');
    if (value?.type === 'string') return value.text.slice(1, -1).toUpperCase();
    return '*';
  }
  return 'GET';
}

// ── TS/TSX: Next.js 파일 기반 라우트 (트리 불필요 — relPath + symbols) ──

function extractNextRoutes(relPath: string, symbols: SymbolRow[]): EndpointRow[] {
  const out: EndpointRow[] = [];
  const appMatch = /(?:^|\/)app\/(.*?)\/?route\.(?:ts|js|tsx|jsx)$/.exec(relPath);
  if (appMatch) {
    const segs = appMatch[1]
      .split('/')
      .filter((s) => s !== '' && !/^\(.*\)$/.test(s)) // (group) 세그먼트 제외
      .map((s) => (/^\[.*\]$/.test(s) ? '{}' : s));
    const p = '/' + segs.join('/');
    symbols.forEach((s, i) => {
      if (HTTP_METHODS.has(s.name) && (s.kind === 'function' || s.kind === 'variable')) {
        out.push({ method: s.name, path: p === '/' ? '/' : p, rawPath: '/' + appMatch[1], line: s.nameLine, symbolIndex: i });
      }
    });
    return out;
  }
  const pagesMatch = /(?:^|\/)pages\/(api\/.*?)\.(?:ts|js|tsx|jsx)$/.exec(relPath);
  if (pagesMatch) {
    const rel = pagesMatch[1].replace(/\/index$/, '');
    const segs = rel.split('/').map((s) => (/^\[.*\]$/.test(s) ? '{}' : s));
    const handlerIdx = symbols.findIndex((s) => s.kind === 'function');
    out.push({
      method: '*',
      path: '/' + segs.join('/'),
      rawPath: '/' + pagesMatch[1],
      line: handlerIdx >= 0 ? symbols[handlerIdx].nameLine : 0,
      symbolIndex: handlerIdx >= 0 ? handlerIdx : null,
    });
  }
  return out;
}

// ── Python: FastAPI/Flask 데코레이터 ──

function extractPyEndpoints(root: SyntaxNode, symbols: SymbolRow[]): EndpointRow[] {
  const out: EndpointRow[] = [];
  for (const deco of root.descendantsOfType('decorated_definition')) {
    const def = deco.childForFieldName('definition');
    const symbolIndex =
      def == null
        ? null
        : symbols.findIndex(
            (s) => s.startLine === def.startPosition.row && s.startCol === def.startPosition.column,
          );
    for (const d of deco.children) {
      if (d.type !== 'decorator') continue;
      const call = d.namedChildren[0];
      if (!call || call.type !== 'call') continue;
      const fn = call.childForFieldName('function');
      if (!fn || fn.type !== 'attribute') continue;
      const attr = fn.childForFieldName('attribute')?.text ?? '';
      const args = call.childForFieldName('arguments')?.namedChildren ?? [];
      const raw = pyStringValue(args[0] ?? null);
      if (raw == null) continue;
      if (PY_ROUTE_METHODS.has(attr)) {
        // FastAPI 스타일: @app.get("/p") / @router.post(...)
        out.push({
          method: attr.toUpperCase(),
          path: normalizeHttpPath(raw),
          rawPath: raw,
          line: d.startPosition.row,
          symbolIndex: symbolIndex === -1 ? null : symbolIndex,
        });
      } else if (attr === 'route') {
        // Flask 스타일: @app.route("/p", methods=["POST"]) — methods 없으면 '*'
        const methods: string[] = [];
        for (const a of args) {
          if (a.type === 'keyword_argument' && a.childForFieldName('name')?.text === 'methods') {
            for (const v of a.childForFieldName('value')?.namedChildren ?? []) {
              const m = pyStringValue(v);
              if (m) methods.push(m.toUpperCase());
            }
          }
        }
        for (const m of methods.length ? methods : ['*']) {
          out.push({
            method: m,
            path: normalizeHttpPath(raw),
            rawPath: raw,
            line: d.startPosition.row,
            symbolIndex: symbolIndex === -1 ? null : symbolIndex,
          });
        }
      }
    }
  }
  return out;
}

// ── Java: Spring 어노테이션 (클래스 @RequestMapping prefix 결합) ──

function javaAnnotationPathAndMethod(ann: SyntaxNode): { path: string; method: string | null } {
  let path = '';
  let method: string | null = null;
  const args = ann.childForFieldName('arguments');
  for (const a of args?.namedChildren ?? []) {
    if (a.type === 'string_literal') {
      path = javaStringValue(a) ?? '';
    } else if (a.type === 'element_value_pair') {
      const key = a.childForFieldName('key')?.text;
      const value = a.childForFieldName('value');
      if ((key === 'value' || key === 'path') && value) {
        if (value.type === 'string_literal') path = javaStringValue(value) ?? '';
        else if (value.type === 'element_value_array_initializer') {
          const first = value.namedChildren.find((c) => c.type === 'string_literal');
          if (first) path = javaStringValue(first) ?? '';
        }
      } else if (key === 'method' && value) {
        const m = /RequestMethod\.(\w+)/.exec(value.text);
        if (m) method = m[1].toUpperCase();
      }
    }
  }
  return { path, method };
}

function extractJavaEndpoints(root: SyntaxNode, symbols: SymbolRow[]): EndpointRow[] {
  const out: EndpointRow[] = [];
  const classPrefix = new Map<number, string>(); // class_declaration.startIndex → prefix
  const methodAnns: { owner: SyntaxNode; method: string; path: string; line: number }[] = [];

  for (const ann of root.descendantsOfType(['annotation', 'marker_annotation'])) {
    const nameNode = ann.childForFieldName('name');
    if (!nameNode) continue;
    const name = nameNode.text.split('.').pop() ?? '';
    const mapped = SPRING_MAPPINGS[name];
    if (mapped === undefined) continue;
    const owner = ann.parent?.type === 'modifiers' ? ann.parent.parent : null;
    if (!owner) continue;
    const { path, method } = ann.type === 'annotation' ? javaAnnotationPathAndMethod(ann) : { path: '', method: null };
    if (owner.type === 'class_declaration') {
      classPrefix.set(owner.startIndex, path);
    } else if (owner.type === 'method_declaration') {
      methodAnns.push({ owner, method: method ?? (mapped === '*' ? '*' : mapped), path, line: ann.startPosition.row });
    }
  }

  for (const a of methodAnns) {
    // 조상 class_declaration의 prefix 결합
    let prefix = '';
    for (let n: SyntaxNode | null = a.owner.parent; n; n = n.parent) {
      if (n.type === 'class_declaration') {
        prefix = classPrefix.get(n.startIndex) ?? '';
        break;
      }
    }
    const raw = joinHttpPaths(prefix, a.path) || '/';
    const symbolIndex = symbols.findIndex(
      (s) => s.kind === 'method' && s.startLine === a.owner.startPosition.row && s.startCol === a.owner.startPosition.column,
    );
    out.push({
      method: a.method,
      path: normalizeHttpPath(raw),
      rawPath: raw,
      line: a.line,
      symbolIndex: symbolIndex === -1 ? null : symbolIndex,
    });
  }
  return out;
}

/** 언어별 HTTP 경계 추출 진입점 — 지원 외 언어는 빈 결과. */
export function extractHttp(root: SyntaxNode, langId: string, symbols: SymbolRow[], relPath: string): HttpExtract {
  if (langId === 'typescript' || langId === 'tsx') {
    return { endpoints: extractNextRoutes(relPath, symbols), httpCalls: extractTsCalls(root, symbols) };
  }
  if (langId === 'python') return { endpoints: extractPyEndpoints(root, symbols), httpCalls: [] };
  if (langId === 'java') return { endpoints: extractJavaEndpoints(root, symbols), httpCalls: [] };
  return { endpoints: [], httpCalls: [] };
}
