# CLAUDE.md

## What is grap-local?

A local-first code context engine for TypeScript/JavaScript repositories.
It scans a repo, extracts symbols and dependency edges, stores them in MongoDB,
and exposes that context via REST API and an MCP server for coding agents.

## Project structure

```
src/
├── config/          # env validation (zod), logger (pino)
├── db/              # mongoose connection helpers
├── modules/
│   ├── graph/       # edge model + graph traversal service
│   ├── health/      # GET /health
│   ├── indexing/    # scanner, file model, index-run model, indexing service
│   ├── mcp/         # stdio MCP server (find_symbol, get_symbol_context, etc.)
│   ├── repo/        # repository model + service + routes + schemas
│   └── symbols/     # symbol model + service + routes, code-analyzer (ts-morph)
├── shared/          # domain types, error utilities, path/hash helpers
├── app.ts           # express setup, route mounting, error handlers
└── server.ts        # bootstrap: connect mongo → start HTTP server
scripts/
└── index.ts         # CLI: register + index a repo from terminal
tests/               # vitest tests
docs/                # architecture, data-model, mcp-tools, limitations
```

## Development rules

- Make the smallest correct change.
- Reuse existing service logic; do not duplicate business logic across REST and MCP.
- Do not hardcode secrets. All config goes through `src/config/env.ts` (zod-validated).
- Keep TypeScript strict and code modular.
- Prefer reliable indexing over over-claiming code intelligence.
- Document limitations honestly in `docs/limitations.md`.
- Before finishing any task: run lint, tests, and build when relevant.

## Commands

```bash
npm run dev          # start REST server in watch mode (tsx)
npm run build        # compile TypeScript to dist/
npm run start        # run compiled REST server
npm run lint         # run ESLint
npm run test         # run Vitest
npm run mcp          # start MCP server over stdio
npm run index -- --path <repo> --name <name>   # CLI: register + index a repo
```

## Environment

Requires a `.env` file (not `.env.local`) at project root with:

```
PORT=4010
MONGODB_URI=mongodb+srv://...
DB_NAME=grap-local
LOG_LEVEL=info
```

Validated by zod in `src/config/env.ts`. The app will crash on startup if any required var is missing.

## Key conventions

- **Mongoose models** use `import mongoose from 'mongoose'` (default import) + destructured named exports (`Schema`, `model`, `Types`). Access `mongoose.models.X` for model reuse guards — do NOT use `import { models }` as a named ESM import (it breaks under Node ESM).
- **REST routes** are mounted in `src/app.ts` under `/health`, `/repos`, `/symbols`, `/files`.
- **MCP tools** live in `src/modules/mcp/server.ts` and must call shared service methods (never duplicate the logic from REST handlers).
- **Errors** use `AppError` from `src/shared/utils/error.ts`.
- **Logging** uses pino; logs go to stderr so MCP stdio protocol is not corrupted.
- **Imports** use `.js` extensions in all relative paths (ESM requirement).

## REST API

| Method | Endpoint                              | Purpose                          |
| ------ | ------------------------------------- | -------------------------------- |
| GET    | `/health`                             | Health check                     |
| POST   | `/repos/register`                     | Register a new repo              |
| GET    | `/repos`                              | List repos                       |
| POST   | `/repos/:repoId/index`               | Trigger indexing                 |
| GET    | `/repos/:repoId/files`               | List indexed files               |
| GET    | `/repos/:repoId/files/search?q=`     | Search files                     |
| GET    | `/repos/:repoId/status`              | Repo status + latest index run   |
| GET    | `/repos/:repoId/symbols/search?q=`   | Search symbols                   |
| GET    | `/symbols/:symbolId`                 | Get one symbol                   |
| GET    | `/symbols/:symbolId/context`         | Symbol context + neighborhood    |
| GET    | `/symbols/:symbolId/impact?depth=`   | Impact / blast radius            |
| GET    | `/files/:fileId`                      | Get one file                     |
| GET    | `/files/:fileId/symbols`             | Symbols in a file                |

## MCP tools

| Tool                | Purpose                                         |
| ------------------- | ----------------------------------------------- |
| `find_symbol`       | Search symbols by name or fqName                |
| `get_symbol_context` | Definition + neighborhood + dependencies       |
| `get_file_symbols`  | All symbols in one file                         |
| `get_symbol_impact` | Blast radius: callers, callees, inheritance     |
| `search_files`      | Search files by path, symbol, import, content   |
| `get_repo_status`   | Repo metadata + latest index run + file count   |

## Using grap-local from another repo (MCP client setup)

### Step 1: Start the REST server and index your target repo

```bash
# In grap-local directory
npm run dev

# Register your project
curl -X POST http://localhost:4010/repos/register \
  -H "Content-Type: application/json" \
  -d '{"name":"my-project","rootPath":"C:/path/to/my-project"}'

# Index it (use the repoId from the response)
curl -X POST http://localhost:4010/repos/<repoId>/index
```

### Step 2: Configure MCP in Claude Code

#### Option A: CLI

```bash
claude mcp add grap-local -- npm run mcp --prefix "C:/Users/LENOVO/OneDrive/Máy tính/grap-local"
```

#### Option B: `.mcp.json` in your project root

```json
{
  "mcpServers": {
    "grap-local": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "C:/Users/LENOVO/OneDrive/Máy tính/grap-local"
    }
  }
}
```

### Step 3: Recommended workflow

1. Call `get_repo_status` — confirm repo is `ready`.
2. Use `find_symbol` to locate the symbol you need.
3. Use `get_symbol_context` before editing — see callers, callees, imports.
4. Use `get_symbol_impact` before refactoring — understand blast radius.
5. Use `search_files` when you only know a path fragment or text.

## Other agent setup

### Codex

Point the MCP client at:

- command: `npm`
- args: `["run", "mcp"]`
- cwd: `C:/Users/LENOVO/OneDrive/Máy tính/grap-local`

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "grap-local": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "C:/Users/LENOVO/OneDrive/Máy tính/grap-local"
    }
  }
}
```

### Antigravity (Gemini)

The user-rules in `AGENTS.md` (this repo) already document the full project structure, conventions, and MCP setup. Antigravity reads them automatically via `<user_rules>`.
