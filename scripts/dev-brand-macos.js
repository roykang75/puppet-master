// dev 전용 브랜딩(macOS) — 앱 메뉴 첫 항목(굵은 제목)은 OS가 Electron 번들의
// CFBundleName을 강제 사용한다. app.setName/커스텀 라벨로는 못 바꾸므로,
// dev Electron 번들 이름을 'Puppet Master'로 패치한다. (패키지 앱은 electron-builder가
// productName으로 처리 — 무관.) 멱등, 실패해도 비치명(메뉴 표시만 영향).
const fs = require('fs');
const { execFileSync } = require('child_process');

if (process.platform !== 'darwin') process.exit(0);

const NAME = 'Puppet Master';
const plist = 'node_modules/electron/dist/Electron.app/Contents/Info.plist';
if (!fs.existsSync(plist)) process.exit(0);

try {
  for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${NAME}`, plist], { stdio: 'ignore' });
  }
  console.log(`[brand] Electron dev 번들 이름 → ${NAME} (앱 메뉴 교정)`);
} catch {
  // PlistBuddy 없음/권한 등 — 무시
}
