import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { LSP_SERVERS, serverForExt, tsgoExePath, pyrightEntryPath } from '../src/main/lsp/servers';
import { LSP_EXT_TO_LANGUAGE } from '../src/shared/protocol';

describe('LSP 서버 정의', () => {
  it('확장자 라우팅: ts/py 계열은 서버가 있고 그 외는 null', () => {
    expect(serverForExt('.ts')?.lang).toBe('ts');
    expect(serverForExt('.tsx')?.lang).toBe('ts');
    expect(serverForExt('.mjs')?.lang).toBe('ts');
    expect(serverForExt('.py')?.lang).toBe('py');
    expect(serverForExt('.c')).toBeNull();
    expect(serverForExt('.java')).toBeNull();
  });

  it('tsgo 실행 파일이 실제로 존재한다', () => {
    const p = tsgoExePath();
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.statSync(p).mode & 0o111).toBeTruthy(); // 실행 권한
  });

  it('pyright langserver 진입점이 해석된다', () => {
    expect(fs.existsSync(pyrightEntryPath())).toBe(true);
  });

  it('스폰 스펙: ts는 네이티브 직접, py는 ELECTRON_RUN_AS_NODE', () => {
    const ts = LSP_SERVERS.find((s) => s.lang === 'ts')!.resolveSpawn();
    expect(ts.command).toBe(tsgoExePath());
    expect(ts.args).toEqual(['--lsp', '--stdio']);
    const py = LSP_SERVERS.find((s) => s.lang === 'py')!.resolveSpawn();
    expect(py.command).toBe(process.execPath);
    expect(py.args[0]).toBe(pyrightEntryPath());
    expect(py.args[1]).toBe('--stdio');
    expect(py.env?.ELECTRON_RUN_AS_NODE).toBe('1');
  });

  it('languageId 매핑', () => {
    expect(LSP_EXT_TO_LANGUAGE['.ts']).toBe('typescript');
    expect(LSP_EXT_TO_LANGUAGE['.tsx']).toBe('typescriptreact');
    expect(LSP_EXT_TO_LANGUAGE['.js']).toBe('javascript');
    expect(LSP_EXT_TO_LANGUAGE['.py']).toBe('python');
  });
});
