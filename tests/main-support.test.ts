import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Persistence } from '../src/main/persistence';
import { ProjectFiles } from '../src/main/files';

let work: string;
let proj: string;

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'si-main-'));
  proj = path.join(work, 'proj');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.gitignore'), 'secret/\n');
  fs.mkdirSync(path.join(proj, 'secret'));
  fs.writeFileSync(path.join(proj, 'secret', 'k.txt'), 'x');
  fs.writeFileSync(path.join(proj, 'README.md'), '# readme');
  fs.writeFileSync(path.join(proj, 'src', 'a.ts'), 'export const a = 1;');
});
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

describe('Persistence', () => {
  it('recent 목록: 추가·중복 제거·최신 우선', () => {
    const p = new Persistence(path.join(work, 'ud1'));
    p.addRecent('/x');
    p.addRecent('/y');
    p.addRecent('/x');
    const roots = p.loadRecent().map((r) => r.root);
    expect(roots).toEqual(['/x', '/y']);
  });
  it('UiState 저장/복원, 없으면 null', () => {
    const p = new Persistence(path.join(work, 'ud2'));
    expect(p.loadUiState('/proj')).toBeNull();
    const state = { panelLayouts: { main: '{}' }, openTabs: ['a.ts'], activeTab: 'a.ts' };
    p.saveUiState('/proj', state);
    expect(p.loadUiState('/proj')).toEqual(state);
  });
  it('dbPathFor는 baseDir/index 아래 프로젝트별 경로', () => {
    const p = new Persistence(path.join(work, 'ud3'));
    const dbPath = p.dbPathFor('/proj');
    expect(dbPath.startsWith(path.join(work, 'ud3', 'index'))).toBe(true);
    expect(p.dbPathFor('/proj')).toBe(dbPath); // 결정적
    expect(p.dbPathFor('/other')).not.toBe(dbPath);
  });
});

describe('ProjectFiles', () => {
  it('listDir: ignore 필터 + dir 우선 정렬, 비코드 파일 포함', () => {
    const f = new ProjectFiles(proj);
    const names = f.listDir('').map((e) => `${e.isDir ? 'd' : 'f'}:${e.name}`);
    expect(names).toEqual(['d:src', 'f:README.md']); // .gitignore(숨김)·secret(gitignore) 제외
  });
  it('read/save 왕복', () => {
    const f = new ProjectFiles(proj);
    f.saveFile('src/a.ts', 'export const a = 2;');
    expect(f.readFile('src/a.ts')).toBe('export const a = 2;');
  });
  it('루트 탈출 경로는 거부', () => {
    const f = new ProjectFiles(proj);
    expect(() => f.readFile('../outside.txt')).toThrow('escapes');
  });
  it('createFile: 중간 폴더 자동 생성 + 빈 파일, 기존 파일은 거부', () => {
    const f = new ProjectFiles(proj);
    f.createFile('deep/nested/new.ts');
    expect(f.readFile('deep/nested/new.ts')).toBe('');
    expect(() => f.createFile('deep/nested/new.ts')).toThrow('이미 존재');
    expect(() => f.createFile('../evil.ts')).toThrow('escapes');
  });
  it('createDir: 재귀 생성, 기존 폴더는 거부', () => {
    const f = new ProjectFiles(proj);
    f.createDir('newdir/sub');
    expect(f.listDir('newdir').map((e) => e.name)).toEqual(['sub']);
    expect(() => f.createDir('newdir/sub')).toThrow('이미 존재');
    expect(() => f.createDir('../evil')).toThrow('escapes');
  });
});
