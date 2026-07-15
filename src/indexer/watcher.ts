import { languageForPath } from './languages';

// chokidar v5 is ESM-only; this CommonJS project loads it via runtime require
// (supported on Node >= 20.19 / 22), matching the require() pattern in languages.ts.
interface FSWatcher {
  on(event: string, listener: (path: string) => void): FSWatcher;
  close(): Promise<void>;
}
const chokidar = require('chokidar') as {
  watch(paths: string, options?: unknown): FSWatcher;
};

export interface WatchHandlers {
  onChangeOrAdd(absPath: string): void;
  onRemove(absPath: string): void;
}

const SKIP = /(^|[\\/])(\.git|node_modules|dist|build|out|\.cache)([\\/]|$)/;

export function watchProject(root: string, handlers: WatchHandlers): { close(): Promise<void> } {
  const watcher = chokidar.watch(root, {
    ignored: (p: string) => SKIP.test(p),
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
