import type { Database } from 'better-sqlite3';
import { splitName } from './fragments';

export interface SymbolHit {
  id: number;
  name: string;
  kind: string;
  scope: string;
  signature: string;
  path: string;
  line: number;
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

const HIT_SELECT = `SELECT s.id, s.name, s.kind, s.scope, s.signature, s.start_line AS line, f.path
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
