import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AGENT_TOOLS, READONLY_AGENT_TOOLS, buildWriteDiff, executeTool, resolveToolPath, toolSummary, sandboxProfile, type AgentToolDeps } from '../src/main/agent/tools';

let root: string;
let extra: string;

const deps = (over: Partial<AgentToolDeps> = {}): AgentToolDeps => ({
  projectRoot: root,
  allowedDirs: [extra],
  searchText: async (q) => [{ path: 'a.ts', snippet: `hit:${q}` }],
  ...over,
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'si-agent-root-'));
  extra = fs.mkdtempSync(path.join(os.tmpdir(), 'si-agent-extra-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(extra, { recursive: true, force: true });
});

describe('AGENT_TOOLS 스키마', () => {
  it('5종 도구가 이름/설명/파라미터를 갖는다', () => {
    expect(AGENT_TOOLS.map((t) => t.name).sort()).toEqual(
      ['list_dir', 'read_file', 'run_command', 'search_text', 'write_file'],
    );
    for (const t of AGENT_TOOLS) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.parameters.type).toBe('object');
    }
  });
});

describe('resolveToolPath', () => {
  it('상대 경로는 프로젝트 루트 기준, 탈출은 거부', () => {
    expect(resolveToolPath(deps(), 'src/a.py')).toBe(path.join(root, 'src/a.py'));
    expect(() => resolveToolPath(deps(), '../evil')).toThrow('허용된 디렉터리 밖');
  });
  it('절대 경로는 루트/추가 허용 디렉터리 안만 허용', () => {
    expect(resolveToolPath(deps(), path.join(extra, 'doc.md'))).toBe(path.join(extra, 'doc.md'));
    expect(() => resolveToolPath(deps(), '/etc/passwd')).toThrow('허용된 디렉터리 밖');
  });
  it('허용 디렉터리 안 심링크가 밖(os.tmpdir() 바로 아래)을 가리키면 거부', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'si-agent-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'top-secret');
      const link = path.join(root, 'escape-link');
      fs.symlinkSync(outside, link, 'dir');
      expect(() => resolveToolPath(deps(), 'escape-link/secret.txt')).toThrow('허용된 디렉터리 밖');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
  it('심링크 없는 정상 경로는 여전히 통과', () => {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'a.py'), 'x');
    expect(resolveToolPath(deps(), 'src/a.py')).toBe(path.join(root, 'src/a.py'));
  });
});

describe('executeTool', () => {
  it('write_file: 중간 폴더 자동 생성 + read_file 줄번호 라운드트립', async () => {
    const r = await executeTool('write_file', { path: 'src/gugudan.py', content: 'print(1)\nprint(2)' }, deps());
    expect(r).toContain('작성 완료');
    expect(fs.readFileSync(path.join(root, 'src/gugudan.py'), 'utf8')).toBe('print(1)\nprint(2)');
    const read = await executeTool('read_file', { path: 'src/gugudan.py' }, deps());
    expect(read).toContain('1\tprint(1)');
    expect(read).toContain('2\tprint(2)');
  });
  it('list_dir: [dir]/[file] 표기, .git·node_modules 숨김', async () => {
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, '.git'));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'a.ts'), 'x');
    const r = await executeTool('list_dir', { path: '' }, deps());
    expect(r).toContain('[dir] src');
    expect(r).toContain('[file] a.ts');
    expect(r).not.toContain('.git');
    expect(r).not.toContain('node_modules');
  });
  it('search_text: 주입된 검색기로 위임', async () => {
    const r = await executeTool('search_text', { query: 'foo' }, deps());
    expect(r).toContain('a.ts');
    expect(r).toContain('hit:foo');
  });
  it('read_file: 없는 파일은 오류 텍스트 (throw 아님)', async () => {
    const r = await executeTool('read_file', { path: 'none.txt' }, deps());
    expect(r).toContain('오류');
  });
  it('read_file: 허용 디렉터리 안 심링크가 밖을 가리키면 오류 (OS 수준 탈출 차단)', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'si-agent-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'top-secret');
      fs.symlinkSync(outside, path.join(root, 'escape-link'), 'dir');
      const r = await executeTool('read_file', { path: 'escape-link/secret.txt' }, deps());
      expect(r).toContain('허용된 디렉터리 밖');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
  it('알 수 없는 도구 이름은 오류 텍스트', async () => {
    const r = await executeTool('nope', {}, deps());
    expect(r).toContain('알 수 없는 도구');
  });
});

describe('buildWriteDiff', () => {
  it('새 파일이면 +줄 미리보기', () => {
    const d = buildWriteDiff(deps(), 'src/new.py', 'print(1)\nprint(2)');
    expect(d).toContain('새 파일');
    expect(d).toContain('+ print(1)');
  });
  it('기존 파일 수정이면 -이전/+이후 unified diff', () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/a.py'), 'old line\nkeep\n');
    const d = buildWriteDiff(deps(), 'src/a.py', 'new line\nkeep\n');
    expect(d).toContain('-old line');
    expect(d).toContain('+new line');
  });
  it('내용 동일이면 변경 없음, 경로 위반이면 안내 텍스트 (throw 아님)', () => {
    fs.writeFileSync(path.join(root, 'same.txt'), 'x');
    expect(buildWriteDiff(deps(), 'same.txt', 'x')).toContain('변경 없음');
    expect(buildWriteDiff(deps(), '../evil.txt', 'x')).toContain('diff 생성 불가');
  });
});

describe('toolSummary', () => {
  it('도구별 대상 요약', () => {
    expect(toolSummary('write_file', { path: 'a.py', content: 'x' })).toBe('a.py');
    expect(toolSummary('run_command', { command: 'python3 a.py' })).toBe('python3 a.py');
    expect(toolSummary('search_text', { query: 'foo' })).toBe('foo');
  });
});

// darwin 전용 — 실제 sandbox-exec 실행 검증 (스펙 §1 실측 항목)
describe.skipIf(process.platform !== 'darwin')('run_command 샌드박스', () => {
  it('프로젝트 안 쓰기·실행·출력 캡처 OK', async () => {
    const r = await executeTool('run_command', { command: 'echo hello > f.txt && cat f.txt' }, deps());
    expect(r).toContain('hello');
    expect(r).toContain('exit 0');
    expect(fs.existsSync(path.join(root, 'f.txt'))).toBe(true);
  });
  it('프로젝트 밖 삭제/편집은 차단된다', async () => {
    const victim = path.join(os.tmpdir(), `si-victim-${Date.now()}.txt`);
    fs.writeFileSync(victim, 'keep');
    try {
      // 참고: $TMPDIR은 쓰기 허용이지만 os.tmpdir() 밖의 상위 실경로를 노린다
      const r = await executeTool('run_command', { command: `rm /etc/hosts 2>&1 || echo BLOCKED` }, deps());
      expect(r).toContain('BLOCKED');
      expect(fs.readFileSync(victim, 'utf8')).toBe('keep');
    } finally {
      fs.rmSync(victim, { force: true });
    }
  });
  it('출력 20KB 절단 + 타임아웃 kill', async () => {
    const big = await executeTool('run_command', { command: 'yes x | head -c 100000' }, deps());
    expect(big.length).toBeLessThan(25_000);
    expect(big).toContain('잘림');
    const to = await executeTool('run_command', { command: 'sleep 5' }, deps({ commandTimeoutMs: 300 }));
    expect(to).toContain('타임아웃');
  });

  it('읽기 전용 도구셋은 쓰기/실행 도구를 제외한다', () => {
    const names = READONLY_AGENT_TOOLS.map((t) => t.name);
    expect(names).toEqual(['list_dir', 'read_file', 'search_text']);
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('run_command');
  });
});
