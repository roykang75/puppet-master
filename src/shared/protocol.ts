export const PROTOCOL_VERSION = 1;

export interface RpcRequest {
  id: number;
  method: string;
  params?: unknown;
}
export type RpcResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { message: string } };
export interface RpcEvent {
  event: string;
  payload?: unknown;
}
export type RpcMessage = RpcRequest | RpcResponse | RpcEvent;

// ── 메서드 파라미터 (인덱서 host가 구현, main이 릴레이) ──
// 결과 타입은 indexer/api.ts(SymbolHit/TextHit/CallerHit), pipeline.ts(IndexStats)를 재사용한다.
export interface OpenProjectParams { root: string; dbPath: string }
export interface FileParams { path: string }        // 프로젝트 루트 기준 rel ('/' 구분자)
export interface IndexBufferParams { path: string; content: string }
export interface SearchParams { query: string; limit?: number }
export interface NameParams { name: string }
export interface SymbolIdParams { symbolId: number }
export interface ResolveParams { name: string; fromPath: string }

// ── Smart Rename (0-기반 좌표) ──
export interface RenameOccurrence { line: number; col: number; isDefinition: boolean }
export interface RenameFileGroup { path: string; occurrences: RenameOccurrence[] }
export interface RenameTargets { groups: RenameFileGroup[]; unconfirmed: RenameFileGroup[] }
export interface RenameApplyResult {
  changedFiles: number;
  replaced: number;
  skipped: Array<{ path: string; line: number; col: number }>;
}

// ── 시맨틱 토큰 (getFileTokens) ──
export interface FileRefRow { name: string; kind: string; line: number; col: number }
// symbols는 indexer/api.ts의 SymbolHit[] (타입 전용 참조 — 런타임 순환 없음)
export interface FileTokens { symbols: import('../indexer/api').SymbolHit[]; refs: FileRefRow[] }

// ── 이벤트 페이로드 (인덱서 → UI) ──
export interface ReadyPayload { protocolVersion: number }
export interface IndexProgressPayload { done: number; total: number; file: string }
export interface FileIndexedPayload {
  path: string;
  source?: 'buffer' | 'disk'; // 생략 시 'disk'
}

// ── AI 설정 (main ↔ 렌더러) ──
// API 키는 절대 렌더러로 전달하지 않는다 — hasApiKey 불리언만 노출.
// 프로파일 = provider+모델+서버+키 세트. 활성 프로파일 하나를 완성/채팅이 공유한다.
export interface CompletionProfilePublic {
  id: string;
  name: string;
  provider: 'anthropic' | 'openai';
  model: string;
  baseURL?: string;
  hasApiKey: boolean;
}
// 저장 요청용 — apiKey undefined면 같은 id의 기존 키 유지, id 없으면 새 프로파일.
export interface CompletionProfileInput {
  id?: string;
  name: string;
  provider: 'anthropic' | 'openai';
  model: string;
  baseURL?: string;
  apiKey?: string;
}
export interface CompletionSettings {
  // 아래 4개는 활성 프로파일의 값 (없으면 provider 'none') — 기존 소비자 호환 유지
  provider: 'none' | 'anthropic' | 'openai';
  model: string;
  baseURL?: string;
  hasApiKey: boolean;
  profiles: CompletionProfilePublic[];
  activeId: string | null;
}

// ── AI 코드 자동완성 요청/응답 (커서 컨텍스트 → 완성 텍스트) ──
export interface CompletionContext {
  path: string;
  languageId: string;
  prefix: string;
  suffix: string;
}
export interface CompletionResult {
  text: string | null;
  error?: { kind: 'auth' | 'transient' | 'other' | 'unsuitable'; message: string };
}

// ── LSP (Plan 6) ── 좌표는 전부 0-기반 줄 / UTF-16 컬럼 (Monaco 경계에서만 +1)
export type LspLanguage = 'ts' | 'py';
export type LspServerState = 'starting' | 'running' | 'stopped';
export interface LspStatusN { lang: LspLanguage; state: LspServerState }
export interface LspCallParams { path: string; line: number; col: number } // path는 프로젝트 상대
export interface LspCompletionItemN {
  label: string;
  kind: number; // LSP CompletionItemKind (1~25) 그대로 — 렌더러가 Monaco enum으로 매핑
  insertText: string;
  isSnippet: boolean;
  detail?: string;
  sortText?: string;
}
export interface LspHoverN { markdown: string }
export interface LspLocationN { path: string; line: number; col: number }
export interface LspDiagnosticN {
  message: string;
  severity: 1 | 2 | 3 | 4; // LSP DiagnosticSeverity
  startLine: number; startCol: number; endLine: number; endCol: number;
}
export const LSP_EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescriptreact',
  '.js': 'javascript', '.jsx': 'javascriptreact', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python',
};

// ── AI 채팅 (Plan 8) ──
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ChatContext {
  path: string;
  languageId: string;
  code: string;
  isSelection: boolean;
  startLine: number; // 1-기반 (표시용)
  signatures: string[];
}
export type ChatEvent =
  | { type: 'chunk'; text: string }
  | { type: 'done' }
  | { type: 'error'; kind: 'auth' | 'transient' | 'other' };

// ── UI 지속 상태 (main persistence ↔ 렌더러) ──
export interface UiState {
  panelLayouts: Record<string, string>; // react-resizable-panels 직렬화 값 (불투명)
  openTabs: string[];
  activeTab: string | null;
}
