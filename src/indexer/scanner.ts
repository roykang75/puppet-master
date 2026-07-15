import * as fs from 'fs';
import * as path from 'path';
import ignore from 'ignore';
import { languageForPath } from './languages';

const ALWAYS_SKIP = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.cache']);

export function scanProject(root: string): string[] {
  const ig = ignore();
  const giPath = path.join(root, '.gitignore');
  if (fs.existsSync(giPath)) ig.add(fs.readFileSync(giPath, 'utf8'));
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 권한 오류 등은 건너뜀
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (ALWAYS_SKIP.has(entry.name) || ig.ignores(rel + '/')) continue;
        walk(abs);
      } else if (entry.isFile()) {
        if (ig.ignores(rel)) continue;
        if (languageForPath(abs)) out.push(abs);
      }
    }
  };
  walk(root);
  return out.sort();
}
