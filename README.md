ShelfDB — Tiny JSON Document DB
================================

ShelfDB is a tiny self-hosted JSON document database with an append-only journal, periodic compaction, REST API, and CLI.

Features
- Fastify REST API
- Append-only journal with safe atomic snapshot compaction
- Backups and restore (.json.gz)
- CLI for serve, import/export, query, and maintenance
- Optional write auth via `SHELFDB_TOKEN`
- Optional CORS via `SHELFDB_CORS=true`

Requirements
- Node.js 20+

Install
- `npm install`
- `npm run build`

Run
- `./bin/shelfdb serve --port 3000`
- Or `npm start`

Data Location
- Snapshot: `data/shelfdb.json`
- Journal: `data/shelfdb.journal.ndjson`
- Backups: `backups/*.json.gz`

REST API
- `GET /health`
- `GET /db` → list collections
- `GET /db/:collection` → query docs (`?q`, `?limit`, `?offset`, `?sort`)
- `POST /db/:collection` → insert doc
- `GET|PUT|PATCH|DELETE /db/:collection/:id`
- `POST /db/:collection/_bulk` → atomic bulk ops
- `POST /export` / `POST /import` (JSON or NDJSON)

Auth and CORS
- Set `SHELFDB_TOKEN=...` to require write operations to include `Authorization: Bearer <token>` or `?token=<token>`
- Set `SHELFDB_CORS=true` to allow cross-origin clients

CLI
- `shelfdb serve [--port 3000] [--host 0.0.0.0] [--cors] [--token TOKEN]`
- `shelfdb put <collection> <file>` (JSON array or NDJSON)
- `shelfdb get <collection> [--query Q] [--limit N] [--offset N] [--sort field[:asc|desc]]`
- `shelfdb del <collection> <id>`
- `shelfdb compact`
- `shelfdb backup`
- `shelfdb restore <file>`
- `shelfdb info`

Examples (curl)
- `curl http://localhost:3000/health`
- `curl http://localhost:3000/db`
- `curl -X POST http://localhost:3000/db/books -H "Content-Type: application/json" -d '{"title":"Dune","author":"Frank Herbert"}'`
- `curl http://localhost:3000/db/books?q=Herbert&limit=5&sort=title:asc`
- `curl http://localhost:3000/db/books/<id>`
- `curl -X PATCH http://localhost:3000/db/books/<id> -H "Content-Type: application/json" -d '{"rating":5}'`
- `curl -X DELETE http://localhost:3000/db/books/<id>`
- Bulk: `curl -X POST http://localhost:3000/db/books/_bulk -H "Content-Type: application/json" -d '[{"op":"insert","doc":{"title":"Dune"}},{"op":"insert","doc":{"title":"Foundation"}}]'`
- Export JSON: `curl -X POST http://localhost:3000/export`
- Export NDJSON: `curl -X POST 'http://localhost:3000/export?format=ndjson'`
- Import JSON: `curl -X POST http://localhost:3000/import -H 'Content-Type: application/json' --data '{"collections":{"books":{}}}'`
- Import NDJSON: `curl -X POST http://localhost:3000/import -H 'Content-Type: application/x-ndjson' --data-binary @data.ndjson`

Examples (CLI)
- `./bin/shelfdb serve --port 3000`
- `./bin/shelfdb put books samples/books.json`
- `./bin/shelfdb get books --query Herbert --sort title:asc`
- `./bin/shelfdb del books <id>`
- `./bin/shelfdb compact`
- `./bin/shelfdb backup`
- `./bin/shelfdb restore backups/backup-2024-01-01.json.gz`
- `./bin/shelfdb info`

Docker
- Build: `docker build -t shelfdb .`
- Run: `docker run -p 3000:3000 -v $(pwd)/data:/app/data -v $(pwd)/backups:/app/backups shelfdb`
- Compose: `docker-compose up --build`

License
MIT License

