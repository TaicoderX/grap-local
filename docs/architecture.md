# Architecture

## Goals

The MVP is optimized for a reliable local code context workflow:

- register a repository by filesystem path
- scan source files with predictable ignore rules
- persist incremental indexing state in MongoDB
- expose queryable code context to agents through REST and MCP

The design intentionally favors simple, honest graph data over over-claimed analysis.

One result of the hardening pass is that routing stays thin: request validation lives in route modules, and both REST and MCP delegate into the same service methods instead of keeping parallel controller logic.

## Module layout

- `src/config`
  - environment validation and logger setup
- `src/db`
  - MongoDB bootstrap
- `src/modules/repo`
  - repository registration, listing, pagination-aware file listings, and status lookup
- `src/modules/indexing`
  - scanning, incremental planning, file persistence, and index runs
- `src/modules/symbols`
  - ts-morph analysis and symbol lookup
- `src/modules/graph`
  - callers, callees, impact slices, import dependency resolution, file context, and file search
- `src/modules/mcp`
  - MCP stdio server and tool registration
- `src/modules/health`
  - health endpoint
- `src/shared`
  - shared types and utilities

## Request and indexing flow

### Repository registration

1. `POST /repos/register` validates input with zod.
2. The path is normalized to an absolute path.
3. The path is checked on disk.
4. The repository is upserted in MongoDB by `rootPath`.

### Indexing

1. `POST /repos/:repoId/index` recovers any stale expired running run, creates a new `IndexRun`, and marks the repo as `indexing`.
2. The scanner walks the repository recursively.
3. Ignore behavior combines:
   - hardcoded generated/build folders
   - `.gitignore` patterns from the target repo
   - supported extension filtering
4. The incremental planner classifies files into:
   - changed
   - skipped
   - deleted
5. Deleted files have their file records, symbols, and graph edges removed.
6. Changed files are re-analyzed with ts-morph.
7. Existing symbols in changed files are upserted by stable `fqName`, so surviving symbols keep their identity.
8. Incoming edges to surviving changed-file symbols are preserved, while outgoing edges from changed-file symbols are rebuilt and references to removed symbols are deleted.
9. File hashes are only finalized after the symbol and edge refresh succeeds, so a failed refresh is retried on the next run instead of being skipped.
10. The repo is marked `ready` and the `IndexRun` is completed.

### Concurrency guardrail

Only one active `running` `IndexRun` is allowed per repository at a time. This is enforced in MongoDB with a partial unique index.

- a second overlapping request gets a conflict error instead of running concurrently
- a stale `running` entry older than the lease window is marked failed and recovered before a new run starts
- this prevents overlapping refreshes, but it does not make the full write path transactional

### Import resolution

Resolved file dependencies intentionally stay conservative:

- relative imports are normalized against the source file path
- extensionless imports try supported source extensions
- directory imports try `index.ts`, `index.tsx`, `index.js`, and `index.jsx`
- `tsconfig.json` or `jsconfig.json` `baseUrl` and `paths` aliases are applied when available
- package imports are left unresolved unless they point at another indexed file path

## Why ts-morph is loaded repo-wide

Persistence is incremental, but analysis still creates a repo-wide ts-morph `Project`. That is a deliberate tradeoff:

- it improves symbol resolution for imports and callable targets
- it keeps the incremental write path clean
- it avoids pretending to have cross-file resolution without enough context

This is still local-first and correct for an MVP, but it is not yet optimized for very large repositories with watch-based fine-grained updates.

## Failure boundaries

The indexing flow is safer than the original MVP, but it is still a multi-step write process rather than a MongoDB transaction.

- a failed refresh does not advance the file hash, so retry behavior is correct
- new files created during a failed run are cleaned up on a best-effort basis
- existing changed files can still be left with temporarily partial symbols or edges if the process dies mid-refresh
- the next successful reindex is expected to repair that partial state

## Service boundaries

REST and MCP both use the same service layer:

- `RepositoryService`
- `IndexingService`
- `SymbolService`
- `GraphService`

That keeps behavior consistent between HTTP clients and coding agents. In the current implementation:

- repo status is served through `RepositoryService.getRepositoryStatusSummary`
- file symbol listing is served through `SymbolService.getFileSymbolsPage`
- file import context is served through `GraphService.getFileContext`

## Extension points

The current architecture is designed so later work can extend without rewriting the core:

- replace or augment ts-morph with tree-sitter or language-specific analyzers
- add background indexing workers later without changing the data model much
- add richer graph edges such as references or inheritance chains
- add embeddings or full-text indexes without changing the current REST/MCP contract much
