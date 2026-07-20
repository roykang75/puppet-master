// 크로스 플랫폼 dev electron 실행 래퍼.
//   기존 npm 스크립트의 `VITE_DEV_SERVER_URL=... electron .`는 POSIX 전용이라
//   Windows(cmd/powershell)에서 "'VITE_DEV_SERVER_URL' is not recognized"로 깨진다.
//   env를 process에서 직접 설정하고 electron을 실행한다.
// 호스트는 127.0.0.1 고정 — vite가 ::1(IPv6)에만 바인딩하면 wait-on(IPv4)이 영영 풀리지
// 않으므로 dev:renderer도 --host 127.0.0.1로 맞춰둔다.
const { spawnSync } = require('child_process');
const path = require('path');

const url = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
const bin = process.platform === 'win32' ? 'electron.cmd' : 'electron';

const res = spawnSync(path.join('node_modules', '.bin', bin), ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
  shell: process.platform === 'win32',
});
process.exit(res.status === null ? 1 : res.status);
