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
export interface SearchParams { query: string; limit?: number }
export interface NameParams { name: string }
export interface SymbolIdParams { symbolId: number }

// ── 이벤트 페이로드 (인덱서 → UI) ──
export interface ReadyPayload { protocolVersion: number }
export interface IndexProgressPayload { done: number; total: number; file: string }
export interface FileIndexedPayload { path: string }

// ── UI 지속 상태 (main persistence ↔ 렌더러) ──
export interface UiState {
  panelLayouts: Record<string, string>; // react-resizable-panels 직렬화 값 (불투명)
  openTabs: string[];
  activeTab: string | null;
}
