import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openDb } from '../src/indexer/db';
import { Indexer } from '../src/indexer/pipeline';
import { resolveSymbol } from '../src/indexer/resolve';
import type { Database } from 'better-sqlite3';

let work: string;
let db: Database;

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-resolve-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(path.join(proj, 'lib'), { recursive: true });
  // helper가 3곳에 정의: 같은 파일(main.ts), import된 파일(lib/util.ts), 무관 파일(other.ts)
  fs.writeFileSync(path.join(proj, 'main.ts'),
    `import { thing } from './lib/util';\nfunction helper() { return 1; }\nfunction go() { return helper(); }\n`);
  fs.writeFileSync(path.join(proj, 'lib', 'util.ts'),
    `export function helper() { return 2; }\nexport function thing() { return helper(); }\n`);
  fs.writeFileSync(path.join(proj, 'other.ts'), `export function helper() { return 3; }\n`);
  db = openDb(path.join(work, 'test.db'));
  new Indexer(db, proj).indexProject();
});
afterAll(() => { db.close(); fs.rmSync(work, { recursive: true, force: true }); });

describe('resolveSymbol 우선순위', () => {
  it('같은 파일 > import된 파일 > 전역', () => {
    const cands = resolveSymbol(db, 'helper', 'main.ts');
    expect(cands.length).toBe(3);
    expect(cands[0].path).toBe('main.ts');
    expect(cands[0].confidence).toBe('same-file');
    expect(cands[1].path).toBe('lib/util.ts');
    expect(cands[1].confidence).toBe('imported');
    expect(cands[2].path).toBe('other.ts');
    expect(cands[2].confidence).toBe('global');
  });
  it('import 파일에서 조회하면 그 파일이 same-file', () => {
    const cands = resolveSymbol(db, 'helper', 'lib/util.ts');
    expect(cands[0].path).toBe('lib/util.ts');
  });
  it('없는 이름은 빈 배열', () => {
    expect(resolveSymbol(db, 'nope', 'main.ts')).toEqual([]);
  });
  it('basename 폴백: 상대경로가 아닌 import도 파일 매칭', () => {
    // main.ts에 상대 import만 있으므로 lib/util.ts가 imported로 잡히는 것 자체가 상대경로 해석 검증.
    // basename 폴백은 C 스타일 include로 검증:
    const proj2 = path.join(work, 'proj2');
    fs.mkdirSync(path.join(proj2, 'inc'), { recursive: true });
    // 헤더 안의 프로토타입(int helper();)은 심볼로 추출되지 않으므로 실제 정의(본문)를 둔다.
    fs.writeFileSync(path.join(proj2, 'main.c'), '#include "util.h"\nint go() { return helper(); }\n');
    fs.writeFileSync(path.join(proj2, 'inc', 'util.h'), 'int helper() { return 1; }\n#define UTIL_H 1\n');
    fs.writeFileSync(path.join(proj2, 'inc', 'other.h'), 'int helper() { return 2; }\n');
    const db2 = openDb(path.join(work, 'test2.db'));
    new Indexer(db2, proj2).indexProject();
    const cands = resolveSymbol(db2, 'helper', 'main.c');
    // "util.h"는 main.c 옆에 없으므로 basename 매칭으로 inc/util.h가 imported
    const imported = cands.filter((c) => c.confidence === 'imported').map((c) => c.path);
    expect(imported).toContain('inc/util.h');
    db2.close();
  });
});
