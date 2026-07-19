// src/main/agent/worktree.ts — 에이전트 격리(worktree 샌드박스) 로직. electron 임포트 금지 (테스트는 node ABI).
// Orca "Parallel Worktrees" 차용 2탄 — 단일 에이전트에 맞춘 v1.
//   에이전트가 프로젝트 밖 git worktree에서 작업 → 사용자가 리뷰 후 적용/폐기.
// v1 스코프 아웃: 병렬 worktree 다중, 브랜치/커밋 생성, 3-way 병합(적용=파일 복사·마지막 승리 —
//   diff 리뷰가 안전장치), 인덱서의 wt 신규 파일 인식.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const MAX_SYNC_FILES = 500; // dirty 동기화 파일 수 상한
const MAX_SYNC_BYTES = 2 * 1024 * 1024; // 파일당 크기 상한 (2MB)

export interface WorktreeChange {
  path: string; // 저장소 루트 기준 상대경로
  status: 'M' | 'A' | 'D';
}

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
}

/** root가 git 워킹트리 안인가. git 없음/비-repo/오류는 false. */
export function isGitRepo(root: string): boolean {
  try {
    return git(root, ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
}

/** `git status --porcelain -z` 엔트리 파싱. rename/copy는 새 경로만 취하고 old 경로 필드는 건너뛴다. */
function parsePorcelainZ(raw: string): { status: string; path: string }[] {
  const parts = raw.split('\0');
  const out: { status: string; path: string }[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const status = p.slice(0, 2);
    const rel = p.slice(3);
    // R(이름변경)/C(복사)는 다음 필드가 원본 경로 — 건너뛴다
    if (status[0] === 'R' || status[0] === 'C') i++;
    out.push({ status, path: rel });
  }
  return out;
}

/** 원본 워킹트리의 dirty 변경을 wt로 미러링. 존재하면 복사(M/A/??), 삭제됐으면 wt에서 제거(D).
 *  상한 초과(파일 수 500 / 파일당 2MB)는 스킵하고 목록 반환. */
function syncDirty(root: string, wtDir: string): string[] {
  const raw = git(root, ['status', '--porcelain', '-z']);
  const entries = parsePorcelainZ(raw);
  const skipped: string[] = [];
  let count = 0;
  for (const e of entries) {
    count++;
    if (count > MAX_SYNC_FILES) {
      skipped.push(e.path);
      continue;
    }
    const src = path.join(root, e.path);
    const dst = path.join(wtDir, e.path);
    let st: fs.Stats | null = null;
    try {
      st = fs.statSync(src);
    } catch {
      st = null;
    }
    if (st && st.isFile()) {
      if (st.size > MAX_SYNC_BYTES) {
        skipped.push(e.path);
        continue;
      }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    } else if (!st) {
      // 원본에서 삭제됨 → wt에서도 제거
      try {
        fs.rmSync(dst, { force: true });
      } catch {
        // wt에 없으면 무시
      }
    }
    // st이 디렉터리(예: 미추적 서브모듈)면 조용히 스킵
  }
  return skipped;
}

/** baseDir/agent-wt가 root의 유효한 worktree면 재사용, 아니면 새로 만든다. 생성/재사용 직후 dirty 동기화.
 *  실패는 throw (호출측이 오류 표시 — 직접 모드 묵시 폴백 금지). 반환: { dir, skipped }. */
export function ensureWorktree(root: string, baseDir: string): { dir: string; skipped: string[] } {
  const wtDir = path.join(baseDir, 'agent-wt');
  let valid = false;
  if (fs.existsSync(wtDir)) {
    try {
      // root에 등록된 worktree 목록에 wtDir이 있는가 (realpath 비교 — /tmp→/private/tmp 등 대응)
      const list = git(root, ['worktree', 'list', '--porcelain']);
      const real = fs.realpathSync(wtDir);
      valid = list
        .split('\n')
        .filter((l) => l.startsWith('worktree '))
        .some((l) => {
          try {
            return fs.realpathSync(l.slice('worktree '.length)) === real;
          } catch {
            return false;
          }
        });
    } catch {
      valid = false;
    }
  }
  if (!valid) {
    // 유효하지 않은 잔재 디렉터리는 제거 후 재생성 (prune으로 등록 정리)
    if (fs.existsSync(wtDir)) {
      fs.rmSync(wtDir, { recursive: true, force: true });
      try {
        git(root, ['worktree', 'prune']);
      } catch {
        // prune 실패는 무시
      }
    }
    fs.mkdirSync(baseDir, { recursive: true });
    git(root, ['worktree', 'add', '--detach', wtDir, 'HEAD']);
  }
  const skipped = syncDirty(root, wtDir);
  return { dir: wtDir, skipped };
}

/** wt의 HEAD 대비 변경 목록. 미추적='A', 삭제='D', 그 외='M'. */
export function worktreeChanges(wtDir: string): WorktreeChange[] {
  const raw = git(wtDir, ['status', '--porcelain', '-z']);
  const entries = parsePorcelainZ(raw);
  return entries.map((e) => {
    let status: WorktreeChange['status'];
    if (e.status === '??') status = 'A';
    else if (e.status.includes('D')) status = 'D';
    else if (e.status[0] === 'A') status = 'A';
    else status = 'M';
    return { path: e.path, status };
  });
}

/** wt의 변경을 원본으로 반영(A/M=복사, D=삭제) 후 worktree 폐기. paths 지정 시 그 파일만. 적용된 경로 목록 반환. */
export function applyWorktree(root: string, wtDir: string, paths?: string[]): string[] {
  const pick = paths ? new Set(paths) : null;
  const changes = worktreeChanges(wtDir).filter((c) => !pick || pick.has(c.path));
  const applied: string[] = [];
  for (const c of changes) {
    const dst = path.join(root, c.path);
    if (c.status === 'D') {
      fs.rmSync(dst, { force: true });
    } else {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(wtDir, c.path), dst);
    }
    applied.push(c.path);
  }
  discardWorktree(root, wtDir);
  return applied;
}

/** worktree 제거 + prune. 이미 없으면 조용히 무시. */
export function discardWorktree(root: string, wtDir: string): void {
  try {
    git(root, ['worktree', 'remove', '--force', wtDir]);
  } catch {
    // 미등록/이미 제거됨 — 무시
  }
  try {
    git(root, ['worktree', 'prune']);
  } catch {
    // 무시
  }
  try {
    if (fs.existsSync(wtDir)) fs.rmSync(wtDir, { recursive: true, force: true });
  } catch {
    // 무시
  }
}
