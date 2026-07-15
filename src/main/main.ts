import { app, BrowserWindow, utilityProcess } from 'electron';
import * as path from 'path';

// SI_SMOKE=1: 헤드리스 검증 모드. 프로브 성공 시 창을 자동으로 닫아 app.quit()으로 종료(exit 0),
// 실패 시 기존대로 process.exit(1). 수동 창 닫기가 불가능한 자동화 환경을 위한 조정.
const SMOKE = process.env.SI_SMOKE === '1';

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 900, height: 600 });
  win.loadURL('data:text/html,<h1>SourceInSight skeleton</h1>');
  const probe = utilityProcess.fork(path.join(__dirname, '..', 'indexer', 'probe.js'));
  probe.on('message', (msg: unknown) => {
    console.log('[native-probe]', JSON.stringify(msg));
    if (!(msg as { ok: boolean }).ok) process.exit(1);
    if (SMOKE) app.quit();
  });
});
app.on('window-all-closed', () => app.quit());
