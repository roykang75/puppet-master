import { describe, it, expect } from 'vitest';
import { buildSpawnSpec } from '../src/main/terminal/spawn-spec';

describe('buildSpawnSpec', () => {
  it('SHELL 환경변수 사용 + 로그인 플래그 + TERM 주입 (darwin)', () => {
    const spec = buildSpawnSpec({ SHELL: '/bin/bash', PATH: '/usr/bin' }, '/proj', 'darwin');
    expect(spec.file).toBe('/bin/bash');
    expect(spec.args).toEqual(['-l']);
    expect(spec.cwd).toBe('/proj');
    expect(spec.env.TERM).toBe('xterm-256color');
    expect(spec.env.COLORTERM).toBe('truecolor');
    expect(spec.env.PATH).toBe('/usr/bin'); // 기존 env 보존
  });

  it('SHELL 없으면 /bin/zsh 폴백 (darwin)', () => {
    expect(buildSpawnSpec({}, '/p', 'darwin').file).toBe('/bin/zsh');
  });

  it('Windows는 ComSpec(cmd.exe)을 -l 없이 사용', () => {
    const spec = buildSpawnSpec(
      { ComSpec: 'C:\\Windows\\System32\\cmd.exe', SHELL: '/bin/zsh' },
      'C:\\proj',
      'win32',
    );
    expect(spec.file).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(spec.args).toEqual([]); // 로그인 셸 플래그 없음
    expect(spec.cwd).toBe('C:\\proj');
    expect(spec.env.TERM).toBe('xterm-256color');
  });

  it('Windows에서 ComSpec 없으면 cmd.exe 폴백', () => {
    expect(buildSpawnSpec({}, 'C:\\p', 'win32').file).toBe('cmd.exe');
  });
});
