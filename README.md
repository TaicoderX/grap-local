# grap-local

`grap-local` is a local-first code context engine for TypeScript and JavaScript repositories. It scans a repository, indexes files incrementally, extracts symbols and basic graph relationships, stores the result in MongoDB, and exposes the same context through REST endpoints and an MCP server for coding agents.

## What is implemented

- Recursive repository registration and scanning for `.ts`, `.tsx`, `.js`, and `.jsx`
- Incremental re-indexing based on stable SHA-256 content hashes
- Cleanup of deleted files and their dependent symbols and edges
- A single active index run per repository, with stale-run recovery if a previous process appears to have crashed
- ts-morph symbol extraction for:
  - imports and exports
  - top-level functions
  - classes and methods
  - interfaces
  - type aliases
  - enums
  - meaningful top-level variables
  - basic callable and inheritance edges when resolvable
- MongoDB persistence for repositories, files, symbols, edges, and index runs
- Best-effort import resolution for relative imports, extensionless imports, directory indexes, and common `tsconfig` or `jsconfig` `baseUrl` and `paths` aliases
- REST API for repo registration, indexing, file browsing, symbol search, context lookup, and impact slices
- Lightweight pagination or limits on file listings, file symbol listings, file search, symbol search, and impact depth
- MCP server exposing agent-friendly tools that reuse the same internal services as REST
- Vitest coverage for env validation, hashing, incremental planning, deleted-file cleanup, scanner filtering, analyzer edge cases, import resolution, one MCP tool path, one REST endpoint, and indexing integration

## Stack

- Node.js
- TypeScript
- Express
- MongoDB + Mongoose
- ts-morph
- zod
- pino
- vitest
- tsx
- eslint + prettier

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and update it with your local MongoDB settings.

3. Start MongoDB locally.

4. Start the REST server:

```bash
npm run dev
```

The REST API starts on `http://localhost:4000` by default, or the port set in `PORT`.

## Environment

The application validates these variables with zod:

- `PORT`
- `MONGODB_URI`
- `DB_NAME`
- `LOG_LEVEL`

See [.env.example](./.env.example).

## Scripts

- `npm run dev`: start the REST server in watch mode
- `npm run build`: compile TypeScript to `dist/`
- `npm run start`: run the compiled REST server
- `npm run lint`: run ESLint
- `npm run test`: run Vitest
- `npm run index -- --path ../some-repo --name my-repo`: register and index a repository from the CLI
- `npm run mcp`: start the MCP server over stdio

## REST API

Implemented endpoints:

- `GET /health`
- `POST /repos/register`
- `GET /repos`
- `POST /repos/:repoId/index`
- `GET /repos/:repoId/files`
- `GET /repos/:repoId/files/search?q=&limit=`
- `GET /repos/:repoId/status`
- `GET /repos/:repoId/symbols/search?q=&limit=`
- `GET /symbols/:symbolId`
- `GET /symbols/:symbolId/context`
- `GET /symbols/:symbolId/impact?depth=`
- `GET /symbols/:symbolId/source?contextLines=`
- `GET /files/:fileId`
- `GET /files/:fileId/symbols?limit=&offset=`
- `GET /repos/:repoId/source?fileIdOrPath=&startLine=&endLine=&maxLines=`
- `GET /repos/find-by-name?q=&limit=`
- `GET /repos/find-by-path?q=&limit=`

Pagination and limits:

- `GET /repos/:repoId/files` supports `limit` and `offset`
- `GET /files/:fileId/symbols` supports `limit` and `offset`
- file search defaults to `limit=20` and caps at `50`
- symbol search defaults to `limit=20` and caps at `100`
- impact traversal defaults to `depth=2` and caps at `5`
- source reading defaults to `maxLines=200` and caps at `500`
- repo discovery caps at `20` results

Example flow:

```bash
curl -X POST http://localhost:4000/repos/register \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"my-repo\",\"rootPath\":\"C:/code/my-repo\"}"
```

```bash
curl -X POST http://localhost:4000/repos/<repoId>/index
```

```bash
curl "http://localhost:4000/repos/<repoId>/symbols/search?q=UserService"
```

## MCP server

The MCP server runs on stdio and exposes these tools:

- `find_symbol`
- `get_symbol_context`
- `get_file_symbols`
- `get_symbol_impact`
- `search_files`
- `get_repo_status`
- `read_file_content`
- `read_symbol_source`
- `list_repos`
- `find_repo`

Run it locally:

```bash
npm run mcp
```

See [docs/mcp-tools.md](./docs/mcp-tools.md) for usage guidance and client config examples.

For agent use, check `get_repo_status` or `GET /repos/:repoId/status` before trusting deep context. A repo in `indexing` or `error` should be treated as in-progress or needing repair.

## Incremental indexing

Each scan computes a stable SHA-256 hash for every supported source file. During indexing:

1. The scanner walks the repository and filters unsupported or ignored paths.
2. The index planner compares the new scan result to existing indexed file records.
3. Unchanged files are skipped only when the stored hash matches and the last refresh completed successfully.
4. Changed files are re-analyzed, existing symbols are upserted by stable `fqName`, incoming edges to surviving symbols are preserved, outgoing edges from changed symbols are rebuilt, and removed symbols are cleaned up.
5. Deleted files are removed from MongoDB along with dependent graph artifacts.

This keeps the persistence step incremental even though ts-morph still loads repo-wide source context to improve symbol resolution.

## Design notes

- The service is local-first and intentionally avoids auth and cloud concerns in v1.
- The symbol/import graph is favored over speculative "smart" analysis.
- MCP and REST both call shared services instead of duplicating logic. The current hardening pass keeps `get_repo_status`, file context, and file symbol listing on shared internal paths.
- The stored file hash only advances after a successful refresh, so a failed refresh is retried instead of being falsely treated as up to date.
- Logs are written to stderr so the stdio MCP server does not corrupt protocol output.

## Limitations

Current limitations are documented in [docs/limitations.md](./docs/limitations.md). The short version:

- v1 only supports JavaScript and TypeScript source files
- call graph coverage is basic and only emitted when ts-morph can resolve a target reliably
- import dependency resolution is best-effort for relative imports and common `tsconfig` or `jsconfig` alias layouts, but package imports are not mapped into file graph nodes
- refresh is not fully transactional, so an interrupted run can leave temporarily partial symbol or edge state until the next successful reindex repairs it
- indexing is request-driven, not file-watch-driven
- repository content is not fully stored in MongoDB

## Project docs

- [Architecture](./docs/architecture.md)
- [Data Model](./docs/data-model.md)
- [MCP Tools](./docs/mcp-tools.md)
- [Limitations](./docs/limitations.md)
