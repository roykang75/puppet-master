// 에이전트 도구 — 스키마와 실행기를 한 곳에. electron 임포트 금지 (테스트는 node ABI).
// 파일 도구는 projectRoot+allowedDirs 안만, run_command 쓰기는 sandbox-exec로 루트 이하 강제 (스펙 §1/§3).
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ToolSpec {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] };
}

export interface AgentToolDeps {
  projectRoot: string;
  allowedDirs: string[];
  searchText(query: string): Promise<{ path: string; snippet: string }[]>;
  commandTimeoutMs?: number; // 기본 30초 — 테스트 주입용
}

const OUTPUT_CAP = 20 * 1024; // run_command 출력 절단 (스펙 §3)
const READ_CAP = 100 * 1024; // read_file 절단
const HIDDEN_DIRS = new Set(['.git', 'node_modules']);

export const AGENT_TOOLS: ToolSpec[] = [
  {
    name: 'list_dir',
    description: '디렉터리의 파일/폴더 목록을 본다. path는 프로젝트 루트 상대 경로 (빈 문자열 = 루트).',
    parameters: { type: 'object', properties: { path: { type: 'string', description: '디렉터리 경로' } }, required: [] },
  },
  {
    name: 'read_file',
    description: '파일 내용을 줄번호와 함께 읽는다.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: '파일 경로' } }, required: ['path'] },
  },
  {
    name: 'write_file',
    description: '파일을 생성하거나 전체 내용을 덮어쓴다. 중간 폴더는 자동 생성된다.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '파일 경로' },
        content: { type: 'string', description: '파일 전체 내용' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'search_text',
    description: '프로젝트 전체에서 텍스트를 검색한다 (전문 검색).',
    parameters: { type: 'object', properties: { query: { type: 'string', description: '검색어' } }, required: ['query'] },
  },
  {
    name: 'run_command',
    description:
      '셸 명령을 실행한다 (cwd=프로젝트 루트, 30초 제한). 파일 쓰기/삭제는 프로젝트 안에서만 가능하다.',
    parameters: { type: 'object', properties: { command: { type: 'string', description: '셸 명령' } }, required: ['command'] },
  },
];

/** 상대 경로는 루트 기준, 절대 경로는 루트/allowedDirs 안만 허용. 탈출은 throw. */
export function resolveToolPath(deps: AgentToolDeps, p: string): string {
  const roots = [path.resolve(deps.projectRoot), ...deps.allowedDirs.map((d) => path.resolve(d))];
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(deps.projectRoot, p);
  for (const r of roots) {
    if (abs === r || abs.startsWith(r + path.sep)) return abs;
  }
  throw new Error(`허용된 디렉터리 밖 경로: ${p}`);
}

/** 카드 표시용 대상 요약 */
export function toolSummary(name: string, args: Record<string, unknown>): string {
  if (name === 'run_command') return String(args.command ?? '');
  if (name === 'search_text') return String(args.query ?? '');
  return String(args.path ?? '');
}

/** sandbox-exec 프로파일 — 쓰기는 루트+$TMPDIR+/dev/null만 (스펙 §1 실측 검증 형태) */
export function sandboxProfile(root: string): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const tmp = fs.realpathSync(os.tmpdir());
  return (
    '(version 1)(allow default)(deny file-write*)' +
    `(allow file-write* (subpath "${esc(fs.realpathSync(path.resolve(root)))}"))` +
    `(allow file-write* (subpath "${esc(tmp)}"))` +
    '(allow file-write-data (literal "/dev/null"))'
  );
}

function runCommand(command: string, deps: AgentToolDeps): Promise<string> {
  const timeout = deps.commandTimeoutMs ?? 30_000;
  return new Promise((resolve) => {
    const child = spawn('sandbox-exec', ['-p', sandboxProfile(deps.projectRoot), '/bin/zsh', '-c', command], {
      cwd: deps.projectRoot,
    });
    let out = '';
    let truncated = false;
    let timedOut = false;
    const cap = (d: Buffer) => {
      if (out.length < OUTPUT_CAP) out += d.toString();
      if (out.length >= OUTPUT_CAP) {
        out = out.slice(0, OUTPUT_CAP);
        truncated = true;
      }
    };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve(`오류: 명령 실행 실패 (${e.message})`);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const parts = [out.trimEnd()];
      if (truncated) parts.push('…(출력 잘림)');
      if (timedOut) parts.push(`(타임아웃 ${timeout}ms — 강제 종료)`);
      else parts.push(`exit ${code ?? -1}`);
      resolve(parts.filter(Boolean).join('\n'));
    });
  });
}

/** 도구 실행 — 실패도 오류 텍스트로 반환 (모델이 tool result로 받아 스스로 복구, 스펙 §4) */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  deps: AgentToolDeps,
): Promise<string> {
  try {
    switch (name) {
      case 'list_dir': {
        const abs = resolveToolPath(deps, String(args.path ?? ''));
        const entries = fs
          .readdirSync(abs, { withFileTypes: true })
          .filter((e) => !HIDDEN_DIRS.has(e.name))
          .sort((a, b) => (a.isDirectory() !== b.isDirectory() ? (a.isDirectory() ? -1 : 1) : a.name.localeCompare(b.name)));
        return entries.map((e) => `${e.isDirectory() ? '[dir]' : '[file]'} ${e.name}`).join('\n') || '(빈 디렉터리)';
      }
      case 'read_file': {
        const abs = resolveToolPath(deps, String(args.path ?? ''));
        let text = fs.readFileSync(abs, 'utf8');
        let note = '';
        if (text.length > READ_CAP) {
          text = text.slice(0, READ_CAP);
          note = '\n…(잘림)';
        }
        return text.split('\n').map((l, i) => `${i + 1}\t${l}`).join('\n') + note;
      }
      case 'write_file': {
        const abs = resolveToolPath(deps, String(args.path ?? ''));
        const content = String(args.content ?? '');
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
        return `작성 완료: ${args.path} (${Buffer.byteLength(content)} bytes)`;
      }
      case 'search_text': {
        const hits = await deps.searchText(String(args.query ?? ''));
        if (hits.length === 0) return '(검색 결과 없음)';
        return hits.map((h) => `${h.path}: ${h.snippet}`).join('\n');
      }
      case 'run_command':
        return await runCommand(String(args.command ?? ''), deps);
      default:
        return `오류: 알 수 없는 도구 '${name}'`;
    }
  } catch (e) {
    return `오류: ${e instanceof Error ? e.message : String(e)}`;
  }
}
