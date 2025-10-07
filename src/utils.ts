import fs from 'node:fs';
import path from 'node:path';

export function ensureDirSync(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function readJsonFile<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf-8');
      return JSON.parse(raw) as T;
    }
  } catch (e) {
    console.warn(`Failed to read JSON from ${file}:`, e);
  }
  return fallback;
}

export function appendFileSync(file: string, data: string) {
  ensureDirSync(path.dirname(file));
  fs.appendFileSync(file, data);
}

export function atomicWriteFileSync(file: string, data: string) {
  const dir = path.dirname(file);
  ensureDirSync(dir);
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${Date.now()}-${Math.random()}`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepMerge<T extends Record<string, unknown>>(a: T, b: Partial<T>): T {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (isObject(v) && isObject(out[k] as unknown)) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

export function parseSort(sort?: string): { field: string; dir: 1 | -1 } | undefined {
  if (!sort) return undefined;
  const [field, dir] = sort.split(':');
  return { field, dir: dir === 'desc' ? -1 : 1 };
}

export function filterByQuery(doc: Record<string, unknown>, q?: string): boolean {
  if (!q) return true;
  try {
    // Try JSON query: { "field": "value" }
    const obj = JSON.parse(q) as Record<string, unknown>;
    return Object.entries(obj).every(([k, v]) => doc[k] === v);
  } catch {
    const s = q.toLowerCase();
    return JSON.stringify(doc).toLowerCase().includes(s);
  }
}

