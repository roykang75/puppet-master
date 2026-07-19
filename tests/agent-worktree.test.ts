import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isGitRepo, ensureWorktree, worktreeChanges, applyWorktree, discardWorktree } from '../src/main/agent/worktree';
import { resolveToolPath, type AgentToolDeps } from '../src/main/agent/tools';

let root: string;
let base: string;
const git = (dir: string, args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'si-wt-root-'));
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'si-wt-base-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t.dev']);
  git(root, ['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(root, 'keep.txt'), 'original\n');
  fs.writeFileSync(path.join(root, 'del.txt'), 'to be deleted\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'init']);
});

afterEach(() => {
  // wt를 먼저 정리해 worktree 등록 잔재 방지
  try {
    discardWorktree(root, path.join(base, 'agent-wt'));
  } catch {
    // 무시
  }
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(base, { recursive: true, force: true });
});

describe('isGitRepo', () => {
  it('git 저장소는 true, 비-git은 false', () => {
    expect(isGitRepo(root)).toBe(true);
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'si-nogit-'));
    try {
      expect(isGitRepo(plain)).toBe(false);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe('ensureWorktree — dirty 동기화', () => {
  it('M/A(untracked)/D를 wt로 미러링', () => {
    fs.writeFileSync(path.join(root, 'keep.txt'), 'modified\n'); // M
    fs.writeFileSync(path.join(root, 'new.txt'), 'brand new\n'); // ?? (A)
    fs.rmSync(path.join(root, 'del.txt')); // D
    const { dir } = ensureWorktree(root, base);
    expect(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf8')).toBe('modified\n');
    expect(fs.readFileSync(path.join(dir, 'new.txt'), 'utf8')).toBe('brand new\n');
    expect(fs.existsSync(path.join(dir, 'del.txt'))).toBe(false);
    // wt의 변경 목록도 원본 dirty를 반영
    const ch = worktreeChanges(dir);
    expect(ch.find((c) => c.path === 'keep.txt')?.status).toBe('M');
    expect(ch.find((c) => c.path === 'new.txt')?.status).toBe('A');
    expect(ch.find((c) => c.path === 'del.txt')?.status).toBe('D');
  });

  it('재호출 시 같은 디렉터리 재사용 (throw 없음)', () => {
    const a = ensureWorktree(root, base);
    const b = ensureWorktree(root, base);
    expect(b.dir).toBe(a.dir);
    expect(fs.existsSync(b.dir)).toBe(true);
  });
});

describe('worktreeChanges + applyWorktree', () => {
  it('에이전트가 wt에 쓴 변경을 감지하고 원본에 반영 후 wt 정리', () => {
    const { dir } = ensureWorktree(root, base);
    // 에이전트가 wt에서 직접 작업하는 것을 흉내
    fs.writeFileSync(path.join(dir, 'gugudan.py'), 'for i in range(1,10):\n    print(2*i)\n'); // A
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'agent edit\n'); // M
    fs.rmSync(path.join(dir, 'del.txt')); // D

    const ch = worktreeChanges(dir);
    expect(ch.find((c) => c.path === 'gugudan.py')?.status).toBe('A');
    expect(ch.find((c) => c.path === 'keep.txt')?.status).toBe('M');
    expect(ch.find((c) => c.path === 'del.txt')?.status).toBe('D');

    const applied = applyWorktree(root, dir);
    expect(applied.sort()).toEqual(['del.txt', 'gugudan.py', 'keep.txt']);
    // 원본 반영
    expect(fs.readFileSync(path.join(root, 'gugudan.py'), 'utf8')).toContain('for i in range');
    expect(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8')).toBe('agent edit\n');
    expect(fs.existsSync(path.join(root, 'del.txt'))).toBe(false);
    // wt 정리됨
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('paths 지정 시 그 파일만 적용', () => {
    const { dir } = ensureWorktree(root, base);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'A\n');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'B\n');
    const applied = applyWorktree(root, dir, ['a.txt']);
    expect(applied).toEqual(['a.txt']);
    expect(fs.existsSync(path.join(root, 'a.txt'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'b.txt'))).toBe(false);
  });
});

describe('discardWorktree', () => {
  it('wt를 제거하고, 없는 wt 재폐기는 조용히 무시', () => {
    const { dir } = ensureWorktree(root, base);
    fs.writeFileSync(path.join(dir, 'scratch.txt'), 'x\n');
    discardWorktree(root, dir);
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(path.join(root, 'scratch.txt'))).toBe(false); // 원본 오염 없음
    expect(() => discardWorktree(root, dir)).not.toThrow();
  });
});

describe('비-git에서 ensureWorktree는 throw', () => {
  it('git 저장소가 아니면 예외 (직접 모드 묵시 폴백 금지)', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'si-nogit-'));
    try {
      expect(() => ensureWorktree(plain, base)).toThrow();
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe('resolveToolPath가 wt 루트로 격리', () => {
  it('projectRoot=wt이면 상대경로가 wt 안으로 해석된다', () => {
    const { dir } = ensureWorktree(root, base);
    const deps: AgentToolDeps = { projectRoot: dir, allowedDirs: [], searchText: async () => [] };
    const resolved = resolveToolPath(deps, 'sub/x.ts');
    expect(resolved).toBe(path.join(dir, 'sub/x.ts'));
    // 원본 루트 밖 경로 접근은 차단
    expect(() => resolveToolPath(deps, path.join(root, 'keep.txt'))).toThrow();
  });
});
