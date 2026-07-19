// 리비전 마크 — git HEAD 대비 워킹트리(디스크) 변경 라인 범위. 비-git/미추적/오류는 조용히 [].
import { execFile } from 'child_process';
import type { GitChangeRange } from '../shared/protocol';

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** `git diff -U0` 출력 → 변경 라인 범위(1-based). 순수 함수(테스트 가능). */
export function parseGitDiff(diff: string): GitChangeRange[] {
  const out: GitChangeRange[] = [];
  for (const line of diff.split('\n')) {
    const m = HUNK_RE.exec(line);
    if (!m) continue;
    const oldCount = m[2] === undefined ? 1 : parseInt(m[2], 10);
    const newStart = parseInt(m[3], 10);
    const newCount = m[4] === undefined ? 1 : parseInt(m[4], 10);
    if (newCount === 0) {
      // 순수 삭제 — 새 파일엔 라인이 없음. newStart 다음(또는 상단이면 1행)에 삭제 마커.
      const anchor = Math.max(1, newStart);
      out.push({ startLine: anchor, endLine: anchor, type: 'delete' });
    } else if (oldCount === 0) {
      out.push({ startLine: newStart, endLine: newStart + newCount - 1, type: 'add' });
    } else {
      out.push({ startLine: newStart, endLine: newStart + newCount - 1, type: 'modify' });
    }
  }
  return out;
}

/** root 저장소에서 relPath의 HEAD 대비 변경 범위. 비-git/미추적/오류 → []. */
export function getFileChanges(root: string, relPath: string): Promise<GitChangeRange[]> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['--no-pager', 'diff', '--no-color', '--unified=0', 'HEAD', '--', relPath],
      { cwd: root, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        // git 없음/비-repo/미추적(diff 대상 아님) 등 → 조용히 빈 결과
        if (err && !stdout) return resolve([]);
        resolve(parseGitDiff(stdout));
      },
    );
  });
}
