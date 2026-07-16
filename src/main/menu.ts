import { Menu } from 'electron';
import type { RecentEntry } from './persistence';

export type MenuAction = { type: 'open-folder' } | { type: 'save' } | { type: 'open-recent'; root: string };

export function buildMenu(recent: RecentEntry[], send: (action: MenuAction) => void): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
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
        process.platform === 'darwin' ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
