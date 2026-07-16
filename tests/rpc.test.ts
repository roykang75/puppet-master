import { describe, it, expect } from 'vitest';
import { createRpcClient, createRpcServer, Transport } from '../src/shared/rpc';
import { RpcMessage } from '../src/shared/protocol';

function makePair(): { client: Transport; server: Transport } {
  const toServer: Array<(m: RpcMessage) => void> = [];
  const toClient: Array<(m: RpcMessage) => void> = [];
  return {
    client: {
      post: (m) => queueMicrotask(() => toServer.forEach((cb) => cb(m))),
      onMessage: (cb) => toClient.push(cb),
    },
    server: {
      post: (m) => queueMicrotask(() => toClient.forEach((cb) => cb(m))),
      onMessage: (cb) => toServer.push(cb),
    },
  };
}

describe('rpc', () => {
  it('요청/응답 왕복', async () => {
    const { client, server } = makePair();
    const rpc = createRpcClient(client);
    createRpcServer(server, { add: (p: { a: number; b: number }) => p.a + p.b });
    expect(await rpc.request<number>('add', { a: 2, b: 3 })).toBe(5);
  });

  it('핸들러 예외는 error 응답으로 전파', async () => {
    const { client, server } = makePair();
    const rpc = createRpcClient(client);
    createRpcServer(server, { boom: () => { throw new Error('폭발'); } });
    await expect(rpc.request('boom')).rejects.toThrow('폭발');
  });

  it('미지의 메서드는 거부', async () => {
    const { client, server } = makePair();
    const rpc = createRpcClient(client);
    createRpcServer(server, {});
    await expect(rpc.request('nope')).rejects.toThrow('unknown method');
  });

  it('동시 요청이 id로 올바르게 매칭된다', async () => {
    const { client, server } = makePair();
    const rpc = createRpcClient(client);
    createRpcServer(server, {
      slow: () => new Promise((r) => setTimeout(() => r('slow'), 50)),
      fast: () => 'fast',
    });
    const [a, b] = await Promise.all([rpc.request('slow'), rpc.request('fast')]);
    expect(a).toBe('slow');
    expect(b).toBe('fast');
  });

  it('타임아웃 시 해당 요청만 거부', async () => {
    const { client, server } = makePair();
    const rpc = createRpcClient(client);
    createRpcServer(server, { never: () => new Promise(() => {}) });
    await expect(rpc.request('never', undefined, { timeoutMs: 50 })).rejects.toThrow('RPC timeout');
  });

  it('서버 이벤트가 클라이언트로 전달된다', async () => {
    const { client, server } = makePair();
    const rpc = createRpcClient(client);
    const srv = createRpcServer(server, {});
    const got = new Promise((r) => rpc.onEvent((event, payload) => r({ event, payload })));
    srv.emit('progress', { done: 1 });
    expect(await got).toEqual({ event: 'progress', payload: { done: 1 } });
  });
});
