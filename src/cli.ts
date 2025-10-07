#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { Command } from 'commander';

import { ShelfDB } from './storage.js';
import { serve } from './server.js';

const program = new Command();
program
  .name('shelfdb')
  .description('ShelfDB — tiny self-hosted JSON document DB')
  .version('0.1.0');

program
  .command('serve')
  .description('Start ShelfDB server')
  .option('-p, --port <port>', 'Port to listen on', (v) => Number(v), 3000)
  .option('--host <host>', 'Host to bind', '0.0.0.0')
  .option('--cors', 'Enable CORS', false)
  .option('--token <token>', 'Write auth token (or SHELFDB_TOKEN)')
  .option('--data-dir <dir>', 'Data directory (or SHELFDB_DATA_DIR)')
  .action(async (opts) => {
    const db = new ShelfDB({
      dataDir: opts.dataDir,
    });
    await serve(db, {
      port: opts.port,
      host: opts.host,
      cors: !!opts.cors,
      token: opts.token,
      dataDir: opts.dataDir,
    });
  });

program
  .command('put')
  .description('Bulk import documents into a collection from file (JSON array or NDJSON)')
  .argument('<collection>', 'Collection name')
  .argument('<file>', 'Path to JSON or NDJSON file')
  .option('--data-dir <dir>', 'Data directory (or SHELFDB_DATA_DIR)')
  .action((collection: string, file: string, opts) => {
    const db = new ShelfDB({ dataDir: opts.dataDir });
    db.load();
    const raw = fs.readFileSync(file, 'utf-8');
    if (file.endsWith('.ndjson')) {
      const lines = raw.split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        db.insert(collection, JSON.parse(line));
      }
    } else {
      const arr = JSON.parse(raw) as unknown[];
      if (!Array.isArray(arr)) throw new Error('Expected JSON array');
      for (const obj of arr) {
        db.insert(collection, obj as Record<string, unknown>);
      }
    }
    db.compact();
    console.log('Imported into', collection);
  });

program
  .command('get')
  .description('Query documents in a collection')
  .argument('<collection>', 'Collection name')
  .option('-q, --query <q>', 'Query as JSON or substring')
  .option('--limit <n>', 'Limit', (v) => Number(v), 100)
  .option('--offset <n>', 'Offset', (v) => Number(v), 0)
  .option('--sort <field[:asc|desc]>', 'Sort by field')
  .option('--data-dir <dir>', 'Data directory (or SHELFDB_DATA_DIR)')
  .action((collection: string, opts) => {
    const db = new ShelfDB({ dataDir: opts.dataDir });
    db.load();
    const res = db.query(collection, {
      q: opts.query,
      limit: opts.limit,
      offset: opts.offset,
      sort: opts.sort,
    });
    console.log(JSON.stringify(res, null, 2));
  });

program
  .command('del')
  .description('Delete a document by id')
  .argument('<collection>', 'Collection name')
  .argument('<id>', 'Document id')
  .option('--data-dir <dir>', 'Data directory (or SHELFDB_DATA_DIR)')
  .action((collection: string, id: string, opts) => {
    const db = new ShelfDB({ dataDir: opts.dataDir });
    db.load();
    const ok = db.delete(collection, id);
    if (!ok) {
      console.error('Not found');
      process.exitCode = 1;
      return;
    }
    db.compact();
    console.log('Deleted', id);
  });

program
  .command('compact')
  .description('Compact snapshot and truncate journal')
  .option('--data-dir <dir>', 'Data directory (or SHELFDB_DATA_DIR)')
  .action((opts) => {
    const db = new ShelfDB({ dataDir: opts.dataDir });
    db.load();
    db.compact();
    console.log('Compacted');
  });

program
  .command('backup')
  .description('Create a gzipped backup in backups/')
  .option('--data-dir <dir>', 'Data directory (or SHELFDB_DATA_DIR)')
  .action((opts) => {
    const db = new ShelfDB({ dataDir: opts.dataDir });
    db.load();
    const file = db.backup();
    console.log('Backup created:', file);
  });

program
  .command('restore')
  .description('Restore from a gzipped backup file')
  .argument('<file>', 'Path to .json.gz backup')
  .option('--data-dir <dir>', 'Data directory (or SHELFDB_DATA_DIR)')
  .action((file: string, opts) => {
    const db = new ShelfDB({ dataDir: opts.dataDir });
    db.load();
    db.restore(path.resolve(file));
    console.log('Restored from', file);
  });

program
  .command('info')
  .description('Show database info')
  .option('--data-dir <dir>', 'Data directory (or SHELFDB_DATA_DIR)')
  .action((opts) => {
    const db = new ShelfDB({ dataDir: opts.dataDir });
    db.load();
    const collections = db.listCollections();
    console.log(JSON.stringify({ collections }, null, 2));
  });

program.parseAsync().catch((e) => {
  console.error(e);
  process.exit(1);
});
