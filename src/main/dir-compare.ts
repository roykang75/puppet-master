// 디렉터리 비교 — 두 디렉터리를 재귀 비교. 동일 파일 제외, .git/node_modules 스킵.
import * as fs from 'fs';
import * as path from 'path';
import type { DirCompareEntry } from '../shared/protocol';

const SKIP = new Set(['.git', 'node_modules']);

function walk(base: string, sub = ''): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(base, sub), { withFileTypes: true });
  } catch {
    return out; // 없는 디렉터리 등 — 빈 목록
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(base, rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

function sameContent(a: string, b: string): boolean {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

/** 두 디렉터리(절대경로) 재귀 비교. 동일 파일 제외, relPath 오름차순. */
export function compareDirs(leftAbs: string, rightAbs: string): DirCompareEntry[] {
  const left = new Set(walk(leftAbs));
  const right = new Set(walk(rightAbs));
  const out: DirCompareEntry[] = [];
  for (const rel of new Set([...left, ...right])) {
    const inL = left.has(rel);
    const inR = right.has(rel);
    if (inL && !inR) out.push({ relPath: rel, status: 'left-only' });
    else if (!inL && inR) out.push({ relPath: rel, status: 'right-only' });
    else if (!sameContent(path.join(leftAbs, rel), path.join(rightAbs, rel)))
      out.push({ relPath: rel, status: 'different' });
    // 동일 → 제외
  }
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}
