export type Document = Record<string, unknown> & {
  _id: string;
  _createdAt: string;
  _updatedAt: string;
};

export type QueryOptions = {
  q?: string; // JSON string or simple search
  limit?: number;
  offset?: number;
  sort?: string; // field[:asc|desc]
};

export type BulkOperation =
  | { op: 'insert'; doc: Record<string, unknown> }
  | { op: 'update'; id: string; doc: Partial<Record<string, unknown>> }
  | { op: 'patch'; id: string; doc: Partial<Record<string, unknown>> }
  | { op: 'delete'; id: string };

export type ShelfDBConfig = {
  dataFile: string;
  journalFile: string;
  backupsDir: string;
  autoCompactIntervalMs: number;
};

export type ShelfDBOptions = Partial<ShelfDBConfig> & {
  dataDir?: string;
};
