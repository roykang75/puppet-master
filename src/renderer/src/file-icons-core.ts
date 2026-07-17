/** Material Icon Theme 매핑 리졸버 (순수) — 파일/폴더 이름 → 아이콘 id.
 * 자산은 material-icon-theme 패키지(MIT)의 manifest + icons/*.svg를 그대로 사용한다. */

export interface IconManifest {
  file: string;
  folder: string;
  folderExpanded: string;
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesExpanded: Record<string, string>;
}

/** 파일명 → 아이콘 id. 정확한 파일명 매칭 → 긴 복합 확장자 우선(foo.test.ts → test.ts → ts) → 기본 file */
export function resolveFileIcon(m: IconManifest, name: string): string {
  const lower = name.toLowerCase();
  const byName = m.fileNames[lower];
  if (byName) return byName;
  const parts = lower.split('.');
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join('.');
    const byExt = m.fileExtensions[ext];
    if (byExt) return byExt;
  }
  return m.file;
}

/** 폴더명 → 아이콘 id (열림/닫힘 변형) */
export function resolveFolderIcon(m: IconManifest, name: string, expanded: boolean): string {
  const lower = name.toLowerCase();
  const special = expanded ? m.folderNamesExpanded[lower] : m.folderNames[lower];
  return special ?? (expanded ? m.folderExpanded : m.folder);
}
