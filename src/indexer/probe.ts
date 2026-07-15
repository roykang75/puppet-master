// Electron utilityProcess에서 실행되어 네이티브 모듈 로드 가능 여부를 보고한다.
try {
  const Parser = require('tree-sitter');
  const C = require('tree-sitter-c');
  const Database = require('better-sqlite3');
  const p = new Parser();
  p.setLanguage(C);
  p.parse('int x;');
  new Database(':memory:').exec('CREATE TABLE t (x)');
  process.parentPort.postMessage({ ok: true });
} catch (e) {
  process.parentPort.postMessage({ ok: false, error: String(e) });
}
