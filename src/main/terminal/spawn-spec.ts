// PTY 스폰 스펙 — 순수 함수. 유닉스는 로그인 셸(-l)로 패키지 앱(GUI PATH 미상속)에서도 CLI가 PATH에 잡힌다.
// Windows는 로그인 셸 개념이 없어 cmd.exe(ComSpec)를 -l 없이 띄운다.
export interface SpawnSpec {
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export function buildSpawnSpec(
  env: NodeJS.ProcessEnv,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): SpawnSpec {
  const baseEnv = { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  if (platform === 'win32') {
    return {
      file: env.ComSpec || 'cmd.exe',
      args: [], // cmd.exe/PowerShell엔 로그인 셸(-l) 개념이 없다
      cwd,
      env: baseEnv,
    };
  }
  return {
    file: env.SHELL || '/bin/zsh',
    args: ['-l'],
    cwd,
    env: baseEnv,
  };
}
