import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compareDirs } from '../src/main/dir-compare';

let root: string;
let L: string;
let R: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'si-dcmp-'));
  L = path.join(root, 'left');
  R = path.join(root, 'right');
  fs.mkdirSync(path.join(L, 'sub'), { recursive: true });
  fs.mkdirSync(path.join(R, 'sub'), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('compareDirs', () => {
  it('same/different/left-only/right-only 분류 (동일 제외, 정렬)', () => {
    fs.writeFileSync(path.join(L, 'same.txt'), 'x');
    fs.writeFileSync(path.join(R, 'same.txt'), 'x'); // 동일 → 제외
    fs.writeFileSync(path.join(L, 'diff.txt'), 'a');
    fs.writeFileSync(path.join(R, 'diff.txt'), 'b'); // 다름
    fs.writeFileSync(path.join(L, 'onlyL.txt'), 'l'); // 왼쪽만
    fs.writeFileSync(path.join(R, 'sub', 'onlyR.txt'), 'r'); // 오른쪽만(하위)

    expect(compareDirs(L, R)).toEqual([
      { relPath: 'diff.txt', status: 'different' },
      { relPath: 'onlyL.txt', status: 'left-only' },
      { relPath: 'sub/onlyR.txt', status: 'right-only' },
    ]);
  });

  it('.git/node_modules 스킵', () => {
    fs.mkdirSync(path.join(L, 'node_modules'));
    fs.writeFileSync(path.join(L, 'node_modules', 'pkg.js'), 'x');
    fs.mkdirSync(path.join(L, '.git'));
    fs.writeFileSync(path.join(L, '.git', 'HEAD'), 'ref');
    expect(compareDirs(L, R)).toEqual([]);
  });

  it('완전 동일 트리 → []', () => {
    fs.writeFileSync(path.join(L, 'a.txt'), 'same');
    fs.writeFileSync(path.join(R, 'a.txt'), 'same');
    expect(compareDirs(L, R)).toEqual([]);
  });
});
