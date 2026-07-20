// 크로스 플랫폼 electron ABI 재빌드 래퍼.
//   기존 npm 스크립트의 `CXXFLAGS=-std=c++20 electron-rebuild ...`는 POSIX 전용이라
//   Windows CI(cmd/powershell)에서 깨진다. process.platform에 따라 env를 설정하고
//   electron-rebuild를 실행한 뒤 ABI 마커를 electron으로 갱신한다.
// tree-sitter류는 C++20을 요구 — POSIX는 CXXFLAGS, MSVC(win32)는 CL=/std:c++20로 전달.
const { spawnSync } = require('child_process');
const path = require('path');

// node-pty는 제외 — node-addon-api(N-API) 기반이라 ABI가 안정적이고 동봉 프리빌드가
// electron에서 그대로 동작한다. 오히려 win32에서 deps/winpty의 gyp 액션이 실패해
// 재빌드 전체를 중단시킨다.
// 제외가 실제로 먹으려면 -o(--only)여야 한다. -w(--which-module)는 대상을 '추가'할 뿐이라
// 목록에 없는 네이티브 의존성도 그대로 빌드된다.
// -o는 목록 밖을 전부 무시하므로 전이 의존성인 tree-sitter-javascript도 명시해야 한다
// (직접 의존성이 아니라 -w 시절엔 자동 포함되던 모듈).
const MODULES = [
  'tree-sitter',
  'tree-sitter-c',
  'tree-sitter-cpp',
  'tree-sitter-python',
  'tree-sitter-typescript',
  'tree-sitter-javascript',
  'tree-sitter-java',
  'better-sqlite3',
];

const env = { ...process.env };
if (process.platform === 'win32') {
  // MSVC는 CXXFLAGS를 무시 — C++20은 cl.exe 환경변수로 주입한다.
  // CL 옵션은 명령줄 '앞'에 붙어 tree-sitter binding.gyp의 /std:c++17에 덮어써진다(D9025).
  // _CL_ 옵션은 명령줄 '뒤'에 붙어 마지막 /std가 이기므로 C++20을 강제할 수 있다.
  env._CL_ = [env._CL_, '/std:c++20'].filter(Boolean).join(' ');
} else {
  env.CXXFLAGS = [env.CXXFLAGS, '-std=c++20'].filter(Boolean).join(' ');
}

const bin = process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild';
const rebuild = spawnSync(
  path.join('node_modules', '.bin', bin),
  ['-f', '-o', MODULES.join(',')],
  { stdio: 'inherit', env, shell: process.platform === 'win32' },
);
if (rebuild.status !== 0) {
  process.exit(rebuild.status === null ? 1 : rebuild.status);
}

const mark = spawnSync(process.execPath, [path.join('scripts', 'abi.js'), 'mark', 'electron'], {
  stdio: 'inherit',
});
process.exit(mark.status === null ? 1 : mark.status);
