// 선언적 언어 서버 정의 — 언어 추가는 이 테이블에 항목 추가로 끝나야 한다 (스펙 §2 완충 장치)
import * as path from 'path';
import type { LspLanguage } from '../../shared/protocol';

export interface LspSpawnSpec { command: string; args: string[]; env?: NodeJS.ProcessEnv }
export interface LspServerDef {
  lang: LspLanguage;
  exts: Set<string>;
  resolveSpawn(): LspSpawnSpec;
}

// 패키지 앱에선 require.resolve가 app.asar 내부 경로를 돌려주지만, 이 파일들은 asarUnpack으로
// app.asar.unpacked에 실물 배치돼 있다. 네이티브 바이너리 spawn/RUN_AS_NODE 스폰은 asar를
// 투명 처리하지 않으므로(디렉터리가 아닌 파일이라 ENOTDIR) 실물 경로로 리디렉트한다. dev에선 무영향.
function unpacked(p: string): string {
  const marker = `app.asar${path.sep}`;
  const unpackedMarker = `app.asar.unpacked${path.sep}`;
  return p.includes(unpackedMarker) ? p : p.replace(marker, unpackedMarker);
}

// TS7 네이티브 바이너리 — typescript/lib/getExePath.js(ESM)와 동일 로직의 CJS 구현
export function tsgoExePath(): string {
  const pkg = `@typescript/typescript-${process.platform}-${process.arch}`;
  const pkgJson = require.resolve(`${pkg}/package.json`);
  const bin = process.platform === 'win32' ? 'tsc.exe' : 'tsc';
  return unpacked(path.join(path.dirname(pkgJson), 'lib', bin));
}

export function pyrightEntryPath(): string {
  return unpacked(require.resolve('pyright/langserver.index.js'));
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
