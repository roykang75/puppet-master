import { describe, it, expect } from 'vitest';

describe('native modules', () => {
  it('parses C with tree-sitter native binding', () => {
    const Parser = require('tree-sitter');
    const C = require('tree-sitter-c');
    const parser = new Parser();
    parser.setLanguage(C);
    const tree = parser.parse('int main() { return 0; }');
    expect(tree.rootNode.type).toBe('translation_unit');
  });

  it('loads all six grammars', () => {
    const Parser = require('tree-sitter');
    const grammars = [
      require('tree-sitter-c'),
      require('tree-sitter-cpp'),
      require('tree-sitter-python'),
      require('tree-sitter-typescript').typescript,
      require('tree-sitter-typescript').tsx,
      require('tree-sitter-java'),
    ];
    for (const g of grammars) {
      const p = new Parser();
      expect(() => p.setLanguage(g)).not.toThrow();
    }
  });

  it('opens an in-memory sqlite db', () => {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t (x)');
    db.prepare('INSERT INTO t VALUES (?)').run(42);
    expect(db.prepare('SELECT x FROM t').get()).toEqual({ x: 42 });
  });
});
