import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getFileChanges } from '../src/main/git-diff';

let dir: string;
const git = (args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-git-'));
  git(['init', '-q']);
  git(['config', 'user.email', 't@t.dev']);
  git(['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(dir, 'f.txt'), 'a\nb\nc\nd\n');
  git(['add', 'f.txt']);
  git(['commit', '-q', '-m', 'init']);
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('getFileChanges (실제 git)', () => {
  it('수정 + 추가 라인 감지', async () => {
    fs.writeFileSync(path.join(dir, 'f.txt'), 'a\nB_MOD\nc\nd\nE_ADD\n'); // line2 수정, line5 추가
    const changes = await getFileChanges(dir, 'f.txt');
    expect(changes.some((c) => c.type === 'modify' && c.startLine <= 2 && c.endLine >= 2)).toBe(true);
    expect(changes.some((c) => c.type === 'add' && c.startLine <= 5 && c.endLine >= 5)).toBe(true);
  });

  it('삭제 라인 감지', async () => {
    fs.writeFileSync(path.join(dir, 'f.txt'), 'a\nb\nd\n'); // line3(c) 삭제
    const changes = await getFileChanges(dir, 'f.txt');
    expect(changes.some((c) => c.type === 'delete')).toBe(true);
  });

  it('변경 없으면 빈 배열', async () => {
    fs.writeFileSync(path.join(dir, 'f.txt'), 'a\nb\nc\nd\n'); // 원상복구
    expect(await getFileChanges(dir, 'f.txt')).toEqual([]);
  });

  it('비-git 디렉터리 → 빈 배열 (오류 조용히)', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'si-nogit-'));
    try {
      fs.writeFileSync(path.join(plain, 'x.txt'), 'hi\n');
      expect(await getFileChanges(plain, 'x.txt')).toEqual([]);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});
