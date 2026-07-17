import { describe, it, expect } from 'vitest';
import { buildSpawnSpec } from '../src/main/terminal/spawn-spec';

describe('buildSpawnSpec', () => {
  it('SHELL 환경변수 사용 + 로그인 플래그 + TERM 주입', () => {
    const spec = buildSpawnSpec({ SHELL: '/bin/bash', PATH: '/usr/bin' }, '/proj');
    expect(spec.file).toBe('/bin/bash');
    expect(spec.args).toEqual(['-l']);
    expect(spec.cwd).toBe('/proj');
    expect(spec.env.TERM).toBe('xterm-256color');
    expect(spec.env.COLORTERM).toBe('truecolor');
    expect(spec.env.PATH).toBe('/usr/bin'); // 기존 env 보존
  });

  it('SHELL 없으면 /bin/zsh 폴백', () => {
    expect(buildSpawnSpec({}, '/p').file).toBe('/bin/zsh');
  });
});
