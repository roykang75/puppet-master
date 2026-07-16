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
  const whenReady = new Promise<void>((resolve, reject) => {
    rpc.onEvent((event, payload) => {
      if (event !== 'ready') return;
      const v = (payload as ReadyPayload).protocolVersion;
      if (v === PROTOCOL_VERSION) resolve();
      else reject(new Error(`인덱서 프로토콜 버전 불일치: UI=${PROTOCOL_VERSION}, indexer=${v}`));
    });
  });
  const exitCbs: Array<(code: number) => void> = [];
  proc.on('exit', (code) => exitCbs.forEach((cb) => cb(code)));
  return {
    rpc,
    whenReady,
    onExit: (cb) => exitCbs.push(cb),
    kill: () => void proc.kill(),
  };
}
