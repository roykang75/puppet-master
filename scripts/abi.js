// 네이티브 ABI 가드 — 마커(node_modules/.abi)로 현재 빌드된 ABI를 추적.
//   mark <abi>   : 재빌드 후 마커 갱신 (rebuild:electron/node가 호출)
//   ensure <abi> : 마커가 원하는 ABI가 아니면 해당 재빌드 실행 (predev/pretest가 호출)
// 목적: dev(electron ABI) ↔ test(node ABI) 전환 시 수동 rebuild 불필요.
const fs = require('fs');
const { execSync } = require('child_process');

const MARKER = 'node_modules/.abi';
const [cmd, abi] = process.argv.slice(2);

if (abi !== 'electron' && abi !== 'node') {
  console.error(`abi.js: 잘못된 ABI '${abi}' (electron|node)`);
  process.exit(2);
}

if (cmd === 'mark') {
  fs.writeFileSync(MARKER, abi);
} else if (cmd === 'ensure') {
  let cur = '';
  try {
    cur = fs.readFileSync(MARKER, 'utf8').trim();
  } catch {
    // 마커 없음(신규 클론/설치) — 재빌드 필요
  }
  if (cur === abi) process.exit(0);
  console.log(`[abi] ${cur || 'unknown'} → ${abi} 재빌드…`);
  execSync(`npm run rebuild:${abi}`, { stdio: 'inherit' });
} else {
  console.error(`abi.js: 알 수 없는 명령 '${cmd}' (mark|ensure)`);
  process.exit(2);
}
