import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

import { ShelfDB } from './storage.js';
import { BulkOperation, QueryOptions } from './types.js';

type ServeOptions = {
  host?: string;
  port?: number;
  cors?: boolean;
  token?: string | null;
  dataDir?: string;
};

function isWriteMethod(method: string, url: string) {
  // Allow export without token; other writes require token when configured
  if (method.toUpperCase() === 'POST' && url.startsWith('/export')) return false;
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

function getAuthToken(req: any): string | undefined {
  const auth = req.headers['authorization'];
  if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length);
  }
  const q = (req.query || {}) as Record<string, string>;
  return q.token;
}

export async function createServer(db: ShelfDB, options: ServeOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  const writeToken = options.token ?? process.env.SHELFDB_TOKEN ?? null;

  if (options.cors || process.env.SHELFDB_CORS === 'true') {
    await app.register(cors, { origin: true });
  }

  // NDJSON parser: treat as raw string
  app.addContentTypeParser('application/x-ndjson', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body as string);
  });

  // Auth hook for write methods
  app.addHook('onRequest', async (req, reply) => {
    if (!isWriteMethod(req.method, req.url)) return;
    if (!writeToken) return; // no auth configured
    const token = getAuthToken(req);
    if (token !== writeToken) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/db', async () => ({ collections: db.listCollections() }));

  app.get('/db/:collection', async (req) => {
    const params = req.params as { collection: string };
    const q = (req.query || {}) as Record<string, string>;
    const opts: QueryOptions = {
      q: q.q,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
      sort: q.sort,
    };
    // Basic validation
    if (opts.limit !== undefined && (!Number.isFinite(opts.limit) || opts.limit < 0)) {
      throw new Error('Invalid limit');
    }
    if (opts.offset !== undefined && (!Number.isFinite(opts.offset) || opts.offset < 0)) {
      throw new Error('Invalid offset');
    }
    return db.query(params.collection, opts);
  });

  app.post('/db/:collection', async (req, reply) => {
    const { collection } = req.params as { collection: string };
    const body = (req.body || {}) as Record<string, unknown>;
    const doc = db.insert(collection, body);
    reply.code(201).send(doc);
  });

  app.get('/db/:collection/:id', async (req, reply) => {
    const { collection, id } = req.params as { collection: string; id: string };
    const doc = db.get(collection, id);
    if (!doc) return reply.code(404).send({ error: 'not_found' });
    return doc;
  });

  app.put('/db/:collection/:id', async (req, reply) => {
    const { collection, id } = req.params as { collection: string; id: string };
    const body = (req.body || {}) as Record<string, unknown>;
    const doc = db.update(collection, id, body);
    if (!doc) return reply.code(404).send({ error: 'not_found' });
    return doc;
  });

  app.patch('/db/:collection/:id', async (req, reply) => {
    const { collection, id } = req.params as { collection: string; id: string };
    const body = (req.body || {}) as Record<string, unknown>;
    const doc = db.patch(collection, id, body);
    if (!doc) return reply.code(404).send({ error: 'not_found' });
    return doc;
  });

  app.delete('/db/:collection/:id', async (req, reply) => {
    const { collection, id } = req.params as { collection: string; id: string };
    const ok = db.delete(collection, id);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    reply.code(200).send({ success: true });
  });

  app.post('/db/:collection/_bulk', async (req) => {
    const { collection } = req.params as { collection: string };
    const body = (req.body || []) as BulkOperation[];
    const res = db.bulk(collection, body);
    return res;
  });

  app.post('/export', async (req, reply) => {
    const q = (req.query || {}) as Record<string, string>;
    if (q.format === 'ndjson') {
      const chunks: string[] = [];
      for (const [collection, map] of Object.entries(db.exportJSON().collections)) {
        for (const doc of Object.values(map)) {
          chunks.push(JSON.stringify({ collection, doc }));
        }
      }
      reply.header('content-type', 'application/x-ndjson');
      return chunks.join('\n') + '\n';
    }
    return db.exportJSON();
  });

  app.post('/import', async (req) => {
    const ct = (req.headers['content-type'] || '').toString();
    if (ct.includes('application/x-ndjson')) {
      const body = req.body as string;
      const lines = body.split(/\r?\n/);
      db.importNDJSON(lines);
      return { ok: true };
    }
    const body = req.body as any;
    if (body && body.collections) {
      db.importJSON(body);
      return { ok: true };
    }
    throw new Error('Unsupported import payload');
  });

  return app;
}

export async function serve(db: ShelfDB, options: ServeOptions = {}) {
  const app = await createServer(db, options);
  const port = options.port ?? Number(process.env.PORT || 3000);
  const host = options.host ?? '0.0.0.0';

  const close = async () => {
    try {
      await app.close();
    } catch {}
    try {
      db.compact();
    } catch (e) {
      app.log.error({ err: e }, 'Compact on shutdown failed');
    }
    process.exit(0);
  };

  process.on('SIGINT', close);
  process.on('SIGTERM', close);

  db.load();
  db.startAutoCompact();
  await app.listen({ port, host });
}
