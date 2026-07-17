// 에이전트 도구 — 스키마와 실행기를 한 곳에. electron 임포트 금지 (테스트는 node ABI).
// 파일 도구는 projectRoot+allowedDirs 안만, run_command 쓰기는 sandbox-exec로 루트 이하 강제 (스펙 §1/§3).
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createTwoFilesPatch } from 'diff';

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

/** 존재하는 가장 가까운 조상 경로를 realpath로 해석한다 (심링크 해소, 신규 파일은 조상까지만). */
function realpathOfClosestAncestor(p: string): string {
  let cur = p;
  for (;;) {
    try {
      return fs.realpathSync(cur);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return cur; // 파일시스템 루트 — 더 못 올라감
      cur = parent;
    }
  }
}

/**
 * 상대 경로는 루트 기준, 절대 경로는 루트/allowedDirs 안만 허용. 탈출은 throw.
 * 심링크로 허용 영역 밖을 가리키는 것도 막기 위해, 대상의 실경로(존재하는 가장 가까운 조상 기준)를
 * realpath로 정규화한 허용 루트들과 비교한다 (macOS /tmp→/private/tmp 등 시스템 심링크 대응 포함).
 */
export function resolveToolPath(deps: AgentToolDeps, p: string): string {
  const roots = [path.resolve(deps.projectRoot), ...deps.allowedDirs.map((d) => path.resolve(d))].map(
    (r) => realpathOfClosestAncestor(r),
  );
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(deps.projectRoot, p);
  const real = realpathOfClosestAncestor(abs);
  for (const r of roots) {
    if (real === r || real.startsWith(r + path.sep)) return abs;
  }
  throw new Error(`허용된 디렉터리 밖 경로: ${p}`);
}

const DIFF_CAP = 8 * 1024; // write_file diff 미리보기 절단
export const DIFF_SOURCE_CAP = 100 * 1024; // 에디터 diff 뷰용 원문 상한 — 초과 시 뷰 생략

/** write_file 대상의 현재 내용 — 에디터 diff 뷰용. 허용 경로 밖/미존재/상한 초과면 null */
export function readCurrentContent(deps: AgentToolDeps, rel: string): string | null {
  try {
    const abs = resolveToolPath(deps, rel);
    if (!fs.existsSync(abs)) return '';
    const text = fs.readFileSync(abs, 'utf8');
    return text.length > DIFF_SOURCE_CAP ? null : text;
  } catch {
    return null;
  }
}

/** write_file 승인/기록용 diff — 실패해도 안내 텍스트 반환 (throw 금지, 카드 detail용) */
export function buildWriteDiff(deps: AgentToolDeps, rel: string, content: string): string {
  try {
    const abs = resolveToolPath(deps, rel);
    if (!fs.existsSync(abs)) {
      const preview = content.split('\n').map((l) => `+ ${l}`).join('\n');
      const cut = preview.length > DIFF_CAP ? preview.slice(0, DIFF_CAP) + '\n…(잘림)' : preview;
      return `새 파일 (+${content.split('\n').length}줄)\n${cut}`;
    }
    const before = fs.readFileSync(abs, 'utf8');
    if (before === content) return '(변경 없음)';
    // 헤더 4줄(Index/===/---/+++)을 떼고 hunk만 표시
    let patch = createTwoFilesPatch(rel, rel, before, content).split('\n').slice(4).join('\n').trimEnd();
    if (patch.length > DIFF_CAP) patch = patch.slice(0, DIFF_CAP) + '\n…(잘림)';
    return patch;
  } catch (e) {
    return `(diff 생성 불가: ${e instanceof Error ? e.message : String(e)})`;
  }
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
