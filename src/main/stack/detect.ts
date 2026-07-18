// 프로젝트 스택 감지 — 순수 모듈 (electron 임포트 금지, node ABI 테스트).
import type { ProjectStack } from '../../shared/protocol';

export const MAX_LIBRARIES = 20;

const EXT_LANG: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript',
  py: 'Python', go: 'Go', java: 'Java', kt: 'Kotlin', rb: 'Ruby', rs: 'Rust', php: 'PHP',
  c: 'C', h: 'C', cpp: 'C++', cc: 'C++', hpp: 'C++', cs: 'C#', css: 'CSS', scss: 'CSS', html: 'HTML',
};

type Lib = { name: string; version?: string };

function base(p: string): string {
  return p.split('/').pop() ?? p;
}

function parsePackageJson(content: string): Lib[] {
  try {
    const j = JSON.parse(content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return [
      ...Object.entries(j.dependencies ?? {}),
      ...Object.entries(j.devDependencies ?? {}),
    ].map(([name, version]) => ({ name, version }));
  } catch {
    return [];
  }
}

function parseRequirements(content: string): Lib[] {
  const out: Lib[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;
    const m = line.match(/^([A-Za-z0-9._-]+)\s*(?:[=<>!~]=?\s*([A-Za-z0-9._*-]+))?/);
    if (m) out.push({ name: m[1], version: m[2] });
  }
  return out;
}

function parseGoMod(content: string): Lib[] {
  const out: Lib[] = [];
  // require ( ... ) 블록 및 단일 require 라인
  const re = /^\s*(?:require\s+)?([\w./-]+\.[\w./-]+\/[\w./-]+|[\w.-]+\.[\w-]+\/[\w./-]+)\s+(v[\w.\-+]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) out.push({ name: m[1], version: m[2] });
  return out;
}

function parsePomXml(content: string): Lib[] {
  const out: Lib[] = [];
  const re = /<dependency>([\s\S]*?)<\/dependency>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const body = m[1];
    const g = body.match(/<groupId>\s*([^<]+?)\s*<\/groupId>/);
    const a = body.match(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/);
    const v = body.match(/<version>\s*([^<]+?)\s*<\/version>/);
    if (g && a) out.push({ name: `${g[1]}:${a[1]}`, version: v?.[1] });
  }
  return out;
}

function parseGradle(content: string): Lib[] {
  const out: Lib[] = [];
  // implementation 'group:artifact:version' 또는 "..."
  const re = /(?:implementation|api|compile|testImplementation)\s*[('"]+\s*([\w.-]+):([\w.-]+):([\w.\-+]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) out.push({ name: `${m[1]}:${m[2]}`, version: m[3] });
  return out;
}

function parsePyproject(content: string): Lib[] {
  const out: Lib[] = [];
  // [project] dependencies = ["flask>=3", ...] 및 poetry [tool.poetry.dependencies]
  const arr = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (arr) {
    for (const q of arr[1].match(/["']([^"']+)["']/g) ?? []) {
      const dep = q.slice(1, -1);
      const m = dep.match(/^([A-Za-z0-9._-]+)\s*(?:[=<>!~]=?\s*([A-Za-z0-9._*-]+))?/);
      if (m) out.push({ name: m[1], version: m[2] });
    }
  }
  // [tool.poetry.dependencies] 테이블형: name = "version" 또는 name = { version = "...", ... }
  let inPoetrySection = false;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) {
      inPoetrySection = line === '[tool.poetry.dependencies]';
      continue;
    }
    if (!inPoetrySection || !line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9._-]+)\s*=\s*(.+)$/);
    if (!m) continue;
    const name = m[1];
    if (name === 'python') continue;
    const rest = m[2].trim();
    const simple = rest.match(/^["']([^"']+)["']/);
    const inline = rest.match(/version\s*=\s*["']([^"']+)["']/);
    const version = simple?.[1] ?? inline?.[1];
    out.push({ name, version });
  }
  return out;
}

/** 매니페스트 파일들과 소스 확장자로 언어·라이브러리를 감지한다. 실패한 파서는 스킵(부분 결과). */
export function detectStack(files: { path: string; content: string }[]): ProjectStack {
  const libs: Lib[] = [];
  const extCount = new Map<string, number>();
  for (const f of files) {
    const name = base(f.path).toLowerCase();
    if (name === 'package.json') libs.push(...parsePackageJson(f.content));
    else if (name === 'requirements.txt') libs.push(...parseRequirements(f.content));
    else if (name === 'pyproject.toml') libs.push(...parsePyproject(f.content));
    else if (name === 'go.mod') libs.push(...parseGoMod(f.content));
    else if (name === 'pom.xml') libs.push(...parsePomXml(f.content));
    else if (name === 'build.gradle' || name === 'build.gradle.kts') libs.push(...parseGradle(f.content));
    const ext = name.includes('.') ? name.split('.').pop()! : '';
    const lang = EXT_LANG[ext];
    if (lang) extCount.set(lang, (extCount.get(lang) ?? 0) + 1);
  }
  // 중복 제거(첫 등장 우선) + 상한
  const seen = new Set<string>();
  const libraries: Lib[] = [];
  for (const l of libs) {
    if (seen.has(l.name)) continue;
    seen.add(l.name);
    libraries.push(l);
    if (libraries.length >= MAX_LIBRARIES) break;
  }
  const languages = [...extCount.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
  return { languages, libraries };
}
