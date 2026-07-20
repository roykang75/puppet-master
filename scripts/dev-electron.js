// 크로스 플랫폼 dev electron 실행 래퍼.
//   기존 npm 스크립트의 `VITE_DEV_SERVER_URL=... electron .`는 POSIX 전용이라
//   Windows(cmd/powershell)에서 "'VITE_DEV_SERVER_URL' is not recognized"로 깨진다.
//   env를 process에서 직접 설정하고 electron을 실행한다.
// 호스트는 127.0.0.1 고정 — vite가 ::1(IPv6)에만 바인딩하면 wait-on(IPv4)이 영영 풀리지
// 않으므로 dev:renderer도 --host 127.0.0.1로 맞춰둔다.
// electron 바이너리는 node_modules/.bin의 셸 래퍼(win32에선 .cmd) 대신 require('electron')이
// 주는 실행 파일 경로를 쓴다 — 중간 프로세스 계층을 없애 종료 시그널이 electron에 직접 닿게 한다.
// spawnSync는 시그널을 자식에게 넘길 수단이 없어, POSIX에서 concurrently -k가 SIGTERM을 보내면
// 래퍼만 죽고 electron이 남을 수 있다. win32는 실제 시그널이 없어 아래 전달이 무동작이다.
const { spawn } = require('child_process');
const electronPath = require('electron');

const url = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

// 래퍼가 받은 종료 시그널을 electron에 그대로 넘긴다(고아 방지).
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
for (const sig of SIGNALS) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
}

child.on('error', (err) => {
  console.error(`[dev-electron] electron 실행 실패: ${err.message}`);
  process.exit(1);
});

// 자식의 종료 상태를 그대로 반영한다 — concurrently가 종료 사유를 올바로 보도록.
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code === null ? 1 : code);
});
