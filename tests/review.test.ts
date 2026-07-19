import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseGitLog,
  parseNameStatus,
  listRecentCommits,
  listCommitsSince,
  changedFilesSince,
  fileDiffSince,
  headHash,
  isValidRef,
} from '../src/main/review';

describe('parseGitLog', () => {
  it('%H\\0%s\\0%ct 줄 파싱', () => {
    const raw = 'abc\x00first commit\x001700000000\ndef\x00second\x001700000100\n';
    expect(parseGitLog(raw)).toEqual([
      { hash: 'abc', subject: 'first commit', timestamp: 1700000000 },
      { hash: 'def', subject: 'second', timestamp: 1700000100 },
    ]);
  });
  it('빈 문자열 → []', () => {
    expect(parseGitLog('')).toEqual([]);
  });
});

describe('parseNameStatus', () => {
  it('A/M/D 및 rename(R→ D+A) 파싱', () => {
    // -z 형식: status\0path\0 ... rename은 R100\0old\0new\0
    const raw = 'M\x00a.ts\x00A\x00b.ts\x00D\x00c.ts\x00R100\x00old.ts\x00new.ts\x00';
    expect(parseNameStatus(raw)).toEqual([
      { path: 'a.ts', status: 'M' },
      { path: 'b.ts', status: 'A' },
      { path: 'c.ts', status: 'D' },
      { path: 'old.ts', status: 'D' },
      { path: 'new.ts', status: 'A' },
    ]);
  });
});

describe('review.ts (실제 git)', () => {
  let dir: string;
  const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-review-'));
    git(['init', '-q']);
    git(['config', 'user.email', 't@t.dev']);
    git(['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function foo() { return 1; }\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'init']);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('headHash / isValidRef', () => {
    const h = headHash(dir);
    expect(h).toMatch(/^[0-9a-f]{40}$/);
    expect(isValidRef(dir, h!)).toBe(true);
    expect(isValidRef(dir, 'deadbeef')).toBe(false);
  });

  it('listRecentCommits / listCommitsSince', () => {
    const base = headHash(dir)!;
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function foo() { return 2; }\n');
    git(['commit', '-qam', 'change foo']);
    expect(listRecentCommits(dir).length).toBe(2);
    const since = listCommitsSince(dir, base);
    expect(since.length).toBe(1);
    expect(since[0].subject).toBe('change foo');
  });

  it('changedFilesSince: 커밋+워킹트리+미추적 누적', () => {
    const base = headHash(dir)!;
    // 커밋된 수정
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function foo() { return 9; }\n');
    git(['commit', '-qam', 'foo=9']);
    // 워킹트리 미추적 신규
    fs.writeFileSync(path.join(dir, 'b.ts'), 'export const b = 1;\n');
    const files = changedFilesSince(dir, base);
    expect(files).toContainEqual({ path: 'a.ts', status: 'M' });
    expect(files).toContainEqual({ path: 'b.ts', status: 'A' });
  });

  it('fileDiffSince: before(baseline)/after(워킹트리)/헝크', () => {
    const base = headHash(dir)!;
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function foo() { return 42; }\n');
    const d = fileDiffSince(dir, 'a.ts', base);
    expect(d.binary).toBe(false);
    expect(d.before).toContain('return 1');
    expect(d.after).toContain('return 42');
    expect(d.hunks.length).toBeGreaterThan(0);
  });

  it('fileDiffSince: 미추적 파일은 전체 추가 헝크', () => {
    const base = headHash(dir)!;
    fs.writeFileSync(path.join(dir, 'new.ts'), 'a\nb\nc\n');
    const d = fileDiffSince(dir, 'new.ts', base);
    expect(d.before).toBe('');
    expect(d.after).toBe('a\nb\nc\n');
    expect(d.hunks.some((h) => h.type === 'add')).toBe(true);
  });
});
