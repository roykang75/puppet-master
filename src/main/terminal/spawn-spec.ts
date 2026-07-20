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
  const baseEnv: NodeJS.ProcessEnv = { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  // 통합 터미널은 항상 컬러 — TERM/COLORTERM으로 색을 요구해 놓고 부모의 색상 억제를
  // 물려받으면 모순이다. 앱을 NO_COLOR가 설정된 셸에서 띄우면 pty 안의 CLI가 전부 흑백이 된다.
  delete baseEnv.NO_COLOR;
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
