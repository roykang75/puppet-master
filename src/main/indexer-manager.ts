import { utilityProcess, UtilityProcess } from 'electron';
import * as path from 'path';
import { createRpcClient, RpcClient } from '../shared/rpc';
import { PROTOCOL_VERSION, ReadyPayload, RpcMessage } from '../shared/protocol';

export interface IndexerManager {
  rpc: RpcClient;
  whenReady: Promise<void>;
  onExit(cb: (code: number) => void): void;
  kill(): void;
}

export function spawnIndexer(): IndexerManager {
  const proc: UtilityProcess = utilityProcess.fork(path.join(__dirname, '..', 'indexer', 'host.js'));
  const rpc = createRpcClient({
    post: (m) => proc.postMessage(m),
    onMessage: (cb) => proc.on('message', (m) => cb(m as RpcMessage)),
  });
  let settled = false;
  let rejectReady: ((e: Error) => void) | null = null;
  // 핸드셰이크 안전장치 — ready도 exit도 오지 않는 무응답(사일런트 스폰 실패 등)까지 에러로 전환.
  // 이게 없으면 openProject를 await하던 IPC 핸들러가 영원히 멈춰 "reply was never sent"가 뜬다.
  const HANDSHAKE_TIMEOUT_MS = 30_000;
  let timer: NodeJS.Timeout | null = null;
  const whenReady = new Promise<void>((resolve, reject) => {
    rejectReady = reject;
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`인덱서 준비 시간 초과 (${HANDSHAKE_TIMEOUT_MS / 1000}s) — 프로세스가 응답하지 않습니다.`));
    }, HANDSHAKE_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
    rpc.onEvent((event, payload) => {
      if (event !== 'ready' || settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const v = (payload as ReadyPayload).protocolVersion;
      if (v === PROTOCOL_VERSION) resolve();
      else reject(new Error(`인덱서 프로토콜 버전 불일치: UI=${PROTOCOL_VERSION}, indexer=${v}`));
    });
  });
  const exitCbs: Array<(code: number) => void> = [];
  proc.on('exit', (code) => {
    // ready 전에 종료 = 시작 크래시(네이티브 모듈 .node 로드 실패 등) → whenReady를 매달지 말고 reject.
    if (!settled) {
      settled = true;
      if (timer) clearTimeout(timer);
      rejectReady?.(
        new Error(
          `인덱서 프로세스가 시작 중 종료되었습니다 (code ${code}). ` +
            `네이티브 모듈(better-sqlite3/tree-sitter) 로드 실패 가능성이 높습니다.`,
        ),
      );
    }
    exitCbs.forEach((cb) => cb(code));
  });
  return {
    rpc,
    whenReady,
    onExit: (cb) => exitCbs.push(cb),
    kill: () => void proc.kill(),
  };
}
