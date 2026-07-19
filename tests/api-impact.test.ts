// Plan 22-D — 리뷰 센터 영향 배지. getImpactSummaries 배치 API + 영향도 정렬 순수 함수 검증.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Database } from 'better-sqlite3';
import { openDb } from '../src/indexer/db';
import { Indexer } from '../src/indexer/pipeline';
import { getImpactSummaries, type ImpactSummary } from '../src/indexer/api';
import { impactScore, sortSymbolsByImpact, sortFilesByImpact } from '../src/shared/review-impact';

let dir: string;
let db: Database;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-impact-'));
  db = openDb(path.join(dir, 'x.db'));
  const ix = new Indexer(db, dir);

  // hot: 콜러 5(위험 단계), target: 콜러 1(주의 단계), lonely: 콜러 0.
  ix.indexContent(
    'lib/util.ts',
    `export function target() {}
export function lonely() {}
export function hot() {}
export function c1() { hot(); }
export function c2() { hot(); }
export function c3() { hot(); }
export function c4() { hot(); }
export function c5() { hot(); }
export function midCaller() { target(); }`,
  );
  // 프론트 호출부(loadUser) ↔ 백엔드 핸들러(read_user) — API 연관.
  ix.indexContent('web/App.tsx', `export async function loadUser(id: string) { return fetch(\`/api/users/\${id}\`); }\n`);
  ix.indexContent('server/main.py', `\n@app.get("/api/users/{user_id}")\ndef read_user(user_id: int):\n    return user_id\n`);
  // ghost: 정의 없이 호출만 존재 — 삭제된 심볼이 아직 호출되는 상황.
  ix.indexContent('lib/orphan.ts', `export function keepCalling() { ghost(); }\n`);
});

afterAll(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('getImpactSummaries', () => {
  it('콜러 수와 topCallers(최대 3)를 반환', () => {
    const [hot] = getImpactSummaries(db, ['hot']);
    expect(hot.callers).toBe(5);
    expect(hot.topCallers).toHaveLength(3);
    expect(hot.endpoints).toBe(0);
    expect(hot.apiCalls).toBe(0);
  });
  it('콜러 1개 심볼: topCallers 1개(이름·경로 포함)', () => {
    const [target] = getImpactSummaries(db, ['target']);
    expect(target.callers).toBe(1);
    expect(target.topCallers).toEqual([{ name: 'midCaller', path: 'lib/util.ts', line: expect.any(Number) }]);
  });
  it('콜러 없는 심볼은 0 카운트', () => {
    const [lonely] = getImpactSummaries(db, ['lonely']);
    expect(lonely).toMatchObject({ callers: 0, endpoints: 0, apiCalls: 0 });
    expect(lonely.topCallers).toEqual([]);
  });
  it('엔드포인트 핸들러: endpoints>0', () => {
    const [ru] = getImpactSummaries(db, ['read_user']);
    expect(ru.endpoints).toBe(1);
    expect(ru.apiCalls).toBe(0);
  });
  it('매칭된 백엔드 호출을 가진 심볼: apiCalls>0', () => {
    const [lu] = getImpactSummaries(db, ['loadUser']);
    expect(lu.apiCalls).toBe(1);
    expect(lu.endpoints).toBe(0);
    expect(lu.callers).toBe(0);
  });
  it('삭제된(정의 없는) 이름도 콜러가 남아 있으면 callers>0', () => {
    const [ghost] = getImpactSummaries(db, ['ghost']);
    expect(ghost.callers).toBe(1);
    expect(ghost.topCallers[0]).toMatchObject({ name: 'keepCalling', path: 'lib/orphan.ts' });
  });
  it('배치: 입력 순서대로 요약을 반환', () => {
    const out = getImpactSummaries(db, ['hot', 'lonely']);
    expect(out.map((s) => s.name)).toEqual(['hot', 'lonely']);
  });
});

const mk = (name: string, callers: number, endpoints = 0, apiCalls = 0): ImpactSummary => ({
  name,
  callers,
  topCallers: [],
  endpoints,
  apiCalls,
});

describe('영향도 정렬 순수 함수', () => {
  it('impactScore = callers + endpoints + apiCalls, 미존재는 0', () => {
    expect(impactScore(mk('a', 2, 1, 3))).toBe(6);
    expect(impactScore(undefined)).toBe(0);
  });
  it('sortSymbolsByImpact: 영향도 내림차순, 동률은 기존 순서', () => {
    const impacts = new Map([
      ['a', mk('a', 1)],
      ['b', mk('b', 3)],
      ['c', mk('c', 0)],
      ['d', mk('d', 3)],
    ]);
    const order = sortSymbolsByImpact(
      [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }],
      impacts,
    ).map((s) => s.name);
    expect(order).toEqual(['b', 'd', 'a', 'c']); // b·d 동률(3) → 기존 순서 유지
  });
  it('sortFilesByImpact: 파일 내 최대 영향도 내림차순, 동률은 경로순', () => {
    const impacts = new Map([['x', mk('x', 5)], ['y', mk('y', 2)]]);
    const files = [
      { path: 'b.ts', symbols: [{ name: 'y' }] }, // max 2
      { path: 'a.ts', symbols: [{ name: 'x' }] }, // max 5
      { path: 'c.ts', symbols: [{ name: 'y' }] }, // max 2 (b와 동률 → 경로순 b < c)
    ];
    expect(sortFilesByImpact(files, impacts).map((f) => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});
