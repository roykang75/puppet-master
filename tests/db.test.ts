import { describe, it, expect } from 'vitest';
import { openDb, SCHEMA_VERSION } from '../src/indexer/db';

describe('openDb', () => {
  it('creates schema on fresh db', () => {
    const db = openDb(':memory:');
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name`)
      .all()
      .map((r: any) => r.name);
    for (const t of ['meta', 'files', 'symbols', 'refs', 'name_fragments', 'file_text']) {
      expect(tables).toContain(t);
    }
    const v = db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get() as any;
    expect(Number(v.value)).toBe(SCHEMA_VERSION);
  });

  it('cascades symbol/ref/fragment deletion when file is deleted', () => {
    const db = openDb(':memory:');
    const fid = db.prepare(`INSERT INTO files (path,hash,language,indexed_at) VALUES ('a.c','h','c',0)`).run().lastInsertRowid;
    const sid = db.prepare(`INSERT INTO symbols (name,kind,file_id,start_line,start_col,end_line,end_col) VALUES ('f','function',?,0,0,1,0)`).run(fid).lastInsertRowid;
    db.prepare(`INSERT INTO name_fragments (fragment,symbol_id) VALUES ('f2',?)`).run(sid);
    db.prepare(`INSERT INTO refs (name,kind,file_id,line,col) VALUES ('g','call',?,0,0)`).run(fid);
    db.prepare(`DELETE FROM files WHERE id=?`).run(fid);
    expect(db.prepare(`SELECT count(*) c FROM symbols`).get()).toEqual({ c: 0 });
    expect(db.prepare(`SELECT count(*) c FROM refs`).get()).toEqual({ c: 0 });
    expect(db.prepare(`SELECT count(*) c FROM name_fragments`).get()).toEqual({ c: 0 });
  });
});
