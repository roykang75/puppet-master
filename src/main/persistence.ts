import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { UiState } from '../shared/protocol';

export interface RecentEntry {
  root: string;
  openedAt: number;
}

const MAX_RECENT = 10;

export class Persistence {
  constructor(private baseDir: string) {}

  private projectHash(root: string): string {
    return crypto.createHash('sha1').update(root).digest('hex').slice(0, 16);
  }

  dbPathFor(root: string): string {
    return path.join(this.baseDir, 'index', `${this.projectHash(root)}.db`);
  }

  loadRecent(): RecentEntry[] {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.baseDir, 'recent.json'), 'utf8')) as RecentEntry[];
    } catch {
      return [];
    }
  }

  addRecent(root: string): void {
    const list = [{ root, openedAt: Date.now() }, ...this.loadRecent().filter((r) => r.root !== root)].slice(0, MAX_RECENT);
    fs.mkdirSync(this.baseDir, { recursive: true });
    fs.writeFileSync(path.join(this.baseDir, 'recent.json'), JSON.stringify(list, null, 2));
  }

  private uiStatePath(root: string): string {
    return path.join(this.baseDir, 'projects', `${this.projectHash(root)}.json`);
  }

  loadUiState(root: string): UiState | null {
    try {
      return JSON.parse(fs.readFileSync(this.uiStatePath(root), 'utf8')) as UiState;
    } catch {
      return null;
    }
  }

  saveUiState(root: string, state: UiState): void {
    fs.mkdirSync(path.join(this.baseDir, 'projects'), { recursive: true });
    fs.writeFileSync(this.uiStatePath(root), JSON.stringify(state, null, 2));
  }

  loadBookmarks(root: string): unknown[] {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(this.baseDir, 'bookmarks', `${this.projectHash(root)}.json`), 'utf8'),
      ) as unknown[];
    } catch {
      return [];
    }
  }

  saveBookmarks(root: string, list: unknown[]): void {
    const dir = path.join(this.baseDir, 'bookmarks');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${this.projectHash(root)}.json`), JSON.stringify(list, null, 2));
  }
}
