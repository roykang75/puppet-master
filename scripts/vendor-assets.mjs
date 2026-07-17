// 벤더링 재현 스크립트 — VS Code 저장소(MIT)와 One Dark Pro(MIT)에서 문법/테마를 받아
// assets에 저장한다. 테마의 include 체인은 병합해 단일 파일로 만든다. (1회성/재현용)
import * as fs from 'fs';
import * as path from 'path';

const VSCODE = 'https://raw.githubusercontent.com/microsoft/vscode/1.101.0';
const GRAMMARS = [
  ['c.tmLanguage.json', `${VSCODE}/extensions/cpp/syntaxes/c.tmLanguage.json`],
  ['cpp.tmLanguage.json', `${VSCODE}/extensions/cpp/syntaxes/cpp.tmLanguage.json`],
  ['python.tmLanguage.json', `${VSCODE}/extensions/python/syntaxes/MagicPython.tmLanguage.json`],
  ['typescript.tmLanguage.json', `${VSCODE}/extensions/typescript-basics/syntaxes/TypeScript.tmLanguage.json`],
  ['javascript.tmLanguage.json', `${VSCODE}/extensions/javascript/syntaxes/JavaScript.tmLanguage.json`],
  ['java.tmLanguage.json', `${VSCODE}/extensions/java/syntaxes/java.tmLanguage.json`],
];
// [저장명, 메인 URL, include 체인 URL(안쪽부터)]
const THEMES = [
  ['dark-plus.json', `${VSCODE}/extensions/theme-defaults/themes/dark_plus.json`, [`${VSCODE}/extensions/theme-defaults/themes/dark_vs.json`]],
  ['light-plus.json', `${VSCODE}/extensions/theme-defaults/themes/light_plus.json`, [`${VSCODE}/extensions/theme-defaults/themes/light_vs.json`]],
  ['monokai.json', `${VSCODE}/extensions/theme-monokai/themes/monokai-color-theme.json`, []],
  ['one-dark-pro.json', 'https://raw.githubusercontent.com/Binaryify/OneDark-Pro/master/themes/OneDark-Pro.json', []],
];

const gDir = 'src/renderer/assets/grammars';
const tDir = 'src/renderer/assets/themes';
fs.mkdirSync(gDir, { recursive: true });
fs.mkdirSync(tDir, { recursive: true });

// VS Code 테마 파일은 JSONC(주석·후행 콤마 허용)라 JSON.parse가 실패한다.
// 문자열 리터럴 내부는 보존하면서 주석과 후행 콤마만 제거한다.
const stripJsonc = (src) => {
  let out = '';
  let inStr = false, esc = false, line = false, block = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (line) { if (c === '\n') { line = false; out += c; } continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    out += c;
  }
  // 후행 콤마 제거: 콤마 뒤 공백 후 } 또는 ]
  return out.replace(/,(\s*[}\]])/g, '$1');
};

const fetchJson = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return JSON.parse(stripJsonc(await r.text()));
};

for (const [name, url] of GRAMMARS) {
  const j = await fetchJson(url);
  fs.writeFileSync(path.join(gDir, name), JSON.stringify(j));
  console.log('grammar', name, j.scopeName);
}

for (const [name, mainUrl, includes] of THEMES) {
  let merged = { colors: {}, tokenColors: [] };
  for (const incUrl of includes) {
    const inc = await fetchJson(incUrl);
    merged.colors = { ...merged.colors, ...(inc.colors ?? {}) };
    merged.tokenColors = [...merged.tokenColors, ...(inc.tokenColors ?? [])];
    merged.type = inc.type ?? merged.type;
  }
  const main = await fetchJson(mainUrl);
  // 병합 결과에 type이 없으면 파일명 기준 보정 (light-plus→light, 그 외→dark)
  const typeByName = name === 'light-plus.json' ? 'light' : 'dark';
  merged = {
    name: main.name ?? name.replace('.json', ''),
    type: main.type ?? merged.type ?? typeByName,
    colors: { ...merged.colors, ...(main.colors ?? {}) },
    tokenColors: [...merged.tokenColors, ...(main.tokenColors ?? [])],
  };
  fs.writeFileSync(path.join(tDir, name), JSON.stringify(merged));
  console.log('theme', name, merged.type, merged.tokenColors.length, 'rules');
}
