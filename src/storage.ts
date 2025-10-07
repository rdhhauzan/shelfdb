import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { v4 as uuidv4 } from 'uuid';

import { BulkOperation, Document, QueryOptions, ShelfDBConfig, ShelfDBOptions } from './types.js';
import {
  appendFileSync,
  atomicWriteFileSync,
  deepMerge,
  ensureDirSync,
  filterByQuery,
  parseSort,
  readJsonFile,
} from './utils.js';

type DBState = {
  collections: Record<string, Record<string, Document>>;
};

type JournalEntry =
  | { type: 'insert'; collection: string; doc: Document }
  | { type: 'update'; collection: string; id: string; doc: Partial<Document> }
  | { type: 'delete'; collection: string; id: string };

export class ShelfDB {
  private state: DBState = { collections: {} };
  private config: ShelfDBConfig;
  private compactTimer?: NodeJS.Timeout;

  constructor(options?: ShelfDBOptions) {
    const dataDir = path.resolve(
      options?.dataDir || process.env.SHELFDB_DATA_DIR || 'data'
    );
    const backupsDir = options?.backupsDir || 'backups';
    const dataFile = options?.dataFile || path.join(dataDir, 'shelfdb.json');
    const journalFile = options?.journalFile || path.join(dataDir, 'shelfdb.journal.ndjson');
    const autoMs = 5 * 60 * 1000
    this.config = {
      dataFile,
      journalFile,
      backupsDir,
      autoCompactIntervalMs: autoMs,
    };
    ensureDirSync(path.dirname(this.config.dataFile));
    ensureDirSync(this.config.backupsDir);
  }

  load(): void {
    // Load base snapshot
    const snapshot = readJsonFile<DBState>(this.config.dataFile, { collections: {} });
    this.state = snapshot;
    // Replay journal entries
    if (fs.existsSync(this.config.journalFile)) {
      const lines = fs.readFileSync(this.config.journalFile, 'utf-8').split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as JournalEntry;
          this.applyJournal(entry);
        } catch (e) {
          console.warn('Skipping invalid journal line:', e);
        }
      }
    }
  }

  startAutoCompact(): void {
    this.stopAutoCompact();
    this.compactTimer = setInterval(() => {
      try {
        this.compact();
      } catch (e) {
        console.error('Auto-compact failed:', e);
      }
    }, this.config.autoCompactIntervalMs);
  }

  stopAutoCompact(): void {
    if (this.compactTimer) clearInterval(this.compactTimer);
  }

  private applyJournal(entry: JournalEntry) {
    const { collection } = entry;
    const col = (this.state.collections[collection] ||= {});
    if (entry.type === 'insert') {
      col[entry.doc._id] = entry.doc;
    } else if (entry.type === 'update') {
      const existing = col[entry.id];
      if (!existing) return;
      col[entry.id] = deepMerge(existing, entry.doc);
    } else if (entry.type === 'delete') {
      delete col[entry.id];
    }
  }

  private writeJournal(entry: JournalEntry) {
    appendFileSync(this.config.journalFile, JSON.stringify(entry) + '\n');
  }

  private writeJournalBatch(entries: JournalEntry[]) {
    if (!entries.length) return;
    const data = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    appendFileSync(this.config.journalFile, data);
  }

  listCollections(): string[] {
    return Object.keys(this.state.collections).sort();
  }

  query(collection: string, opts: QueryOptions = {}): { total: number; items: Document[] } {
    const col = this.state.collections[collection] || {};
    let items = Object.values(col);
    items = items.filter((d) => filterByQuery(d, opts.q));
    const total = items.length;
    const sort = parseSort(opts.sort);
    if (sort) {
      items.sort((a, b) => {
        const va = (a as Record<string, unknown>)[sort.field];
        const vb = (b as Record<string, unknown>)[sort.field];
        if (va === vb) return 0;
        return (va as number | string) > (vb as number | string) ? sort.dir : -sort.dir;
      });
    }
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 100;
    items = items.slice(offset, offset + limit);
    return { total, items };
  }

  get(collection: string, id: string): Document | undefined {
    const col = this.state.collections[collection] || {};
    return col[id];
  }

  insert(collection: string, doc: Record<string, unknown>): Document {
    const now = new Date().toISOString();
    const full: Document = {
      ...(doc as Record<string, unknown>),
      _id: uuidv4(),
      _createdAt: now,
      _updatedAt: now,
    };
    (this.state.collections[collection] ||= {})[full._id] = full;
    this.writeJournal({ type: 'insert', collection, doc: full });
    return full;
  }

  update(collection: string, id: string, doc: Partial<Record<string, unknown>>): Document | undefined {
    const existing = this.get(collection, id);
    if (!existing) return undefined;
    const now = new Date().toISOString();
    const updated = { ...existing, ...doc, _updatedAt: now } as Document;
    (this.state.collections[collection] ||= {})[id] = updated;
    this.writeJournal({ type: 'update', collection, id, doc: updated });
    return updated;
  }

  patch(collection: string, id: string, doc: Partial<Record<string, unknown>>): Document | undefined {
    const existing = this.get(collection, id);
    if (!existing) return undefined;
    const now = new Date().toISOString();
    const patched = deepMerge(existing, { ...doc, _updatedAt: now } as Partial<Document>) as Document;
    (this.state.collections[collection] ||= {})[id] = patched;
    this.writeJournal({ type: 'update', collection, id, doc: patched });
    return patched;
  }

  delete(collection: string, id: string): boolean {
    const col = this.state.collections[collection] || {};
    if (!col[id]) return false;
    delete col[id];
    this.writeJournal({ type: 'delete', collection, id });
    return true;
  }

  bulk(collection: string, ops: BulkOperation[]): { ok: boolean; results: unknown[] } {
    const snapshot = JSON.stringify(this.state);
    const results: unknown[] = [];
    const journalBatch: JournalEntry[] = [];
    try {
      for (const op of ops) {
        if (op.op === 'insert') {
          const now = new Date().toISOString();
          const full: Document = {
            ...(op.doc as Record<string, unknown>),
            _id: uuidv4(),
            _createdAt: now,
            _updatedAt: now,
          };
          (this.state.collections[collection] ||= {})[full._id] = full;
          results.push(full);
          journalBatch.push({ type: 'insert', collection, doc: full });
        } else if (op.op === 'update') {
          const existing = this.get(collection, op.id);
          if (!existing) throw new Error(`not found: ${op.id}`);
          const now = new Date().toISOString();
          const updated = { ...existing, ...op.doc, _updatedAt: now } as Document;
          (this.state.collections[collection] ||= {})[op.id] = updated;
          results.push(updated);
          journalBatch.push({ type: 'update', collection, id: op.id, doc: updated });
        } else if (op.op === 'patch') {
          const existing = this.get(collection, op.id);
          if (!existing) throw new Error(`not found: ${op.id}`);
          const now = new Date().toISOString();
          const patched = deepMerge(existing, { ...op.doc, _updatedAt: now } as Partial<Document>) as Document;
          (this.state.collections[collection] ||= {})[op.id] = patched;
          results.push(patched);
          journalBatch.push({ type: 'update', collection, id: op.id, doc: patched });
        } else if (op.op === 'delete') {
          const col = this.state.collections[collection] || {};
          if (!col[op.id]) throw new Error(`not found: ${op.id}`);
          delete col[op.id];
          results.push({ deleted: op.id });
          journalBatch.push({ type: 'delete', collection, id: op.id });
        }
      }
      // Commit journal atomically as a batch
      this.writeJournalBatch(journalBatch);
      return { ok: true, results };
    } catch (e) {
      // rollback
      this.state = JSON.parse(snapshot) as DBState;
      throw e;
    }
  }

  snapshot(): void {
    atomicWriteFileSync(this.config.dataFile, JSON.stringify(this.state));
  }

  compact(): void {
    this.snapshot();
    // Truncate journal after snapshot
    atomicWriteFileSync(this.config.journalFile, '');
  }

  backup(): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(this.config.backupsDir, `backup-${stamp}.json.gz`);
    const json = JSON.stringify(this.state);
    const gz = zlib.gzipSync(Buffer.from(json));
    fs.writeFileSync(file, gz);
    return file;
  }

  restore(file: string): void {
    const buf = fs.readFileSync(file);
    const json = zlib.gunzipSync(buf).toString('utf-8');
    this.state = JSON.parse(json) as DBState;
    this.compact();
  }

  exportJSON(): DBState {
    return this.state;
  }

  importJSON(state: DBState): void {
    this.state = state;
    this.compact();
  }

  importNDJSON(lines: string[]): void {
    // Each line a document with { collection, doc }
    const snapshot = JSON.stringify(this.state);
    try {
      for (const line of lines) {
        if (!line.trim()) continue;
        const obj = JSON.parse(line) as { collection: string; doc: Record<string, unknown> };
        this.insert(obj.collection, obj.doc);
      }
    } catch (e) {
      this.state = JSON.parse(snapshot) as DBState;
      throw e;
    }
  }
}
