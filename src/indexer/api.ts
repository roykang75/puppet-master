import type { Database } from 'better-sqlite3';
import { splitName } from './fragments';
import type { RenameOccurrence, RenameFileGroup, RenameTargets, FileRefRow } from '../shared/protocol';

export interface SymbolHit {
  id: number;
  name: string;
  kind: string;
  scope: string;
  signature: string;
  path: string;
  line: number;
  nameLine: number;
  nameCol: number;
}

export interface TextHit {
  path: string;
  snippet: string;
}

export interface CallerHit {
  callerId: number | null;
  callerName: string | null;
  callerKind: string | null;
  path: string;
  line: number;
}

export interface RefHit {
  name: string;
  kind: string;
  path: string;
  line: number;
  col: number;
  enclosingName: string | null;
}

const HIT_SELECT = `SELECT s.id, s.name, s.kind, s.scope, s.signature, s.start_line AS line, s.name_line AS nameLine, s.name_col AS nameCol, f.path
FROM symbols s JOIN files f ON f.id = s.file_id`;

export function searchSymbols(db: Database, query: string, limit = 50): SymbolHit[] {
  const frags = splitName(query);
  if (frags.length === 0) return [];
  const conds = frags
    .map(() => `EXISTS (SELECT 1 FROM name_fragments nf WHERE nf.symbol_id = s.id AND nf.fragment LIKE ?)`)
    .join(' AND ');
  return db
    .prepare(`${HIT_SELECT} WHERE ${conds} ORDER BY length(s.name), s.name LIMIT ?`)
    .all(...frags.map((f) => f + '%'), limit) as SymbolHit[];
}

export function searchText(db: Database, query: string, limit = 50): TextHit[] {
  const escaped = `"${query.replace(/"/g, '""')}"`;
  return db
    .prepare(`SELECT path, snippet(file_text, 1, '', '', '…', 12) AS snippet FROM file_text WHERE file_text MATCH ? LIMIT ?`)
    .all(escaped, limit) as TextHit[];
}

export function getDefinitions(db: Database, name: string): SymbolHit[] {
  return db.prepare(`${HIT_SELECT} WHERE s.name = ? ORDER BY f.path, line`).all(name) as SymbolHit[];
}

export function getSymbolsForFile(db: Database, relPath: string): SymbolHit[] {
  return db.prepare(`${HIT_SELECT} WHERE f.path = ? ORDER BY line`).all(relPath) as SymbolHit[];
}

/** 파일 내 참조(call/extends) — 시맨틱 토큰 색칠용. 0-기반 좌표. */
export function getRefsForFile(db: Database, relPath: string): FileRefRow[] {
  return db
    .prepare(
      `SELECT r.name, r.kind, r.line, r.col
       FROM refs r JOIN files f ON f.id = r.file_id
       WHERE f.path = ? AND r.kind IN ('call','extends')
       ORDER BY r.line, r.col`,
    )
    .all(relPath) as FileRefRow[];
}

export function getCallers(db: Database, name: string): CallerHit[] {
  return db
    .prepare(
      `SELECT cs.id AS callerId, cs.name AS callerName, cs.kind AS callerKind, f.path, r.line
       FROM refs r
       JOIN files f ON f.id = r.file_id
       LEFT JOIN symbols cs ON cs.id = r.enclosing_symbol_id
       WHERE r.name = ? AND r.kind = 'call'
       ORDER BY f.path, r.line`,
    )
    .all(name) as CallerHit[];
}

export function getCallees(db: Database, symbolId: number): SymbolHit[] {
  return db
    .prepare(
      `${HIT_SELECT} WHERE s.name IN (
         SELECT DISTINCT r.name FROM refs r WHERE r.enclosing_symbol_id = ? AND r.kind = 'call'
       ) AND s.kind IN ('function','method') ORDER BY s.name`,
    )
    .all(symbolId) as SymbolHit[];
}

const CLASS_KINDS = `('class','struct','interface')`;

export function getReferences(db: Database, name: string, limit = 200): RefHit[] {
  return db
    .prepare(
      `SELECT r.name, r.kind, f.path, r.line, r.col, es.name AS enclosingName
       FROM refs r
       JOIN files f ON f.id = r.file_id
       LEFT JOIN symbols es ON es.id = r.enclosing_symbol_id
       WHERE r.name = ? AND r.kind IN ('call','extends')
       ORDER BY f.path, r.line LIMIT ?`,
    )
    .all(name, limit) as RefHit[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Smart Rename 대상 수집 (0-기반):
 *  - groups: 정의(name_line/name_col, isDefinition:true) + 참조(kind call/extends, isDefinition:false).
 *    path별로 묶고, (line,col) 정렬·중복 제거(같은 위치가 정의이자 참조면 정의 우선).
 *  - unconfirmed: FTS(file_text MATCH)로 name을 포함한 파일 content를 줄 단위로 스캔,
 *    단어 경계(`(?<![A-Za-z0-9_$])name(?![A-Za-z0-9_$])`) 발생 중 groups에 없는 위치.
 */
export function getRenameTargets(db: Database, name: string): RenameTargets {
  const defs = db
    .prepare(
      `SELECT f.path AS path, s.name_line AS line, s.name_col AS col
       FROM symbols s JOIN files f ON f.id = s.file_id WHERE s.name = ?`,
    )
    .all(name) as { path: string; line: number; col: number }[];
  const refs = db
    .prepare(
      `SELECT f.path AS path, r.line AS line, r.col AS col
       FROM refs r JOIN files f ON f.id = r.file_id
       WHERE r.name = ? AND r.kind IN ('call','extends')`,
    )
    .all(name) as { path: string; line: number; col: number }[];

  // path → (line:col → occurrence). 정의 우선이므로 정의를 먼저 넣고 참조는 미존재일 때만.
  const groupMap = new Map<string, Map<string, RenameOccurrence>>();
  const add = (path: string, line: number, col: number, isDefinition: boolean) => {
    let m = groupMap.get(path);
    if (!m) { m = new Map(); groupMap.set(path, m); }
    const key = `${line}:${col}`;
    if (!m.has(key)) m.set(key, { line, col, isDefinition });
  };
  for (const d of defs) add(d.path, d.line, d.col, true);
  for (const r of refs) add(r.path, r.line, r.col, false);

  const groups: RenameFileGroup[] = [];
  for (const [path, m] of groupMap) {
    const occurrences = [...m.values()].sort((a, b) => (a.line - b.line) || (a.col - b.col));
    groups.push({ path, occurrences });
  }
  groups.sort((a, b) => a.path.localeCompare(b.path));

  // unconfirmed: FTS로 후보 파일을 좁힌 뒤 단어 경계 스캔. groups와 중복 제거.
  const escaped = `"${name.replace(/"/g, '""')}"`;
  const rows = db
    .prepare(`SELECT path, content FROM file_text WHERE file_text MATCH ?`)
    .all(escaped) as { path: string; content: string }[];
  const re = new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(name)}(?![A-Za-z0-9_$])`, 'g');

  const unconfirmed: RenameFileGroup[] = [];
  for (const row of rows) {
    const inGroup = groupMap.get(row.path);
    const found: RenameOccurrence[] = [];
    const contentLines = row.content.split('\n');
    for (let ln = 0; ln < contentLines.length; ln++) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(contentLines[ln])) !== null) {
        const key = `${ln}:${m.index}`;
        if (inGroup && inGroup.has(key)) continue;
        found.push({ line: ln, col: m.index, isDefinition: false });
      }
    }
    if (found.length) unconfirmed.push({ path: row.path, occurrences: found });
  }
  unconfirmed.sort((a, b) => a.path.localeCompare(b.path));

  return { groups, unconfirmed };
}

export function getSuperclasses(db: Database, symbolId: number): SymbolHit[] {
  return db
    .prepare(
      `${HIT_SELECT} WHERE s.name IN (
         SELECT DISTINCT r.name FROM refs r WHERE r.enclosing_symbol_id = ? AND r.kind = 'extends'
       ) AND s.kind IN ${CLASS_KINDS} ORDER BY s.name`,
    )
    .all(symbolId) as SymbolHit[];
}

export function getSubclasses(db: Database, name: string): SymbolHit[] {
  return db
    .prepare(
      `SELECT DISTINCT s.id, s.name, s.kind, s.scope, s.signature, s.start_line AS line, s.name_line AS nameLine, s.name_col AS nameCol, f.path
       FROM refs r
       JOIN symbols s ON s.id = r.enclosing_symbol_id
       JOIN files f ON f.id = s.file_id
       WHERE r.kind = 'extends' AND r.name = ? AND s.kind IN ${CLASS_KINDS}
       ORDER BY s.name`,
    )
    .all(name) as SymbolHit[];
}

// ── HTTP 경계 매칭 (v3 스펙 §B) ──

export interface EndpointHit {
  id: number;
  method: string;
  path: string;
  rawPath: string;
  file: string;
  line: number;
  handlerId: number | null;
  handlerName: string | null;
}

export interface HttpCallHit {
  id: number;
  method: string;
  path: string; // ''이면 unresolved(동적 URL)
  rawPath: string;
  file: string;
  line: number;
  col: number;
  enclosingName: string | null;
}

const EP_SELECT = `SELECT e.id, e.method, e.path, e.raw_path AS rawPath, f.path AS file, e.line,
  e.symbol_id AS handlerId, hs.name AS handlerName
  FROM endpoints e JOIN files f ON f.id = e.file_id LEFT JOIN symbols hs ON hs.id = e.symbol_id`;

const HC_SELECT = `SELECT c.id, c.method, c.path, c.raw_path AS rawPath, f.path AS file, c.line, c.col,
  es.name AS enclosingName
  FROM http_calls c JOIN files f ON f.id = c.file_id LEFT JOIN symbols es ON es.id = c.enclosing_symbol_id`;

// 메서드 호환: 완전 일치 또는 어느 한쪽이 '*'(불명)
const METHOD_COMPAT = `(e.method = c.method OR e.method = '*' OR c.method = '*')`;

export function getEndpoints(db: Database, limit = 500): EndpointHit[] {
  return db.prepare(`${EP_SELECT} ORDER BY e.path, e.method LIMIT ?`).all(limit) as EndpointHit[];
}

export function getHttpCalls(db: Database, limit = 500): HttpCallHit[] {
  return db.prepare(`${HC_SELECT} ORDER BY f.path, c.line LIMIT ?`).all(limit) as HttpCallHit[];
}

/** 호출부 → 매칭되는 엔드포인트들. 정규화 path 완전일치 + 메서드 호환. unresolved(path='')는 항상 []. */
export function matchCallToEndpoints(db: Database, callId: number): EndpointHit[] {
  return db
    .prepare(
      `${EP_SELECT} JOIN http_calls c ON c.path = e.path AND ${METHOD_COMPAT}
       WHERE c.id = ? AND c.path != '' ORDER BY f.path, e.line`,
    )
    .all(callId) as EndpointHit[];
}

/** 엔드포인트 → 이를 부르는 프론트 호출부들 (역방향). */
export function matchEndpointToCalls(db: Database, endpointId: number): HttpCallHit[] {
  return db
    .prepare(
      `${HC_SELECT} JOIN endpoints e ON e.path = c.path AND ${METHOD_COMPAT}
       WHERE e.id = ? AND c.path != '' ORDER BY f.path, c.line`,
    )
    .all(endpointId) as HttpCallHit[];
}

export interface FlowCall extends HttpCallHit { endpoints: EndpointHit[] }
export interface FlowEndpoint extends EndpointHit { calls: HttpCallHit[] }
export interface FileFlow { calls: FlowCall[]; endpoints: FlowEndpoint[] }

/** 파일의 HTTP 경계 전체 + 매칭 임베드 — Flow 탭용 단일 왕복. */
export function getFlowForFile(db: Database, relPath: string): FileFlow {
  const calls = db.prepare(`${HC_SELECT} WHERE f.path = ? ORDER BY c.line`).all(relPath) as HttpCallHit[];
  const endpoints = db.prepare(`${EP_SELECT} WHERE f.path = ? ORDER BY e.line`).all(relPath) as EndpointHit[];
  return {
    calls: calls.map((c) => ({ ...c, endpoints: c.path === '' ? [] : matchCallToEndpoints(db, c.id) })),
    endpoints: endpoints.map((e) => ({ ...e, calls: matchEndpointToCalls(db, e.id) })),
  };
}

/** HTTP 경로 부분일치 또는 핸들러명 일치로 Flow 체인 검색 — 에이전트 trace_http용. */
export function traceHttp(db: Database, query: string, limit = 20): FileFlow {
  const like = `%${query}%`;
  const endpoints = db
    .prepare(`${EP_SELECT} WHERE (e.path LIKE ? OR hs.name = ?) ORDER BY e.path LIMIT ?`)
    .all(like, query, limit) as EndpointHit[];
  const calls = db
    .prepare(`${HC_SELECT} WHERE c.path LIKE ? AND c.path != '' ORDER BY f.path, c.line LIMIT ?`)
    .all(like, limit) as HttpCallHit[];
  return {
    calls: calls.map((c) => ({ ...c, endpoints: matchCallToEndpoints(db, c.id) })),
    endpoints: endpoints.map((e) => ({ ...e, calls: matchEndpointToCalls(db, e.id) })),
  };
}

// ── Impact (blast radius) — 이름 기반 전이적 callers ──

export interface ImpactHit {
  name: string | null; // 호출자 심볼 이름 (파일 최상위 호출이면 null)
  kind: string | null;
  path: string;
  line: number;
  depth: number; // 1 = 직접 호출자
}

/** name 심볼의 전이적 호출자 BFS. 이름 기반 근사(동명 혼입 가능성은 Relation과 동일 한계). */
export function getImpact(db: Database, name: string, depth = 2, limit = 200): ImpactHit[] {
  const out: ImpactHit[] = [];
  const seenSite = new Set<string>();
  const visited = new Set<string>([name]);
  let frontier = [name];
  for (let d = 1; d <= depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const n of frontier) {
      for (const c of getCallers(db, n)) {
        const key = `${c.callerName ?? '?'}:${c.path}:${c.line}`;
        if (seenSite.has(key)) continue;
        seenSite.add(key);
        out.push({ name: c.callerName, kind: c.callerKind, path: c.path, line: c.line, depth: d });
        if (out.length >= limit) return out;
        if (c.callerName && !visited.has(c.callerName)) {
          visited.add(c.callerName);
          next.push(c.callerName);
        }
      }
    }
    frontier = next;
  }
  return out;
}
