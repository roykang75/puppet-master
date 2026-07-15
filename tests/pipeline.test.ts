import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { openDb } from '../src/indexer/db';
import { scanProject } from '../src/indexer/scanner';
import { Indexer } from '../src/indexer/pipeline';

const FIXTURE = path.join(__dirname, 'fixtures', 'sample');

describe('scanProject', () => {
  it('finds supported files and respects .gitignore', () => {
    const files = scanProject(FIXTURE).map((f) => path.basename(f));
    expect(files).toContain('util.c');
    expect(files).toContain('main.c');
    expect(files).toContain('app.ts');
    expect(files).not.toContain('skip_me.c');
    expect(files).not.toContain('.gitignore');
  });
});

describe('Indexer', () => {
  let db: ReturnType<typeof openDb>;
  let idx: Indexer;
  beforeEach(() => {
    db = openDb(':memory:');
    idx = new Indexer(db, FIXTURE);
  });

  it('indexes the fixture project', () => {
    const stats = idx.indexProject();
    expect(stats.files).toBe(3);
    const sym = db.prepare(`SELECT s.name, f.path FROM symbols s JOIN files f ON f.id=s.file_id WHERE s.name='create_widget' AND s.kind='function'`).all() as any[];
    expect(sym).toHaveLength(1);
    expect(sym[0].path).toBe('util.c');
    const frag = db.prepare(`SELECT count(*) c FROM name_fragments nf JOIN symbols s ON s.id=nf.symbol_id WHERE s.name='create_widget'`).get() as any;
    expect(frag.c).toBe(2); // create, widget
    const fts = db.prepare(`SELECT path FROM file_text WHERE file_text MATCH '"unique_needle_string"'`).all() as any[];
    expect(fts.map((r) => r.path)).toEqual(['app.ts']);
  });

  it('skips unchanged files on reindex', () => {
    idx.indexProject();
    const stats2 = idx.indexProject();
    expect(stats2.skipped).toBe(3);
  });

  it('updates a changed file without duplicating rows', () => {
    idx.indexProject();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'si-'));
    for (const f of ['util.c', 'main.c']) fs.copyFileSync(path.join(FIXTURE, f), path.join(tmp, f));
    const db2 = openDb(':memory:');
    const idx2 = new Indexer(db2, tmp);
    idx2.indexProject();
    fs.writeFileSync(path.join(tmp, 'util.c'), 'int create_widget(int id) { return id * 3; }\nint destroy_widget(int id) { return 0; }\n');
    idx2.indexFile(path.join(tmp, 'util.c'));
    const names = (db2.prepare(`SELECT name FROM symbols ORDER BY name`).all() as any[]).map((r) => r.name);
    expect(names.filter((n) => n === 'create_widget')).toHaveLength(1);
    expect(names).toContain('destroy_widget');
  });

  it('removeFile deletes all rows for the file', () => {
    idx.indexProject();
    idx.removeFile(path.join(FIXTURE, 'util.c'));
    expect(db.prepare(`SELECT count(*) c FROM files WHERE path='util.c'`).get()).toEqual({ c: 0 });
    expect(db.prepare(`SELECT count(*) c FROM symbols s JOIN files f ON f.id=s.file_id WHERE f.path='util.c'`).get()).toEqual({ c: 0 });
    expect(db.prepare(`SELECT count(*) c FROM file_text WHERE path='util.c'`).get()).toEqual({ c: 0 });
  });
});
