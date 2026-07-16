import * as fs from 'fs';
import * as path from 'path';
import { createIgnoreFilter, IgnoreFilter } from '../shared/ignore';

export interface DirEntry {
  name: string;
  isDir: boolean;
}

export class ProjectFiles {
  private filter: IgnoreFilter;
  private root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.filter = createIgnoreFilter(this.root);
  }

  /** rel이 루트를 벗어나면 예외 (경로 탈출 방지) */
  private absOf(rel: string): string {
    const abs = path.resolve(this.root, rel);
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) {
      throw new Error(`path escapes project root: ${rel}`);
    }
    return abs;
  }

  listDir(relDir: string): DirEntry[] {
    const entries = fs.readdirSync(this.absOf(relDir), { withFileTypes: true });
    const out: DirEntry[] = [];
    for (const e of entries) {
      if (!e.isDirectory() && !e.isFile()) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (this.filter.ignores(rel, e.isDirectory())) continue;
      out.push({ name: e.name, isDir: e.isDirectory() });
    }
    return out.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
  }

  readFile(rel: string): string {
    return fs.readFileSync(this.absOf(rel), 'utf8');
  }

  saveFile(rel: string, content: string): void {
    fs.writeFileSync(this.absOf(rel), content, 'utf8');
  }
}
