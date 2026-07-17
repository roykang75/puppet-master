import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TerminalManager } from '../src/main/terminal/manager';

let mgr: TerminalManager | null = null;

afterEach(() => {
  mgr?.killAll();
  mgr = null;
});

const waitFor = async (cond: () => boolean, ms: number): Promise<void> => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  if (!cond()) throw new Error('waitFor 타임아웃');
};

describe('TerminalManager 실 PTY 왕복', () => {
  it('로그인 셸 스폰 → echo 왕복 → resize → kill', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'si-term-'));
    let output = '';
    const exits: number[] = [];
    mgr = new TerminalManager({
      cwd,
      onData: (_id, data) => (output += data),
      onExit: (id) => exits.push(id),
    });
    const r = mgr.spawn();
    expect('id' in r).toBe(true);
    const id = (r as { id: number }).id;

    // 프롬프트가 뜰 시간을 기다린 뒤 echo — 마커 문자열로 프롬프트 노이즈와 구분
    await waitFor(() => output.length > 0, 15_000);
    mgr.input(id, 'echo SI_PTY_$((1+1))\r');
    await waitFor(() => output.includes('SI_PTY_2'), 15_000);

    mgr.resize(id, 120, 40); // 예외 없이 수행되면 OK
    mgr.input(id, 'exit\r');
    await waitFor(() => exits.includes(id), 15_000);
    fs.rmSync(cwd, { recursive: true, force: true });
  }, 60_000);

  it('cwd가 프로젝트 루트를 향한다 (pwd 확인)', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'si-term-cwd-'));
    const real = fs.realpathSync(cwd); // macOS /tmp 심링크 보정
    let output = '';
    mgr = new TerminalManager({ cwd, onData: (_i, d) => (output += d), onExit: () => {} });
    const { id } = mgr.spawn() as { id: number };
    await waitFor(() => output.length > 0, 15_000);
    mgr.input(id, 'pwd\r');
    await waitFor(() => output.includes(real) || output.includes(cwd), 15_000);
    mgr.kill(id);
    fs.rmSync(cwd, { recursive: true, force: true });
  }, 60_000);
});
