import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import { extractFile } from './extractor';
import { languageForPath } from './languages';
import { splitName } from './fragments';
import { scanProject } from './scanner';

export interface IndexStats {
  files: number;
  symbols: number;
  refs: number;
  skipped: number;
}

export type ProgressFn = (done: number, total: number, file: string) => void;

export class Indexer {
  constructor(
    private db: Database,
    private root: string,
  ) {}

  private toRel(absPath: string): string {
    return path.relative(this.root, absPath).split(path.sep).join('/');
  }

  indexProject(onProgress?: ProgressFn): IndexStats {
    const files = scanProject(this.root);
    const stats: IndexStats = { files: 0, symbols: 0, refs: 0, skipped: 0 };
    let done = 0;
    for (const abs of files) {
      const changed = this.indexFile(abs);
      if (changed) stats.files++;
      else stats.skipped++;
      done++;
      onProgress?.(done, files.length, this.toRel(abs));
    }
    // 디스크에서 사라진 파일 정리
    const rels = new Set(files.map((f) => this.toRel(f)));
    const known = this.db.prepare(`SELECT id, path FROM files`).all() as { id: number; path: string }[];
    this.db.transaction(() => {
      for (const k of known) {
        if (!rels.has(k.path)) {
          this.db.prepare(`DELETE FROM files WHERE id=?`).run(k.id);
          this.db.prepare(`DELETE FROM file_text WHERE rowid=?`).run(k.id);
        }
      }
    })();
    const c = this.db.prepare(`SELECT (SELECT count(*) FROM symbols) s, (SELECT count(*) FROM refs) r`).get() as { s: number; r: number };
    stats.symbols = c.s;
    stats.refs = c.r;
    return stats;
  }

  /** @returns true면 인덱싱함, false면 해시 동일로 스킵 */
  indexFile(absPath: string): boolean {
    const spec = languageForPath(absPath);
    if (!spec) return false;
    let content: string;
    try {
      content = fs.readFileSync(absPath, 'utf8');
    } catch {
      return false;
    }
    return this.indexContent(this.toRel(absPath), content);
  }

  /** 디스크 대신 주어진 내용으로 인덱싱 (유휴 재파싱용). 해시 가드 동일 — 저장 시 indexFile과 자연 수렴.
   *  @returns true면 인덱싱함, false면 해시 동일로 스킵 */
  indexContent(relPath: string, content: string): boolean {
    const spec = languageForPath(relPath);
    if (!spec) return false;
    const rel = relPath;
    const hash = crypto.createHash('sha1').update(content).digest('hex');
    const existing = this.db.prepare(`SELECT id, hash FROM files WHERE path=?`).get(rel) as { id: number; hash: string } | undefined;
    if (existing && existing.hash === hash) return false;

    const { symbols, refs } = extractFile(content, spec);
    const tx = this.db.transaction(() => {
      let fileId: number;
      if (existing) {
        fileId = existing.id;
        this.db.prepare(`UPDATE files SET hash=?, language=?, indexed_at=? WHERE id=?`).run(hash, spec.id, Date.now(), fileId);
        this.db.prepare(`DELETE FROM symbols WHERE file_id=?`).run(fileId);
        this.db.prepare(`DELETE FROM refs WHERE file_id=?`).run(fileId);
        this.db.prepare(`DELETE FROM file_text WHERE rowid=?`).run(fileId);
      } else {
        fileId = Number(
          this.db.prepare(`INSERT INTO files (path, hash, language, indexed_at) VALUES (?,?,?,?)`).run(rel, hash, spec.id, Date.now()).lastInsertRowid,
        );
      }
      const insSym = this.db.prepare(
        `INSERT INTO symbols (name,kind,file_id,start_line,start_col,end_line,end_col,name_line,name_col,scope,signature) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      );
      const insFrag = this.db.prepare(`INSERT INTO name_fragments (fragment, symbol_id) VALUES (?,?)`);
      const ids: number[] = [];
      for (const s of symbols) {
        const id = Number(insSym.run(s.name, s.kind, fileId, s.startLine, s.startCol, s.endLine, s.endCol, s.nameLine, s.nameCol, s.scope, s.signature).lastInsertRowid);
        ids.push(id);
        for (const f of splitName(s.name)) insFrag.run(f, id);
      }
      const insRef = this.db.prepare(`INSERT INTO refs (name,kind,file_id,line,col,enclosing_symbol_id) VALUES (?,?,?,?,?,?)`);
      for (const r of refs) {
        insRef.run(r.name, r.kind, fileId, r.line, r.col, r.enclosingIndex === null ? null : ids[r.enclosingIndex]);
      }
      this.db.prepare(`INSERT INTO file_text (rowid, path, content) VALUES (?,?,?)`).run(fileId, rel, content);
    });
    tx();
    return true;
  }

  removeFile(absPath: string): void {
    const rel = this.toRel(absPath);
    const row = this.db.prepare(`SELECT id FROM files WHERE path=?`).get(rel) as { id: number } | undefined;
    if (!row) return;
    this.db.prepare(`DELETE FROM files WHERE id=?`).run(row.id); // symbols/refs/fragments는 cascade
    this.db.prepare(`DELETE FROM file_text WHERE rowid=?`).run(row.id);
  }
}
