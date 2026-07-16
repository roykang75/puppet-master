import * as fs from 'fs';
import * as path from 'path';
import ignore from 'ignore';

export const ALWAYS_SKIP = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.cache']);

export interface IgnoreFilter {
  /** rel은 '/' 구분자 프로젝트 루트 기준 상대 경로. 루트 자신('')은 항상 false. */
  ignores(rel: string, isDir: boolean): boolean;
}

/** scanner/watcher/파일 트리가 공유하는 제외 규칙: 숨김·ALWAYS_SKIP 세그먼트 + 루트 .gitignore */
export function createIgnoreFilter(root: string): IgnoreFilter {
  const ig = ignore();
  const giPath = path.join(root, '.gitignore');
  if (fs.existsSync(giPath)) ig.add(fs.readFileSync(giPath, 'utf8'));
  return {
    ignores(rel: string, isDir: boolean): boolean {
      if (rel === '') return false;
      const parts = rel.split('/');
      if (parts.some((s) => s.startsWith('.') || ALWAYS_SKIP.has(s))) return true;
      // 디렉터리 규칙(`dist/`)이 하위 경로에 적용되도록 조상 prefix를 검사
      let prefix = '';
      for (let i = 0; i < parts.length - 1; i++) {
        prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
        if (ig.ignores(prefix + '/')) return true;
      }
      return ig.ignores(isDir ? rel + '/' : rel);
    },
  };
}
