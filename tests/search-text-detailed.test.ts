import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openDb } from '../src/indexer/db';
import { Indexer } from '../src/indexer/pipeline';
import { searchTextDetailed } from '../src/indexer/api';
import type { TextMatch } from '../src/indexer/api';
import type { Database } from 'better-sqlite3';

let work: string;
let db: Database;

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-textsearch-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  // a.ts: 대소문자 혼합·한 줄 다중 매치·선행 공백 트림 확인용
  fs.writeFileSync(
    path.join(proj, 'a.ts'),
    'const needle = 1;\n' + // line 0, col 6
      'console.log(needle, NEEDLE, Needle);\n' + // line 1: col 12 / 20 / 28
      '    const indented = needle;\n', // line 2: 선행 공백, needle at col 21
  );
  // paren.ts: 특수문자 질의 안전성 (FTS 이스케이프 + literal indexOf)
  fs.writeFileSync(path.join(proj, 'paren.ts'), 'const r = foo(bar);\n'); // 'foo(' at col 10
  // many.ts: 파일당 캡(20) 확인 — needle 25줄
  fs.writeFileSync(path.join(proj, 'many.ts'), Array.from({ length: 25 }, () => 'let needle;').join('\n') + '\n');
  db = openDb(path.join(work, 'test.db'));
  new Indexer(db, proj).indexProject();
});
afterAll(() => { db.close(); fs.rmSync(work, { recursive: true, force: true }); });

const at = (ms: TextMatch[], p: string, line: number, col: number) =>
  ms.some((m) => m.path === p && m.line === line && m.col === col);

describe('searchTextDetailed', () => {
  it('줄/컬럼 위치를 0-기반으로 정확히 반환', () => {
    const ms = searchTextDetailed(db, 'needle');
    expect(at(ms, 'a.ts', 0, 6)).toBe(true);
    expect(at(ms, 'a.ts', 1, 12)).toBe(true);
  });

  it('한 줄 다중 매치 + 대소문자 무시', () => {
    const ms = searchTextDetailed(db, 'needle').filter((m) => m.path === 'a.ts' && m.line === 1);
    // 같은 줄의 needle / NEEDLE / Needle 세 곳 모두
    expect(ms.map((m) => m.col).sort((x, y) => x - y)).toEqual([12, 20, 28]);
  });

  it('lineText는 트림되며 col은 원본(트림 전) 기준', () => {
    const m = searchTextDetailed(db, 'needle').find((x) => x.path === 'a.ts' && x.line === 2);
    expect(m).toBeDefined();
    expect(m!.lineText).toBe('const indented = needle;'); // 선행 공백 제거
    expect(m!.col).toBe(21); // 원본 줄에서의 위치 (트림 영향 없음)
  });

  it('특수문자(괄호) 질의 안전 — 리터럴 위치 매칭', () => {
    const ms = searchTextDetailed(db, 'foo(');
    expect(at(ms, 'paren.ts', 0, 10)).toBe(true);
  });

  it('파일당 캡 20개', () => {
    const ms = searchTextDetailed(db, 'needle').filter((m) => m.path === 'many.ts');
    expect(ms.length).toBe(20);
  });

  it('전체 limit 상한 준수', () => {
    expect(searchTextDetailed(db, 'needle', 3).length).toBe(3);
  });

  it('빈 질의는 빈 배열', () => {
    expect(searchTextDetailed(db, '')).toEqual([]);
  });
});
