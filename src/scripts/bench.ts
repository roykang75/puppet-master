import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openDb } from '../indexer/db';
import { Indexer } from '../indexer/pipeline';

const target = process.argv[2];
if (!target || !fs.existsSync(target)) {
  console.error('사용법: npm run bench -- <프로젝트 디렉토리>');
  process.exit(1);
}

const dbPath = path.join(os.tmpdir(), `si-bench-${Date.now()}.db`);
const db = openDb(dbPath);
const idx = new Indexer(db, path.resolve(target));

const t0 = Date.now();
let lastPct = -1;
const stats = idx.indexProject((done, total) => {
  const pct = Math.floor((done / total) * 10) * 10;
  if (pct !== lastPct) {
    lastPct = pct;
    process.stdout.write(`\r인덱싱 ${pct}% (${done}/${total})`);
  }
});
const elapsed = (Date.now() - t0) / 1000;

const lines = (db.prepare(`SELECT sum(length(content) - length(replace(content, char(10), '')) + 1) n FROM file_text`).get() as { n: number }).n;
console.log(`\n완료: ${elapsed.toFixed(1)}s`);
console.log(`파일 ${stats.files} (스킵 ${stats.skipped}) / 라인 ${lines} / 심볼 ${stats.symbols} / 참조 ${stats.refs}`);
console.log(`DB: ${dbPath} (${(fs.statSync(dbPath).size / 1024 / 1024).toFixed(1)}MB)`);
