// v3 S1 데이터 레벨 실증 — 미니 풀스택 픽스처(React/Next ↔ FastAPI/Spring)를 실제 인덱싱하고
// 프론트 호출부 ↔ 백엔드 핸들러 매칭이 양방향으로 성립함을 검증한다.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Database } from 'better-sqlite3';
import { openDb } from '../src/indexer/db';
import { Indexer } from '../src/indexer/pipeline';
import {
  getEndpoints, getHttpCalls, matchCallToEndpoints, matchEndpointToCalls, getImpact, getFlowForFile,
} from '../src/indexer/api';

let dir: string;
let db: Database;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-http-'));
  db = openDb(path.join(dir, 'x.db'));
  const ix = new Indexer(db, dir);

  ix.indexContent(
    'web/src/App.tsx',
    `
import axios from 'axios';
export async function loadUser(id: string) {
  return fetch(\`/api/users/\${id}\`);
}
export async function loadOrder(oid: string) {
  return axios.get(\`/api/orders/\${oid}\`);
}
export async function checkHealth() {
  return fetch('/api/health');
}
export async function dynamicCall(u: string) {
  return fetch(u);
}
`,
  );
  ix.indexContent(
    'server/main.py',
    `
@app.get("/api/users/{user_id}")
def read_user(user_id: int):
    return user_id
`,
  );
  ix.indexContent(
    'server/OrderController.java',
    `
@RestController
@RequestMapping("/api/orders")
public class OrderController {
  @GetMapping("/{id}")
  public Order getOrder(long id) { return null; }
}
`,
  );
  ix.indexContent('web/app/api/health/route.ts', `export async function GET() { return new Response('ok'); }\n`);
  ix.indexContent(
    'lib/util.ts',
    `export function target() {}\nexport function midCaller() { target(); }\nexport function topCaller() { midCaller(); }\n`,
  );
});

afterAll(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('S1: 프론트 호출부 → 백엔드 핸들러 (데이터 레벨)', () => {
  it('fetch 템플릿 → FastAPI 핸들러(read_user)', () => {
    const call = getHttpCalls(db).find((c) => c.path === '/api/users/{}')!;
    expect(call.enclosingName).toBe('loadUser');
    const eps = matchCallToEndpoints(db, call.id);
    expect(eps).toHaveLength(1);
    expect(eps[0]).toMatchObject({ method: 'GET', file: 'server/main.py', handlerName: 'read_user' });
  });

  it('axios.get → Spring 핸들러(getOrder, 클래스 prefix 결합)', () => {
    const call = getHttpCalls(db).find((c) => c.path === '/api/orders/{}')!;
    const eps = matchCallToEndpoints(db, call.id);
    expect(eps).toHaveLength(1);
    expect(eps[0]).toMatchObject({ file: 'server/OrderController.java', handlerName: 'getOrder' });
  });

  it('fetch → Next.js app 라우트(GET /api/health)', () => {
    const call = getHttpCalls(db).find((c) => c.path === '/api/health')!;
    const eps = matchCallToEndpoints(db, call.id);
    expect(eps).toHaveLength(1);
    expect(eps[0]).toMatchObject({ method: 'GET', file: 'web/app/api/health/route.ts' });
  });
});

describe('S2: 역방향 — 엔드포인트 → 호출부', () => {
  it('FastAPI users 엔드포인트 → loadUser 호출부', () => {
    const ep = getEndpoints(db).find((e) => e.path === '/api/users/{}')!;
    const calls = matchEndpointToCalls(db, ep.id);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ file: 'web/src/App.tsx', enclosingName: 'loadUser' });
  });
});

describe('unresolved 정직성', () => {
  it('동적 URL은 path=\'\'로 기록되고 어떤 것도 매칭하지 않음', () => {
    const dyn = getHttpCalls(db).find((c) => c.enclosingName === 'dynamicCall')!;
    expect(dyn.path).toBe('');
    expect(matchCallToEndpoints(db, dyn.id)).toEqual([]);
  });
});

describe('getImpact (blast radius)', () => {
  it('전이적 callers: depth1=midCaller, depth2=topCaller', () => {
    const impact = getImpact(db, 'target', 2);
    expect(impact.map((h) => `${h.name}@${h.depth}`).sort()).toEqual(['midCaller@1', 'topCaller@2']);
  });
  it('depth=1은 직접 호출자만', () => {
    expect(getImpact(db, 'target', 1).map((h) => h.name)).toEqual(['midCaller']);
  });
});

describe('getFlowForFile (Flow 탭 단일 왕복)', () => {
  it('프론트 파일: 호출부 4 + 매칭 임베드', () => {
    const flow = getFlowForFile(db, 'web/src/App.tsx');
    expect(flow.calls).toHaveLength(4);
    const users = flow.calls.find((c) => c.path === '/api/users/{}')!;
    expect(users.endpoints[0]).toMatchObject({ handlerName: 'read_user', file: 'server/main.py' });
    const dyn = flow.calls.find((c) => c.path === '')!;
    expect(dyn.endpoints).toEqual([]); // unresolved는 매칭 시도 안 함
  });
  it('백엔드 파일: 엔드포인트 + 역방향 호출부 임베드', () => {
    const flow = getFlowForFile(db, 'server/main.py');
    expect(flow.endpoints).toHaveLength(1);
    expect(flow.endpoints[0].calls[0]).toMatchObject({ enclosingName: 'loadUser', file: 'web/src/App.tsx' });
  });
});

describe('재인덱싱 정합', () => {
  it('파일 갱신 시 이전 endpoints/http_calls 대체 (누적 없음)', () => {
    const ix = new Indexer(db, dir);
    ix.indexContent('server/main.py', `\n@app.get("/api/users/{user_id}/v2")\ndef read_user(user_id: int):\n    return user_id\n`);
    const eps = getEndpoints(db).filter((e) => e.file === 'server/main.py');
    expect(eps).toHaveLength(1);
    expect(eps[0].path).toBe('/api/users/{}/v2');
  });
});
