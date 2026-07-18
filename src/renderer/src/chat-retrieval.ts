// 자동 검색 시드 — 사용자가 파일을 지정하지 않아도 질문과 관련된 코드를 인덱서에서 찾아 첨부한다.
// 순수 로직(extractSearchTerms/buildRetrieved)과 IPC 호출(retrieveSnippets)을 분리해 테스트한다.
import type { RetrievedSnippet } from '../../shared/protocol';
import type { SymbolHit, TextHit } from '../../indexer/api';

export const MAX_RETRIEVED_SYMBOLS = 5;
export const MAX_RETRIEVED_TEXTS = 5;
export const MAX_RETRIEVED_TOTAL = 8;

// 검색 신호가 약한 매우 흔한 토큰 — 제거해 관련도를 높인다.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'how', 'what', 'why', 'where', 'when',
  'function', 'const', 'let', 'var', 'return', 'class', 'import', 'export', 'async', 'await',
  '어떻게', '무엇', '어디', '코드', '파일', '구현', '알려', '보여', '해줘', '있어', '없어',
]);

/** 질문에서 검색어 후보를 뽑는다 — 식별자스러운 3자 이상 토큰, 불용어 제거, 길이순 상위 6개. */
export function extractSearchTerms(question: string): string[] {
  const raw = question.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const t of raw) {
    const key = t.toLowerCase();
    if (STOPWORDS.has(key) || seen.has(key)) continue;
    seen.add(key);
    terms.push(t);
  }
  // 길게(=구체적) 매칭되는 식별자 우선
  terms.sort((a, b) => b.length - a.length);
  return terms.slice(0, 6);
}

/** 심볼/텍스트 검색 결과를 병합·중복 제거·상한 적용해 RetrievedSnippet[]로 만든다. activePath는 이미 컨텍스트에 있으므로 제외. */
export function buildRetrieved(symbols: SymbolHit[], texts: TextHit[], activePath?: string): RetrievedSnippet[] {
  const out: RetrievedSnippet[] = [];
  const usedPaths = new Set<string>();
  for (const s of symbols.slice(0, MAX_RETRIEVED_SYMBOLS)) {
    if (s.path === activePath) continue;
    out.push({
      path: s.path,
      line: (s.nameLine ?? s.line) + 1, // 0-기반 → 1-기반 표시
      signature: s.signature || s.name,
      snippet: s.signature || s.name,
    });
    usedPaths.add(s.path);
  }
  for (const t of texts.slice(0, MAX_RETRIEVED_TEXTS)) {
    if (out.length >= MAX_RETRIEVED_TOTAL) break;
    if (t.path === activePath || usedPaths.has(t.path)) continue; // 심볼로 이미 다룬 파일 스킵
    out.push({ path: t.path, snippet: t.snippet });
    usedPaths.add(t.path);
  }
  return out.slice(0, MAX_RETRIEVED_TOTAL);
}

/** 질문으로 인덱서(FTS+심볼)를 조회해 관련 스니펫을 모은다. 인덱서 미기동/오류 시 빈 배열. */
export async function retrieveSnippets(question: string, activePath?: string): Promise<RetrievedSnippet[]> {
  const terms = extractSearchTerms(question);
  if (terms.length === 0) return [];
  const query = terms.join(' ');
  const [symbols, texts] = await Promise.all([
    window.si.searchSymbols(query).catch(() => [] as SymbolHit[]),
    window.si.searchText(query).catch(() => [] as TextHit[]),
  ]);
  return buildRetrieved(symbols, texts, activePath);
}
