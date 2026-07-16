import { RpcMessage } from './protocol';

export interface Transport {
  post(msg: RpcMessage): void;
  onMessage(cb: (msg: RpcMessage) => void): void;
}

export interface RpcClient {
  request<T>(method: string, params?: unknown, opts?: { timeoutMs?: number }): Promise<T>;
  onEvent(cb: (event: string, payload: unknown) => void): void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function createRpcClient(transport: Transport): RpcClient {
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  const eventCbs: Array<(event: string, payload: unknown) => void> = [];

  transport.onMessage((msg) => {
    if ('event' in msg) {
      for (const cb of eventCbs) cb(msg.event, msg.payload);
      return;
    }
    if ('ok' in msg) {
      const p = pending.get(msg.id);
      if (!p) return; // 타임아웃 후 늦게 도착한 응답
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error.message));
    }
  });

  return {
    request<T>(method: string, params?: unknown, opts?: { timeoutMs?: number }): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }, opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
        transport.post({ id, method, params });
      });
    },
    onEvent(cb) {
      eventCbs.push(cb);
    },
  };
}

export function createRpcServer(
  transport: Transport,
  handlers: Record<string, (params: any) => unknown | Promise<unknown>>,
): { emit(event: string, payload?: unknown): void } {
  transport.onMessage((msg) => {
    if (!('method' in msg)) return;
    const { id, method, params } = msg;
    const handler = handlers[method];
    if (!handler) {
      transport.post({ id, ok: false, error: { message: `unknown method: ${method}` } });
      return;
    }
    void (async () => {
      try {
        const result = await handler(params);
        transport.post({ id, ok: true, result });
      } catch (e) {
        transport.post({ id, ok: false, error: { message: e instanceof Error ? e.message : String(e) } });
      }
    })();
  });
  return { emit: (event, payload) => transport.post({ event, payload }) };
}
