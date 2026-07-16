import * as fs from 'fs';
import * as path from 'path';
import { languageForPath } from './languages';
import { createIgnoreFilter } from '../shared/ignore';

export function scanProject(root: string): string[] {
  const filter = createIgnoreFilter(root);
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 권한 오류 등은 건너뜀
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (filter.ignores(rel, true)) continue;
        walk(abs);
      } else if (entry.isFile()) {
        if (filter.ignores(rel, false)) continue;
        if (languageForPath(abs)) out.push(abs);
      }
    }
  };
  walk(root);
  return out.sort();
}
