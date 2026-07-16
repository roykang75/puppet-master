import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openDb } from '../src/indexer/db';
import { Indexer } from '../src/indexer/pipeline';
import { getRenameTargets } from '../src/indexer/api';
import type { RenameFileGroup } from '../src/shared/protocol';
import type { Database } from 'better-sqlite3';

let work: string;
let db: Database;

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-rename-'));
  const proj = path.join(work, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'a.ts'), `export function helper() { return 1; }\n`);
  fs.writeFileSync(
    path.join(proj, 'b.ts'),
    `import { helper } from './a';\nexport function go() { return helper(); }\nconst alias = helper;\n`,
  );
  db = openDb(path.join(work, 'test.db'));
  new Indexer(db, proj).indexProject();
});
afterAll(() => { db.close(); fs.rmSync(work, { recursive: true, force: true }); });

const group = (groups: RenameFileGroup[], p: string) => groups.find((g) => g.path === p);
const hasPos = (g: RenameFileGroup | undefined, line: number, col: number) =>
  !!g && g.occurrences.some((o) => o.line === line && o.col === col);

describe('getRenameTargets', () => {
  it('groups: 정의(a.ts, isDefinition:true) + 호출 참조(b.ts)', () => {
    const t = getRenameTargets(db, 'helper');
    const a = group(t.groups, 'a.ts');
    expect(a).toBeDefined();
    // a.ts의 정의 발생은 isDefinition:true
    expect(a!.occurrences.length).toBe(1);
    expect(a!.occurrences[0].isDefinition).toBe(true);
    expect(a!.occurrences[0].line).toBe(0);

    const b = group(t.groups, 'b.ts');
    expect(b).toBeDefined();
    // b.ts groups에는 호출 참조(line 1)가 있고 isDefinition:false
    expect(hasPos(b, 1, 30)).toBe(true);
    for (const o of b!.occurrences) expect(o.isDefinition).toBe(false);
    // alias 대입(line 2)의 bare helper는 groups에 없다
    expect(b!.occurrences.some((o) => o.line === 2)).toBe(false);
  });

  it('unconfirmed: alias 대입(b.ts line 2)이 포함되고 groups와 중복 없음', () => {
    const t = getRenameTargets(db, 'helper');
    const bU = group(t.unconfirmed, 'b.ts');
    expect(bU).toBeDefined();
    // alias 대입 발생 (line 2 col 14)
    expect(hasPos(bU, 2, 14)).toBe(true);
    // groups에 있는 호출 참조(line 1 col 30)는 unconfirmed에 없다
    expect(hasPos(bU, 1, 30)).toBe(false);

    // 전역 검증: unconfirmed와 groups는 (path,line,col)에서 서로소
    const gKeys = new Set<string>();
    for (const g of t.groups) for (const o of g.occurrences) gKeys.add(`${g.path}:${o.line}:${o.col}`);
    for (const g of t.unconfirmed)
      for (const o of g.occurrences) expect(gKeys.has(`${g.path}:${o.line}:${o.col}`)).toBe(false);
  });

  it('a.ts 정의 위치는 unconfirmed에 없다 (groups로 흡수)', () => {
    const t = getRenameTargets(db, 'helper');
    const aU = group(t.unconfirmed, 'a.ts');
    // a.ts의 유일한 helper는 정의(groups)이므로 unconfirmed 그룹 자체가 없어야 한다
    expect(aU).toBeUndefined();
  });
});
