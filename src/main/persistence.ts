import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { UiState, LayoutPresets, ReviewState } from '../shared/protocol';

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

  chatDbPathFor(root: string): string {
    return path.join(this.baseDir, 'chat', `${this.projectHash(root)}.db`);
  }

  // 에이전트 격리 worktree 베이스 — 프로젝트 밖(userData 하위)이라 원본 오염 없음
  worktreeBaseDir(root: string): string {
    return path.join(this.baseDir, 'agent-worktrees', this.projectHash(root));
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

  // 레이아웃 프리셋 — 전역(프로젝트 무관) 단일 파일
  loadLayoutPresets(): LayoutPresets {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.baseDir, 'layout-presets.json'), 'utf8')) as LayoutPresets;
    } catch {
      return {};
    }
  }

  saveLayoutPresets(presets: LayoutPresets): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
    fs.writeFileSync(path.join(this.baseDir, 'layout-presets.json'), JSON.stringify(presets, null, 2));
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

  // 변경 리뷰 상태 (Plan 22) — 프로젝트별 baseline + reviewed 심볼 키 목록. bookmarks와 같은 패턴.
  loadReviewState(root: string): ReviewState {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(this.baseDir, 'review', `${this.projectHash(root)}.json`), 'utf8'),
      ) as ReviewState;
    } catch {
      return { baseline: null, reviewed: [] };
    }
  }

  saveReviewState(root: string, state: ReviewState): void {
    const dir = path.join(this.baseDir, 'review');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${this.projectHash(root)}.json`), JSON.stringify(state, null, 2));
  }
}
