import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ChatStore } from '../src/main/chat-store';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-chat-int-'));
  dbPath = path.join(dir, 'chat.db');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('ChatStore 영속화 왕복', () => {
  it('저장 후 새 인스턴스가 도구 카드(diff before/after)까지 복원', () => {
    const a = new ChatStore(dbPath);
    const id = a.createThread('구구단');
    a.saveThread(id, '구구단', [
      { role: 'user', content: '구구단 만들어', ts: 1 },
      { role: 'assistant', content: '완료', ts: 2, tools: [{ id: 'c1', name: 'write_file', summary: 'g.py', state: 'done', path: 'g.py', before: 'old', after: 'new' }] },
    ]);
    a.close();

    const b = new ChatStore(dbPath);
    try {
      expect(b.listThreads().map((t) => t.title)).toEqual(['구구단']);
      const msgs = b.loadThread(id);
      expect(msgs).toHaveLength(2);
      const tool = (msgs[1].tools as any[])[0];
      expect(tool.before).toBe('old');
      expect(tool.after).toBe('new');
      expect(tool.path).toBe('g.py');
    } finally {
      b.close();
    }
  });
});
