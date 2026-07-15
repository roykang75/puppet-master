import { describe, it, expect } from 'vitest';
import { splitName } from '../src/indexer/fragments';

describe('splitName', () => {
  it('splits camelCase', () => {
    expect(splitName('CreateWindow')).toEqual(['create', 'window']);
  });
  it('splits snake_case', () => {
    expect(splitName('create_widget_ex')).toEqual(['create', 'widget', 'ex']);
  });
  it('handles consecutive capitals', () => {
    expect(splitName('parseHTMLDocument')).toEqual(['parse', 'html', 'document']);
  });
  it('drops 1-char fragments and dedups', () => {
    expect(splitName('a_map_map')).toEqual(['map']);
  });
  it('returns [] for empty', () => {
    expect(splitName('')).toEqual([]);
  });
});
