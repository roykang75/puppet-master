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

// ── AI 코드 자동완성 설정 (main safeStorage ↔ 렌더러) ──
// API 키는 절대 렌더러로 전달하지 않는다 — hasApiKey 불리언만 노출.
export interface CompletionSettings {
  provider: 'none' | 'anthropic' | 'openai';
  model: string;
  baseURL?: string;
  hasApiKey: boolean;
}

// ── UI 지속 상태 (main persistence ↔ 렌더러) ──
export interface UiState {
  panelLayouts: Record<string, string>; // react-resizable-panels 직렬화 값 (불투명)
  openTabs: string[];
  activeTab: string | null;
}
