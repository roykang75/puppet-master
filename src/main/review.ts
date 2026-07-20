// src/main/review.ts — 변경 리뷰 센터의 변경 수집 (Plan 22). electron 임포트 금지 (테스트는 node ABI).
//   "리뷰 베이스라인"(마지막으로 확인한 커밋) 이후의 누적 변경(커밋+스테이지+워킹트리+미추적)을
//   심볼 단위 리뷰로 보여주기 위한 순수 git 로직. 스타일은 agent/worktree.ts를 따른다.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { parseGitDiff } from './git-diff';
import type { ReviewCommit, ReviewChangedFile, ReviewFileDiff } from '../shared/protocol';

const MAX_DIFF_BYTES = 2 * 1024 * 1024; // 2MB 초과 파일은 바이너리 취급 — 심볼 매핑 생략

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
}

/** git log 출력(`%H\0%s\0%ct` 줄 단위) → 커밋 목록. 순수 함수(테스트 가능). */
export function parseGitLog(raw: string): ReviewCommit[] {
  const out: ReviewCommit[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const [hash, subject, ct] = line.split('\x00');
    if (!hash) continue;
    out.push({ hash, subject: subject ?? '', timestamp: parseInt(ct ?? '0', 10) || 0 });
  }
  return out;
}

/** `git diff --name-status -z <base>` 출력 파싱. rename(R)/copy(C)는 D 옛경로 + A 새경로로 단순화. 순수 함수. */
export function parseNameStatus(raw: string): ReviewChangedFile[] {
  const parts = raw.split('\0');
  const out: ReviewChangedFile[] = [];
  let i = 0;
  while (i < parts.length) {
    const status = parts[i];
    if (!status) break;
    if (status[0] === 'R' || status[0] === 'C') {
      const oldPath = parts[i + 1];
      const newPath = parts[i + 2];
      i += 3;
      if (oldPath) out.push({ path: oldPath, status: 'D' });
      if (newPath) out.push({ path: newPath, status: 'A' });
    } else {
      const p = parts[i + 1];
      i += 2;
      if (!p) continue;
      const s: ReviewChangedFile['status'] = status[0] === 'A' ? 'A' : status[0] === 'D' ? 'D' : 'M';
      out.push({ path: p, status: s });
    }
  }
  return out;
}

/** 현재 HEAD 커밋 해시. 커밋이 없거나 비-git이면 null. */
export function headHash(root: string): string | null {
  try {
    return git(root, ['rev-parse', 'HEAD']).trim() || null;
  } catch {
    return null;
  }
}

/** ref가 유효한 커밋인가 (리베이스 등으로 사라진 베이스라인 감지). */
export function isValidRef(root: string, ref: string): boolean {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** 최근 커밋 목록 (최신 우선). 오류 시 []. */
export function listRecentCommits(root: string, limit = 50): ReviewCommit[] {
  try {
    return parseGitLog(git(root, ['log', `--format=%H%x00%s%x00%ct`, '-n', String(limit)]));
  } catch {
    return [];
  }
}

/** baseline..HEAD 범위 커밋 (최신 우선). baseline 무효/오류면 [] (호출측이 HEAD 폴백). */
export function listCommitsSince(root: string, baseline: string): ReviewCommit[] {
  try {
    return parseGitLog(git(root, ['log', `--format=%H%x00%s%x00%ct`, `${baseline}..HEAD`]));
  } catch {
    return [];
  }
}

/** 커밋의 부모 범위 표기. 최초 커밋은 부모가 없어 빈 트리 해시를 쓴다(git이 보장하는 상수). */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
function parentRef(root: string, hash: string): string {
  return isValidRef(root, `${hash}^`) ? `${hash}^` : EMPTY_TREE;
}

/** 커밋 하나가 바꾼 파일 (부모↔해당 커밋). 워킹트리/미추적은 포함하지 않는다. */
export function changedFilesInCommit(root: string, hash: string): ReviewChangedFile[] {
  try {
    return parseNameStatus(git(root, ['diff', '--name-status', '-z', parentRef(root, hash), hash]));
  } catch {
    return [];
  }
}

/** 커밋 하나에서의 rel 파일 diff (부모↔해당 커밋). 양쪽 모두 커밋에서 읽는다. */
export function fileDiffInCommit(root: string, rel: string, hash: string): ReviewFileDiff {
  const parent = parentRef(root, hash);
  const show = (ref: string): string => {
    try {
      return git(root, ['show', `${ref}:${rel}`]);
    } catch {
      return ''; // 해당 쪽에 없던 파일 (추가/삭제)
    }
  };
  const before = parent === EMPTY_TREE ? '' : show(parent);
  const after = show(hash);
  if (before.length > MAX_DIFF_BYTES || after.length > MAX_DIFF_BYTES) {
    return { binary: true, before: '', after: '', hunks: [] };
  }
  let hunks = [] as ReviewFileDiff['hunks'];
  try {
    hunks = parseGitDiff(git(root, ['--no-pager', 'diff', '--no-color', '--unified=0', parent, hash, '--', rel]));
  } catch {
    hunks = [];
  }
  return { binary: false, before, after, hunks };
}

/** baseline 이후 누적 변경 파일 = tracked diff(커밋+스테이지+워킹트리) ∪ untracked(??). */
export function changedFilesSince(root: string, baseline: string): ReviewChangedFile[] {
  const byPath = new Map<string, ReviewChangedFile>();
  try {
    // baseline↔워킹트리 (--name-status, HEAD/인덱스 미지정 → 워킹트리까지 포함)
    for (const c of parseNameStatus(git(root, ['diff', '--name-status', '-z', baseline]))) {
      byPath.set(c.path, c);
    }
  } catch {
    // 무효 baseline 등 — untracked만이라도 반환
  }
  try {
    // untracked (?? 만) — .gitignore는 git이 알아서 제외
    const raw = git(root, ['status', '--porcelain', '-z']);
    const parts = raw.split('\0');
    for (const p of parts) {
      if (!p) continue;
      if (p.slice(0, 2) === '??') {
        const rel = p.slice(3);
        if (rel && !byPath.has(rel)) byPath.set(rel, { path: rel, status: 'A' });
      }
    }
  } catch {
    // 무시
  }
  return [...byPath.values()];
}

/** rel 파일의 baseline↔워킹트리 diff. before=`git show <baseline>:<rel>`, after=워킹트리 읽기.
 *  바이너리/2MB 초과는 {binary:true}로 표시하고 내용/헝크 생략. */
export function fileDiffSince(root: string, rel: string, baseline: string): ReviewFileDiff {
  let before = '';
  try {
    before = git(root, ['show', `${baseline}:${rel}`]);
  } catch {
    before = ''; // baseline에 없던 파일 (추가)
  }
  let after = '';
  const abs = path.join(root, rel);
  try {
    const st = fs.statSync(abs);
    if (st.isFile()) {
      if (st.size > MAX_DIFF_BYTES) return { binary: true, before: '', after: '', hunks: [] };
      const buf = fs.readFileSync(abs);
      if (buf.includes(0)) return { binary: true, before: '', after: '', hunks: [] }; // NUL → 바이너리
      after = buf.toString('utf8');
    }
  } catch {
    after = ''; // 삭제된 파일
  }
  if (before.length > MAX_DIFF_BYTES) return { binary: true, before: '', after: '', hunks: [] };

  let hunks = [] as ReviewFileDiff['hunks'];
  try {
    const diff = git(root, ['--no-pager', 'diff', '--no-color', '--unified=0', baseline, '--', rel]);
    hunks = parseGitDiff(diff);
  } catch {
    hunks = [];
  }
  // untracked(baseline에 없고 git diff가 비는 경우) → 전체 추가로 단순 처리
  if (hunks.length === 0 && before === '' && after !== '') {
    const n = after.split('\n').length;
    hunks = [{ startLine: 1, endLine: n, type: 'add' }];
  }
  return { binary: false, before, after, hunks };
}
