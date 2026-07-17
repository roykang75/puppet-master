import { describe, it, expect, beforeEach } from 'vitest';
import { TerminalManager, PtyLike } from '../src/main/terminal/manager';
import type { SpawnSpec } from '../src/main/terminal/spawn-spec';

interface FakePty extends PtyLike {
  written: string[];
  resized: [number, number][];
  killed: boolean;
  emitData(d: string): void;
  emitExit(): void;
}

function makeFakePty(): FakePty {
  let dataCb: (d: string) => void = () => {};
  let exitCb: () => void = () => {};
  const fake: FakePty = {
    written: [],
    resized: [],
    killed: false,
    onData: (cb) => (dataCb = cb),
    onExit: (cb) => (exitCb = cb),
    write: (d) => fake.written.push(d),
    resize: (c, r) => fake.resized.push([c, r]),
    kill: () => (fake.killed = true),
    emitData: (d) => dataCb(d),
    emitExit: () => exitCb(),
  };
  return fake;
}

let ptys: FakePty[];
let specs: SpawnSpec[];
let events: { type: string; id: number; data?: string }[];
let mgr: TerminalManager;

beforeEach(() => {
  ptys = [];
  specs = [];
  events = [];
  mgr = new TerminalManager({
    cwd: '/proj',
    onData: (id, data) => events.push({ type: 'data', id, data }),
    onExit: (id) => events.push({ type: 'exit', id }),
    spawnFn: (spec) => {
      specs.push(spec);
      const p = makeFakePty();
      ptys.push(p);
      return p;
    },
  });
});

describe('TerminalManager', () => {
  it('spawn: 증가하는 id 발급 + 스폰 스펙(cwd/-l/TERM)', () => {
    const a = mgr.spawn();
    const b = mgr.spawn();
    expect(a).toEqual({ id: 1 });
    expect(b).toEqual({ id: 2 });
    expect(specs[0].cwd).toBe('/proj');
    expect(specs[0].args).toEqual(['-l']);
    expect(specs[0].env.TERM).toBe('xterm-256color');
  });

  it('input/resize/data가 id별로 라우팅', () => {
    mgr.spawn();
    mgr.spawn();
    mgr.input(2, 'ls\r');
    mgr.resize(1, 80, 24);
    expect(ptys[1].written).toEqual(['ls\r']);
    expect(ptys[0].resized).toEqual([[80, 24]]);
    ptys[0].emitData('out0');
    expect(events).toContainEqual({ type: 'data', id: 1, data: 'out0' });
  });

  it('kill: 해당 pty만 종료, 없는 id는 무시', () => {
    mgr.spawn();
    mgr.spawn();
    mgr.kill(1);
    expect(ptys[0].killed).toBe(true);
    expect(ptys[1].killed).toBe(false);
    mgr.kill(99); // no-op
    mgr.input(1, 'x'); // 제거된 id 무시
    expect(ptys[0].written).toEqual([]);
  });

  it('셸 자연 종료: onExit 콜백 + 엔트리 제거 (이후 input 무시)', () => {
    mgr.spawn();
    ptys[0].emitExit();
    expect(events).toContainEqual({ type: 'exit', id: 1 });
    mgr.input(1, 'x');
    expect(ptys[0].written).toEqual([]);
  });

  it('killAll: 전부 종료', () => {
    mgr.spawn();
    mgr.spawn();
    mgr.killAll();
    expect(ptys.every((p) => p.killed)).toBe(true);
  });

  it('spawnFn throw → {error} 반환 (앱 무영향)', () => {
    const failing = new TerminalManager({
      cwd: '/p',
      onData: () => {},
      onExit: () => {},
      spawnFn: () => {
        throw new Error('pty 로드 실패');
      },
    });
    const r = failing.spawn();
    expect('error' in r && r.error).toContain('pty 로드 실패');
  });
});
