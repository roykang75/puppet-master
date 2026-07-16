// Electron utilityProcess에서 실행된다. probe.ts와 동일하게 process.parentPort로 통신.
import { startIndexerHost } from './host-core';
import type { RpcMessage } from '../shared/protocol';

const port = process.parentPort;
startIndexerHost({
  post: (msg) => port.postMessage(msg),
  onMessage: (cb) => port.on('message', (e: Electron.MessageEvent) => cb(e.data as RpcMessage)),
});
