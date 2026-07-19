// 크로스 플랫폼 electron ABI 재빌드 래퍼.
//   기존 npm 스크립트의 `CXXFLAGS=-std=c++20 electron-rebuild ...`는 POSIX 전용이라
//   Windows CI(cmd/powershell)에서 깨진다. process.platform에 따라 env를 설정하고
//   electron-rebuild를 실행한 뒤 ABI 마커를 electron으로 갱신한다.
// tree-sitter류는 C++20을 요구 — POSIX는 CXXFLAGS, MSVC(win32)는 CL=/std:c++20로 전달.
const { spawnSync } = require('child_process');
const path = require('path');

const MODULES = [
  'tree-sitter',
  'tree-sitter-c',
  'tree-sitter-cpp',
  'tree-sitter-python',
  'tree-sitter-typescript',
  'tree-sitter-java',
  'better-sqlite3',
  'node-pty',
];

const env = { ...process.env };
if (process.platform === 'win32') {
  // MSVC는 CXXFLAGS를 무시 — C++20은 CL 환경변수로 주입한다.
  env.CL = [env.CL, '/std:c++20'].filter(Boolean).join(' ');
} else {
  env.CXXFLAGS = [env.CXXFLAGS, '-std=c++20'].filter(Boolean).join(' ');
}

const bin = process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild';
const rebuild = spawnSync(
  path.join('node_modules', '.bin', bin),
  ['-f', '-w', MODULES.join(',')],
  { stdio: 'inherit', env, shell: process.platform === 'win32' },
);
if (rebuild.status !== 0) {
  process.exit(rebuild.status === null ? 1 : rebuild.status);
}

const mark = spawnSync(process.execPath, [path.join('scripts', 'abi.js'), 'mark', 'electron'], {
  stdio: 'inherit',
});
process.exit(mark.status === null ? 1 : mark.status);
