// Context7 서비스 — 세션 인메모리 캐시 + 키 결합. 실패는 안내 문자열 반환(예외 미전파).
import { searchLibrary, getDocs, RateLimitError } from './client';

export class Context7Service {
  private idCache = new Map<string, string | null>();     // library → id(or null)
  private docCache = new Map<string, string>();           // `${id}\n${query}` → docs
  private readonly getApiKey: () => string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: { getApiKey: () => string | null; fetchImpl?: typeof fetch }) {
    this.getApiKey = deps.getApiKey;
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  async libraryDocs(library: string, query: string): Promise<string> {
    const key = this.getApiKey();
    try {
      let id = this.idCache.get(library);
      if (id === undefined) {
        id = await searchLibrary(library, query, key, this.fetchImpl);
        this.idCache.set(library, id);
      }
      if (!id) return `'${library}' 라이브러리를 Context7에서 찾지 못했습니다.`;
      const dk = `${id}\n${query.trim().toLowerCase()}`;
      const cached = this.docCache.get(dk);
      if (cached !== undefined) return cached;
      const docs = await getDocs(id, query, key, this.fetchImpl);
      this.docCache.set(dk, docs);
      return docs;
    } catch (e) {
      if (e instanceof RateLimitError) {
        return key
          ? 'Context7 요청 제한에 도달했습니다. 잠시 후 다시 시도하세요.'
          : 'Context7 요청 제한(키 없음)에 도달했습니다. 설정에서 API 키를 등록하면 완화됩니다.';
      }
      return `Context7 문서를 가져오지 못했습니다: ${e instanceof Error ? e.message : '오류'}`;
    }
  }
}
