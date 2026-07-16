import type { Database } from 'better-sqlite3';
import { splitName } from './fragments';
import type { RenameOccurrence, RenameFileGroup, RenameTargets } from '../shared/protocol';

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
