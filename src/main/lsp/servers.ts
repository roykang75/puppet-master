// 선언적 언어 서버 정의 — 언어 추가는 이 테이블에 항목 추가로 끝나야 한다 (스펙 §2 완충 장치)
import * as path from 'path';
import type { LspLanguage } from '../../shared/protocol';

export interface LspSpawnSpec { command: string; args: string[]; env?: NodeJS.ProcessEnv }
export interface LspServerDef {
  lang: LspLanguage;
  exts: Set<string>;
  resolveSpawn(): LspSpawnSpec;
}

// TS7 네이티브 바이너리 — typescript/lib/getExePath.js(ESM)와 동일 로직의 CJS 구현
export function tsgoExePath(): string {
  const pkg = `@typescript/typescript-${process.platform}-${process.arch}`;
  const pkgJson = require.resolve(`${pkg}/package.json`);
  const bin = process.platform === 'win32' ? 'tsc.exe' : 'tsc';
  return path.join(path.dirname(pkgJson), 'lib', bin);
}

export function pyrightEntryPath(): string {
  return require.resolve('pyright/langserver.index.js');
}

export const LSP_SERVERS: LspServerDef[] = [
  {
    lang: 'ts',
    exts: new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']),
    resolveSpawn: () => ({ command: tsgoExePath(), args: ['--lsp', '--stdio'] }),
  },
  {
    lang: 'py',
    exts: new Set(['.py']),
    resolveSpawn: () => ({
      command: process.execPath, // Electron 바이너리를 node로 사용 — 사용자 머신 node 불요
      args: [pyrightEntryPath(), '--stdio'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    }),
  },
];

export function serverForExt(ext: string): LspServerDef | null {
  return LSP_SERVERS.find((s) => s.exts.has(ext)) ?? null;
}
