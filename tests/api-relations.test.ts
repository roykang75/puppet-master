import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openDb } from '../src/indexer/db';
import { Indexer } from '../src/indexer/pipeline';
import { getReferences, getSuperclasses, getSubclasses, getSymbolsForFile } from '../src/indexer/api';
import type { Database } from 'better-sqlite3';

let work: string;
let db: Database;

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-apirel-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'h.ts'),
    `export class Base {}\nexport class Mid extends Base {}\nexport class Leaf extends Mid {}\nexport function useIt() { const m = new Mid(); return m; }\n`);
  db = openDb(path.join(work, 'test.db'));
  new Indexer(db, proj).indexProject();
});
afterAll(() => { db.close(); fs.rmSync(work, { recursive: true, force: true }); });

describe('클래스 계층', () => {
  it('getSubclasses: Base의 자식은 Mid', () => {
    expect(getSubclasses(db, 'Base').map((s) => s.name)).toEqual(['Mid']);
  });
  it('getSuperclasses: Mid의 부모는 Base', () => {
    const mid = getSymbolsForFile(db, 'h.ts').find((s) => s.name === 'Mid')!;
    expect(getSuperclasses(db, mid.id).map((s) => s.name)).toEqual(['Base']);
  });
});

describe('getReferences', () => {
  it('call + extends 동명 참조를 파일/줄과 함께 반환', () => {
    const refs = getReferences(db, 'Mid');
    const kinds = refs.map((r) => r.kind).sort();
    expect(kinds).toContain('extends'); // Leaf extends Mid
    expect(kinds).toContain('call');    // new Mid()
    for (const r of refs) expect(r.path).toBe('h.ts');
  });
});
