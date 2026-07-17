/** Material Icon Theme 아이콘 URL 공급 (Vite) — 리졸버는 file-icons-core(순수), 여기는 자산 연결만.
 * import.meta.glob이 icons/*.svg 1,250개를 URL로 번들에 포함시킨다 (dev/패키지 양쪽 동작). */
import manifest from 'material-icon-theme/dist/material-icons.json';
import { resolveFileIcon, resolveFolderIcon, type IconManifest } from './file-icons-core';

const m = manifest as unknown as IconManifest;

const urls = import.meta.glob('../../../node_modules/material-icon-theme/icons/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function iconUrl(id: string): string | undefined {
  return urls[`../../../node_modules/material-icon-theme/icons/${id}.svg`];
}

export function fileIconUrl(name: string): string | undefined {
  return iconUrl(resolveFileIcon(m, name)) ?? iconUrl(m.file);
}

export function folderIconUrl(name: string, expanded: boolean): string | undefined {
  return iconUrl(resolveFolderIcon(m, name, expanded)) ?? iconUrl(expanded ? m.folderExpanded : m.folder);
}
