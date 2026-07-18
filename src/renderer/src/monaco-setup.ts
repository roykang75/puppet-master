import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    return new editorWorker();
  },
};

// 내장 TS/JS 워커의 진단(마커)은 브라우저 안에서 "열린 파일 하나"만 보는 언어서비스라
// 프로젝트 node_modules/tsconfig를 몰라 모든 import를 "Cannot find module"로 표시한다 —
// 코드는 정상인데 에디터만 빨갛게 보이는 원인. 실제 진단은 LSP(tsgo/pyright)가 담당하므로
// 내장 진단만 끈다. completion/hover 등 워커의 다른 기능과 JSON/CSS/HTML 진단은 그대로 유지된다.
// monaco-editor ESM에서 languages.typescript 타입이 deprecated 스텁으로 잡혀(런타임 API는 존재) 캐스트한다.
type TsDefaults = { setDiagnosticsOptions(o: { noSemanticValidation?: boolean; noSyntaxValidation?: boolean }): void };
const tsLang = (monaco.languages as unknown as {
  typescript?: { typescriptDefaults: TsDefaults; javascriptDefaults: TsDefaults };
}).typescript;
const noDiag = { noSemanticValidation: true, noSyntaxValidation: true };
tsLang?.typescriptDefaults.setDiagnosticsOptions(noDiag);
tsLang?.javascriptDefaults.setDiagnosticsOptions(noDiag);

export { monaco };
