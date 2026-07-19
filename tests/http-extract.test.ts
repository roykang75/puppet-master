import { describe, it, expect } from 'vitest';
import { normalizeHttpPath, joinHttpPaths } from '../src/indexer/http';
import { extractFile } from '../src/indexer/extractor';
import { languageForPath } from '../src/indexer/languages';

const ts = languageForPath('x.ts')!;
const tsx = languageForPath('x.tsx')!;
const py = languageForPath('x.py')!;
const java = languageForPath('X.java')!;

describe('normalizeHttpPath', () => {
  it('파라미터 세그먼트({x}/[x]/:x/${}) → {}', () => {
    expect(normalizeHttpPath('/users/{id}')).toBe('/users/{}');
    expect(normalizeHttpPath('/a/[id]/b')).toBe('/a/{}/b');
    expect(normalizeHttpPath('/u/:id')).toBe('/u/{}');
  });
  it('스킴+호스트/쿼리 제거, 상대경로 선행 슬래시', () => {
    expect(normalizeHttpPath('https://api.x.com/v1/users?limit=2')).toBe('/v1/users');
    expect(normalizeHttpPath('api/x')).toBe('/api/x');
  });
  it('빈/루트', () => {
    expect(normalizeHttpPath('')).toBe('');
    expect(normalizeHttpPath('/')).toBe('/');
  });
});

describe('joinHttpPaths', () => {
  it('슬래시 정리', () => {
    expect(joinHttpPaths('/api', '/x')).toBe('/api/x');
    expect(joinHttpPaths('/api/', 'x')).toBe('/api/x');
    expect(joinHttpPaths('', '/x')).toBe('/x');
    expect(joinHttpPaths('/api', '')).toBe('/api');
  });
});

describe('TS/TSX 호출부 추출', () => {
  const src = `
import axios from 'axios';
const API_BASE = 'https://x.dev';
export async function loadUser(id: string) {
  const r = await fetch(\`/api/users/\${id}\`);
  await fetch('/api/items', { method: 'POST' });
  await axios.get('/api/list');
  await fetch(\`\${API_BASE}/orders\`);
  const u = getUrl();
  await fetch(u);
}
`;
  const { symbols, httpCalls } = extractFile(src, ts);
  it('fetch 템플릿/리터럴/axios.get + 베이스URL 치환 + unresolved', () => {
    const byRaw = new Map(httpCalls.map((c) => [c.rawPath, c]));
    expect(byRaw.get('/api/users/{}')).toMatchObject({ method: 'GET', path: '/api/users/{}' });
    expect(byRaw.get('/api/items')).toMatchObject({ method: 'POST', path: '/api/items' });
    expect(byRaw.get('/api/list')).toMatchObject({ method: 'GET', path: '/api/list' });
    expect(byRaw.get('{}/orders')).toMatchObject({ path: '/orders' }); // \${API_BASE} 선행 치환 제거
    // 완전 동적 → unresolved(path '')
    expect(httpCalls.some((c) => c.path === '')).toBe(true);
  });
  it('enclosing 심볼 연결 (loadUser)', () => {
    const call = httpCalls.find((c) => c.rawPath === '/api/users/{}')!;
    expect(call.enclosingIndex).not.toBeNull();
    expect(symbols[call.enclosingIndex!].name).toBe('loadUser');
  });
});

describe('Python 엔드포인트 추출 (FastAPI/Flask)', () => {
  const src = `
@app.get("/api/users/{user_id}")
def read_user(user_id: int):
    return user_id

@router.post("/api/items")
async def create_item():
    pass

@app.route("/legacy", methods=["POST", "PUT"])
def legacy():
    pass
`;
  const { symbols, endpoints } = extractFile(src, py);
  it('FastAPI get/post + Flask route(methods)', () => {
    const sig = endpoints.map((e) => `${e.method} ${e.path}`).sort();
    expect(sig).toEqual(['GET /api/users/{}', 'POST /api/items', 'POST /legacy', 'PUT /legacy']);
  });
  it('핸들러 심볼 연결', () => {
    const users = endpoints.find((e) => e.path === '/api/users/{}')!;
    expect(symbols[users.symbolIndex!].name).toBe('read_user');
  });
});

describe('Java 엔드포인트 추출 (Spring, 클래스 prefix)', () => {
  const src = `
@RestController
@RequestMapping("/api/orders")
public class OrderController {
  @GetMapping("/{id}")
  public Order getOrder(long id) { return null; }

  @PostMapping
  public Order create() { return null; }

  @RequestMapping(value = "/bulk", method = RequestMethod.DELETE)
  public void bulk() {}
}
`;
  const { symbols, endpoints } = extractFile(src, java);
  it('prefix 결합 + marker/args/RequestMethod', () => {
    const sig = endpoints.map((e) => `${e.method} ${e.path}`).sort();
    expect(sig).toEqual(['DELETE /api/orders/bulk', 'GET /api/orders/{}', 'POST /api/orders']);
  });
  it('핸들러 메서드 심볼 연결', () => {
    const get = endpoints.find((e) => e.path === '/api/orders/{}')!;
    expect(symbols[get.symbolIndex!].name).toBe('getOrder');
  });
});

describe('Next.js 파일 기반 라우트', () => {
  it('app 라우터: route.ts + export function GET, [param]/{group} 처리', () => {
    const src = `export async function GET() { return new Response('ok'); }\nexport async function POST() { return new Response('ok'); }\n`;
    const { endpoints } = extractFile(src, ts, 'src/app/api/users/[id]/route.ts');
    const sig = endpoints.map((e) => `${e.method} ${e.path}`).sort();
    expect(sig).toEqual(['GET /api/users/{}', 'POST /api/users/{}']);
  });
  it('(group) 세그먼트 제외', () => {
    const src = `export function GET() {}\n`;
    const { endpoints } = extractFile(src, ts, 'app/(admin)/api/stats/route.ts');
    expect(endpoints[0]).toMatchObject({ method: 'GET', path: '/api/stats' });
  });
  it('pages/api: 파일 경로 → 경로, method *', () => {
    const src = `export default function handler(req, res) { res.end(); }\n`;
    const { symbols, endpoints } = extractFile(src, ts, 'pages/api/hello/[slug].ts');
    expect(endpoints[0]).toMatchObject({ method: '*', path: '/api/hello/{}' });
    expect(symbols[endpoints[0].symbolIndex!].name).toBe('handler');
  });
  it('route.ts 아니면 미추출', () => {
    const src = `export function GET() {}\n`;
    const { endpoints } = extractFile(src, tsx, 'src/components/Button.tsx');
    expect(endpoints).toEqual([]);
  });
});
