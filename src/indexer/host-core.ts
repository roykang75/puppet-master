import * as fs from 'fs';
import * as path from 'path';
import type { Database } from 'better-sqlite3';
import { openDb } from './db';
import { Indexer } from './pipeline';
import { watchProject } from './watcher';
import * as queries from './api';
import { createRpcServer, Transport } from '../shared/rpc';
import {
  PROTOCOL_VERSION,
  OpenProjectParams,
  FileParams,
  SearchParams,
  NameParams,
  SymbolIdParams,
} from '../shared/protocol';

export interface IndexerHostHandle {
  close(): Promise<void>;
}

export function startIndexerHost(transport: Transport): IndexerHostHandle {
  let db: Database | null = null;
  let indexer: Indexer | null = null;
  let watcher: { close(): Promise<void> } | null = null;
  let root = '';

  const rel = (abs: string) => path.relative(root, abs).split(path.sep).join('/');
  const opened = (): { db: Database; indexer: Indexer } => {
    if (!db || !indexer) throw new Error('project not open');
    return { db, indexer };
  };

  const server = createRpcServer(transport, {
    openProject(params: OpenProjectParams) {
      root = params.root;
      fs.mkdirSync(path.dirname(params.dbPath), { recursive: true });
      db = openDb(params.dbPath);
      indexer = new Indexer(db, root);
      const stats = indexer.indexProject((done, total, file) => {
        if (done % 50 === 0 || done === total) server.emit('indexProgress', { done, total, file });
      });
      watcher = watchProject(root, {
        onChangeOrAdd: (abs) => {
          if (opened().indexer.indexFile(abs)) server.emit('fileIndexed', { path: rel(abs) });
        },
        onRemove: (abs) => {
          opened().indexer.removeFile(abs);
          server.emit('fileRemoved', { path: rel(abs) });
        },
      });
      return stats;
    },
    indexFile(params: FileParams) {
      const changed = opened().indexer.indexFile(path.join(root, params.path));
      if (changed) server.emit('fileIndexed', { path: params.path });
      return { indexed: changed };
    },
    getFileOutline: (p: FileParams) => queries.getSymbolsForFile(opened().db, p.path),
    searchSymbols: (p: SearchParams) => queries.searchSymbols(opened().db, p.query, p.limit),
    searchText: (p: SearchParams) => queries.searchText(opened().db, p.query, p.limit),
    getDefinitions: (p: NameParams) => queries.getDefinitions(opened().db, p.name),
    getCallers: (p: NameParams) => queries.getCallers(opened().db, p.name),
    getCallees: (p: SymbolIdParams) => queries.getCallees(opened().db, p.symbolId),
  });

  server.emit('ready', { protocolVersion: PROTOCOL_VERSION });

  return {
    async close() {
      await watcher?.close();
      db?.close();
      watcher = null;
      db = null;
      indexer = null;
    },
  };
}
