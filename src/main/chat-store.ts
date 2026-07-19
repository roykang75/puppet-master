// src/main/chat-store.ts — 채팅 스레드 영속화 (better-sqlite3 동기, main 전용)
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface ThreadMeta {
  id: string;
  title: string;
  updatedAt: number;
}
export interface ThreadSearchHit {
  threadId: string;
  title: string;
  updatedAt: number;
  snippet: string;
}
export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  ts?: number;
  error?: string;
  tools?: unknown[];
}

export class ChatStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER, updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, seq INTEGER NOT NULL,
        role TEXT NOT NULL, content TEXT NOT NULL, ts INTEGER, tools TEXT,
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, seq);
      -- 전문검색: messages.content 외부콘텐츠 FTS5 + insert/delete 트리거 동기화
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, content='messages', content_rowid='id');
      CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END;
    `);
    // 기존 DB(트리거 이전 삽입분) 정합을 위해 열 때 1회 재구축 — 채팅 규모라 저비용.
    this.db.exec(`INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');`);
  }

  close(): void {
    this.db.close();
  }

  listThreads(): ThreadMeta[] {
    return this.db
      .prepare('SELECT id, title, updated_at AS updatedAt FROM threads ORDER BY updated_at DESC')
      .all() as ThreadMeta[];
  }

  loadThread(id: string): StoredMessage[] {
    const rows = this.db
      .prepare('SELECT role, content, ts, tools FROM messages WHERE thread_id = ? ORDER BY seq')
      .all(id) as { role: string; content: string; ts: number | null; tools: string | null }[];
    return rows.map((r) => ({
      role: r.role as 'user' | 'assistant',
      content: r.content,
      ts: r.ts ?? undefined,
      tools: r.tools ? (JSON.parse(r.tools) as unknown[]) : undefined,
    }));
  }

  createThread(title: string): string {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare('INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, title, now, now);
    return id;
  }

  saveThread(id: string, title: string, messages: StoredMessage[]): void {
    const now = Date.now();
    const tx = this.db.transaction(() => {
      // 없으면 생성, 있으면 title/updated_at 갱신
      this.db
        .prepare(
          `INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
        )
        .run(id, title, now, now);
      this.db.prepare('DELETE FROM messages WHERE thread_id = ?').run(id);
      const ins = this.db.prepare('INSERT INTO messages (thread_id, seq, role, content, ts, tools) VALUES (?, ?, ?, ?, ?, ?)');
      messages.forEach((m, i) =>
        ins.run(id, i, m.role, m.content, m.ts ?? null, m.tools ? JSON.stringify(m.tools) : null),
      );
    });
    tx();
  }

  /** 전체 스레드의 메시지 본문을 전문검색. 스레드당 최상위 1건, 관련도순. */
  searchMessages(query: string, limit = 30): ThreadSearchHit[] {
    // 사용자 입력을 안전한 FTS5 phrase(토큰별 인용)로 — 특수문자 구문오류 방지, 토큰 AND.
    const match = query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => '"' + t.replace(/"/g, '""') + '"')
      .join(' ');
    if (!match) return [];
    const rows = this.db
      .prepare(
        `SELECT t.id AS threadId, t.title AS title, t.updated_at AS updatedAt,
                snippet(messages_fts, 0, '⟦', '⟧', '…', 12) AS snippet
         FROM messages_fts f
         JOIN messages m ON m.id = f.rowid
         JOIN threads t ON t.id = m.thread_id
         WHERE messages_fts MATCH ?
         ORDER BY bm25(messages_fts)
         LIMIT 200`,
      )
      .all(match) as ThreadSearchHit[];
    const seen = new Set<string>();
    const out: ThreadSearchHit[] = [];
    for (const r of rows) {
      if (seen.has(r.threadId)) continue;
      seen.add(r.threadId);
      out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  }

  renameThread(id: string, title: string): void {
    this.db.prepare('UPDATE threads SET title = ? WHERE id = ?').run(title, id);
  }

  deleteThread(id: string): void {
    this.db.prepare('DELETE FROM threads WHERE id = ?').run(id); // messages는 CASCADE
  }
}
