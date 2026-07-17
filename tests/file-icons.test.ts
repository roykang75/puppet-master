import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import manifest from 'material-icon-theme/dist/material-icons.json';
import { resolveFileIcon, resolveFolderIcon, type IconManifest } from '../src/renderer/src/file-icons-core';

const m = manifest as unknown as IconManifest;
const ICONS_DIR = path.join(__dirname, '..', 'node_modules', 'material-icon-theme', 'icons');
const svgExists = (id: string) => fs.existsSync(path.join(ICONS_DIR, `${id}.svg`));

describe('resolveFileIcon', () => {
  it('정확한 파일명 매칭 (Jenkinsfile, Dockerfile, .gitignore)', () => {
    expect(resolveFileIcon(m, 'Jenkinsfile')).toBe('jenkins');
    expect(resolveFileIcon(m, 'Dockerfile')).toBe('docker');
    expect(resolveFileIcon(m, '.gitignore')).toBe('git');
  });

  it('확장자 매칭 — 복합 확장자가 단일보다 우선', () => {
    expect(resolveFileIcon(m, 'a.ts')).toBe('typescript');
    expect(resolveFileIcon(m, 'README.md')).toBe('readme');
    expect(resolveFileIcon(m, 'x.test.ts')).not.toBe('typescript'); // test.ts 전용 아이콘
  });

  it('미지의 확장자/이름 → 기본 file 아이콘', () => {
    expect(resolveFileIcon(m, 'unknown.zzz9')).toBe(m.file);
    expect(resolveFileIcon(m, 'noext')).toBe(m.file);
  });

  it('해석된 아이콘 id는 실제 svg 파일이 존재한다', () => {
    for (const n of ['Jenkinsfile', 'a.ts', 'b.py', 'c.md', 'd.json', 'noext', 'Cargo.toml', 'docker-compose.yml']) {
      const id = resolveFileIcon(m, n);
      expect(svgExists(id), `${n} → ${id}`).toBe(true);
    }
  });
});

describe('resolveFolderIcon', () => {
  it('특수 폴더(src/tests)는 전용 아이콘, 열림 변형 분리', () => {
    expect(resolveFolderIcon(m, 'src', false)).toBe('folder-src');
    expect(resolveFolderIcon(m, 'src', true)).toBe('folder-src-open');
    expect(resolveFolderIcon(m, 'SomethingElse', false)).toBe(m.folder);
    expect(resolveFolderIcon(m, 'SomethingElse', true)).toBe(m.folderExpanded);
  });

  it('해석된 폴더 아이콘 id는 실제 svg가 존재한다', () => {
    for (const n of ['src', 'tests', 'node_modules', 'random-dir']) {
      for (const open of [false, true]) {
        const id = resolveFolderIcon(m, n, open);
        expect(svgExists(id), `${n}(${open}) → ${id}`).toBe(true);
      }
    }
  });
});
