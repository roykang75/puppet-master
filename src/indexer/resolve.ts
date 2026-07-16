import type { Database } from 'better-sqlite3';
import * as path from 'path';
import { getDefinitions, SymbolHit } from './api';

export type Confidence = 'same-file' | 'imported' | 'global';

export interface Candidate extends SymbolHit {
  confidence: Confidence;
}

// 정의 kind 우선순위 (동일 신뢰도 내 정렬)
const KIND_ORDER = ['function', 'method', 'class', 'struct', 'interface', 'type', 'enum', 'namespace', 'variable', 'field', 'macro'];
const kindRank = (k: string) => {
  const i = KIND_ORDER.indexOf(k);
  return i === -1 ? KIND_ORDER.length : i;
};

const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.java', '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh'];

// SQLite LIKE 특수문자(%, _, \) 이스케이프 — import 문자열이 와일드카드로 오작동하는 것 방지
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

/** fromPath의 import 문자열 하나를 프로젝트 rel 파일 경로들로 휴리스틱 매칭 */
export function matchImport(db: Database, imp: string, fromPath: string): string[] {
  const out = new Set<string>();
  const byPath = db.prepare(`SELECT path FROM files WHERE path = ?`);
  const bySuffix = db.prepare(`SELECT path FROM files WHERE path LIKE ? ESCAPE '\\'`);
  const tryExact = (p: string) => {
    const norm = path.posix.normalize(p);
    if (byPath.get(norm) as { path: string } | undefined) out.add(norm);
  };
  if (imp.startsWith('./') || imp.startsWith('../')) {
    const base = path.posix.join(path.posix.dirname(fromPath), imp);
    tryExact(base);
    for (const e of EXTS) tryExact(base + e);
    tryExact(base + '/index.ts');
    tryExact(base + '/index.js');
  } else {
    // 비상대: basename 매칭 — C include("util.h"), Java(a.b.C), Python(a.b) 등
    const lastSeg = imp.split('/').pop()!;
    const hasExt = EXTS.some((e) => lastSeg.endsWith(e));
    if (hasExt) {
      for (const row of bySuffix.all(`%/${likeEscape(lastSeg)}`) as { path: string }[]) out.add(row.path);
      tryExact(lastSeg); // 루트 직속
    } else {
      const dotted = lastSeg.split('.').pop()!; // java.util.List → List / os.path → path
      for (const e of EXTS) {
        for (const row of bySuffix.all(`%/${likeEscape(dotted + e)}`) as { path: string }[]) out.add(row.path);
        tryExact(`${dotted}${e}`);
      }
    }
  }
  out.delete(fromPath);
  return [...out];
}

/** 이름 → 후보 심볼, 신뢰도 순 (스펙 §5 A안: 같은 파일 → import 연결 → 전역) */
export function resolveSymbol(db: Database, name: string, fromPath: string): Candidate[] {
  const defs = getDefinitions(db, name);
  if (defs.length === 0) return [];
  const imports = (
    db
      .prepare(`SELECT r.name FROM refs r JOIN files f ON f.id = r.file_id WHERE f.path = ? AND r.kind = 'import'`)
      .all(fromPath) as { name: string }[]
  ).map((r) => r.name);
  const importedFiles = new Set<string>();
  for (const imp of imports) for (const p of matchImport(db, imp, fromPath)) importedFiles.add(p);

  const conf = (d: SymbolHit): Confidence =>
    d.path === fromPath ? 'same-file' : importedFiles.has(d.path) ? 'imported' : 'global';
  const CONF_RANK: Record<Confidence, number> = { 'same-file': 0, imported: 1, global: 2 };

  return defs
    .map((d) => ({ ...d, confidence: conf(d) }))
    .sort(
      (a, b) =>
        CONF_RANK[a.confidence] - CONF_RANK[b.confidence] ||
        kindRank(a.kind) - kindRank(b.kind) ||
        a.path.localeCompare(b.path) ||
        a.line - b.line,
    );
}
