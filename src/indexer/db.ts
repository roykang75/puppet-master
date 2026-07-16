import Database from 'better-sqlite3';

export const SCHEMA_VERSION = 2; // v2: refs.kind에 'import'/'extends' 추가 (구조 동일, 재인덱싱 강제)

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  hash TEXT NOT NULL,
  language TEXT NOT NULL,
  indexed_at INTEGER NOT NULL
);
CREATE TABLE symbols (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  start_line INTEGER NOT NULL,
  start_col INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  end_col INTEGER NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  signature TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_symbols_name ON symbols(name);
CREATE INDEX idx_symbols_file ON symbols(file_id);
CREATE TABLE refs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  line INTEGER NOT NULL,
  col INTEGER NOT NULL,
  enclosing_symbol_id INTEGER
);
CREATE INDEX idx_refs_name ON refs(name);
CREATE INDEX idx_refs_file ON refs(file_id);
CREATE TABLE name_fragments (
  fragment TEXT NOT NULL,
  symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE
);
CREATE INDEX idx_fragments ON name_fragments(fragment);
CREATE VIRTUAL TABLE file_text USING fts5(path UNINDEXED, content);
`;

export function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('mmap_size = 268435456');
  db.pragma('foreign_keys = ON');
  const hasMeta = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='meta'`)
    .get();
  const row = hasMeta
    ? (db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get() as { value: string } | undefined)
    : undefined;
  if (!row || Number(row.value) !== SCHEMA_VERSION) rebuildSchema(db);
  return db;
}

function rebuildSchema(db: Database.Database): void {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    DROP TABLE IF EXISTS name_fragments;
    DROP TABLE IF EXISTS refs;
    DROP TABLE IF EXISTS symbols;
    DROP TABLE IF EXISTS files;
    DROP TABLE IF EXISTS meta;
    DROP TABLE IF EXISTS file_text;
  `);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)`).run(String(SCHEMA_VERSION));
}
