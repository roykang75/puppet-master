import { Menu } from 'electron';
import type { RecentEntry } from './persistence';

export type MenuAction = { type: 'open-folder' } | { type: 'save' } | { type: 'open-recent'; root: string } | { type: 'export-html' } | { type: 'find-in-files' };

export function buildMenu(recent: RecentEntry[], send: (action: MenuAction) => void, openAbout: () => void): void {
  // macOS 앱 메뉴 — 기본 appMenu 역할 대신 커스텀(About만 커스텀 창으로, 나머지는 표준 role)
  const appMenu: Electron.MenuItemConstructorOptions = {
    label: 'Puppet Master',
    submenu: [
      { label: 'About Puppet Master', click: () => openAbout() },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [appMenu] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => send({ type: 'open-folder' }) },
        {
          label: 'Open Recent',
          submenu: recent.length
            ? recent.map((r) => ({ label: r.root, click: () => send({ type: 'open-recent', root: r.root }) }))
            : [{ label: '(없음)', enabled: false }],
        },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send({ type: 'save' }) },
        { type: 'separator' },
        // registerAccelerator:false — 라벨에 단축키만 표기하고 키 등록은 하지 않는다.
        // Cmd/Ctrl+Shift+F는 렌더러(App.tsx keydown)가 토글로 처리하므로 이중 발화를 막는다.
        { label: 'Find in Files…', accelerator: 'CmdOrCtrl+Shift+F', registerAccelerator: false, click: () => send({ type: 'find-in-files' }) },
        { type: 'separator' },
        { label: 'HTML로 내보내기…', accelerator: 'CmdOrCtrl+Shift+E', click: () => send({ type: 'export-html' }) },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
