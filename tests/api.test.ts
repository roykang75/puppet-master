import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { openDb } from '../src/indexer/db';
import { Indexer } from '../src/indexer/pipeline';
import { searchSymbols, searchText, getDefinitions, getSymbolsForFile, getCallers, getCallees } from '../src/indexer/api';

const FIXTURE = path.join(__dirname, 'fixtures', 'sample');
let db: ReturnType<typeof openDb>;

beforeAll(() => {
  db = openDb(':memory:');
  new Indexer(db, FIXTURE).indexProject();
});

describe('searchSymbols', () => {
  it('matches by partial fragments (SI Name Fragment 방식)', () => {
    const hits = searchSymbols(db, 'crea wid');
    expect(hits.some((h) => h.name === 'create_widget')).toBe(true);
  });
  it('returns empty for no match', () => {
    expect(searchSymbols(db, 'zzqq')).toEqual([]);
  });
});

describe('searchText', () => {
  it('finds full-text matches with snippet', () => {
    const hits = searchText(db, 'unique_needle_string');
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe('app.ts');
    expect(hits[0].snippet).toContain('unique_needle_string');
  });
});

describe('definitions / file symbols', () => {
  it('getDefinitions returns the function def', () => {
    const defs = getDefinitions(db, 'create_widget');
    expect(defs.some((d) => d.path === 'util.c' && d.kind === 'function')).toBe(true);
  });
  it('getSymbolsForFile lists symbols of one file', () => {
    const syms = getSymbolsForFile(db, 'main.c');
    expect(syms.some((s) => s.name === 'main')).toBe(true);
  });
});

describe('call graph', () => {
  it('getCallers(create_widget) includes main', () => {
    const callers = getCallers(db, 'create_widget');
    expect(callers.some((c) => c.callerName === 'main' && c.path === 'main.c')).toBe(true);
  });
  it('getCallees(main) includes create_widget definition', () => {
    const mainDef = getDefinitions(db, 'main')[0];
    const callees = getCallees(db, mainDef.id);
    expect(callees.some((c) => c.name === 'create_widget')).toBe(true);
  });
});
