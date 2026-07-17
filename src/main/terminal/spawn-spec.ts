// PTY 스폰 스펙 — 순수 함수. 로그인 셸(-l)로 패키지 앱(GUI PATH 미상속)에서도 CLI가 PATH에 잡힌다.
export interface SpawnSpec {
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export function buildSpawnSpec(env: NodeJS.ProcessEnv, cwd: string): SpawnSpec {
  return {
    file: env.SHELL || '/bin/zsh',
    args: ['-l'],
    cwd,
    env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  };
}
