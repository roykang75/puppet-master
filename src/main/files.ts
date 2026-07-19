import * as fs from 'fs';
import * as path from 'path';
import { createIgnoreFilter, IgnoreFilter } from '../shared/ignore';
import { compareDirs } from './dir-compare';
import type { DirCompareEntry } from '../shared/protocol';

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

  /** 두 하위 디렉터리 재귀 비교 (경로 안전 검증 후) */
  compareDirs(leftRel: string, rightRel: string): DirCompareEntry[] {
    return compareDirs(this.absOf(leftRel), this.absOf(rightRel));
  }

  /** 바이너리 파일(이미지 등)을 base64로 — 렌더러 data URL용 */
  readBinary(rel: string): string {
    return fs.readFileSync(this.absOf(rel)).toString('base64');
  }

  saveFile(rel: string, content: string): void {
    fs.writeFileSync(this.absOf(rel), content, 'utf8');
  }

  /** 빈 파일 생성 — 중간 폴더 자동 생성, 이미 있으면 예외 */
  createFile(rel: string): void {
    const abs = this.absOf(rel);
    if (fs.existsSync(abs)) throw new Error(`이미 존재합니다: ${rel}`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '', { flag: 'wx' });
  }

  /** 폴더 생성 (재귀) — 이미 있으면 예외 */
  createDir(rel: string): void {
    const abs = this.absOf(rel);
    if (fs.existsSync(abs)) throw new Error(`이미 존재합니다: ${rel}`);
    fs.mkdirSync(abs, { recursive: true });
  }
}
