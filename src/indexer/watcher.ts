import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as path from 'path';
import { languageForPath } from './languages';
import { createIgnoreFilter } from '../shared/ignore';

export interface WatchHandlers {
  onChangeOrAdd(absPath: string): void;
  onRemove(absPath: string): void;
}

export function watchProject(root: string, handlers: WatchHandlers): { close(): Promise<void> } {
  const filter = createIgnoreFilter(root);
  const toRel = (p: string) => path.relative(root, p).split(path.sep).join('/');
  const watcher = chokidar.watch(root, {
    ignored: (p: string, stats?: fs.Stats) => {
      const rel = toRel(p);
      if (rel === '' || rel.startsWith('..')) return false;
      return filter.ignores(rel, stats?.isDirectory() ?? false);
    },
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });
  const ifSupported = (fn: (p: string) => void) => (p: string) => {
    if (languageForPath(p)) fn(p);
  };
  watcher.on('add', ifSupported(handlers.onChangeOrAdd));
  watcher.on('change', ifSupported(handlers.onChangeOrAdd));
  watcher.on('unlink', ifSupported(handlers.onRemove));
  return { close: () => watcher.close() };
}
