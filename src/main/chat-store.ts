// src/main/chat-store.ts — 채팅 스레드 영속화 (better-sqlite3 동기, main 전용)
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface ThreadMeta {
  id: string;
  title: string;
  updatedAt: number;
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
    `);
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

  renameThread(id: string, title: string): void {
    this.db.prepare('UPDATE threads SET title = ? WHERE id = ?').run(title, id);
  }

  deleteThread(id: string): void {
    this.db.prepare('DELETE FROM threads WHERE id = ?').run(id); // messages는 CASCADE
  }
}
