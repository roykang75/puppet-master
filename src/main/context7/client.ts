// Context7 API v2 클라이언트 — electron-free(전역 fetch), fetchImpl 주입으로 테스트.
export const BASE = 'https://context7.com/api/v2';
export const DOCS_CAP = 12 * 1024; // 스니펫 응답 절단

export class RateLimitError extends Error {
  constructor() { super('rate limited'); this.name = 'RateLimitError'; }
}
export class Context7Error extends Error {
  constructor(msg: string) { super(msg); this.name = 'Context7Error'; }
}

function headers(apiKey: string | null): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function getJson(url: string, apiKey: string | null, fetchImpl: typeof fetch): Promise<any> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: headers(apiKey) });
  } catch (e) {
    throw new Context7Error(e instanceof Error ? e.message : 'network');
  }
  if (res.status === 429) throw new RateLimitError();
  if (!res.ok) throw new Context7Error(`http ${res.status}`);
  return res.json();
}

/** 라이브러리명을 Context7 id로 해석 (최적=첫 매치). 없으면 null. */
export async function searchLibrary(
  name: string, query: string, apiKey: string | null, fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = `${BASE}/libs/search?libraryName=${encodeURIComponent(name)}&query=${encodeURIComponent(query)}`;
  const body = await getJson(url, apiKey, fetchImpl);
  const results = (body?.results ?? body?.libraries ?? []) as { id?: string }[];
  return results[0]?.id ?? null;
}

/** 라이브러리 문서(질의 기반 스니펫)를 텍스트로. 상한 절단. */
export async function getDocs(
  libraryId: string, query: string, apiKey: string | null, fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = `${BASE}/context?libraryId=${encodeURIComponent(libraryId)}&query=${encodeURIComponent(query)}&type=json`;
  const body = await getJson(url, apiKey, fetchImpl);
  const snippets = (body?.snippets ?? []) as { code?: string; description?: string }[];
  const text = snippets
    .map((s) => [s.description, s.code].filter(Boolean).join('\n'))
    .join('\n\n')
    || (typeof body === 'string' ? body : JSON.stringify(body));
  return text.length > DOCS_CAP ? text.slice(0, DOCS_CAP) + '\n…(잘림)' : text;
}
