# Limitations

## Language support

v1 supports only:

- `.ts`
- `.tsx`
- `.js`
- `.jsx`

Other languages are intentionally out of scope for the MVP.

## Call graph accuracy

Call edges are basic and conservative.

What is implemented:

- direct call expressions inside extracted functions and methods
- direct calls inside exported arrow/function-style variables
- edges only when ts-morph can resolve a real declaration

What is not claimed:

- complete runtime call behavior
- dynamic dispatch accuracy
- framework magic resolution
- reflection-heavy code paths
- implicit control flow reasoning

## Import dependency resolution

Resolved file dependencies are currently best-effort for:

- relative imports
- extensionless imports such as `./utils`
- JavaScript specifiers that point at TypeScript files such as `./utils.js`
- directory imports such as `./nested`
- common `tsconfig.json` or `jsconfig.json` `baseUrl` and `paths` alias layouts

Package imports are preserved as strings on the file record, but they are not mapped into file graph nodes in v1.

## Incremental behavior

Persistence is incremental, but analysis still loads repo-wide TypeScript/JavaScript source context to improve resolution. This is acceptable for an MVP, but not yet the final scalability story for huge monorepos.

What the current hardening pass guarantees:

- unchanged files are skipped only after a completed refresh
- changed files are retried after a failed refresh instead of being falsely treated as current
- deleted files are cleaned from file, symbol, and edge collections
- only one active index run is allowed per repo at a time

What it does not guarantee:

- a fully transactional refresh for changed existing files
- zero partial state if the process crashes in the middle of symbol or edge writes
- exact crash recovery without rerunning indexing

## No background watcher

Indexing is currently triggered by:

- REST
- CLI

There is no daemon or file watcher yet.

## Concurrency and crash recovery

Concurrent indexing of the same repository is blocked while a run is active.

- overlapping requests receive a conflict error
- stale running runs are recovered after the lease window expires

This is a guardrail, not a full distributed lease system. If a very large run exceeds the lease window or the process dies at the wrong moment, the next successful run is still the main repair mechanism.

## Content search

File search is intentionally lightweight:

- path and import matches come from MongoDB
- symbol-name matches come from MongoDB
- content matches fall back to local file reads

This avoids storing full file content, but it also means search is not a full-text engine.

## Response sizing

Some high-cardinality endpoints now have lightweight bounds:

- repo file listings use `limit` and `offset`
- file symbol listings use `limit` and `offset`
- file search and symbol search both enforce maximum limits
- impact traversal enforces a maximum depth
- source reading: `read_file_content` defaults to 200 lines and caps at 500; `read_symbol_source` caps context at 50 lines and total output at 500 lines
- repo discovery: `find_repo`, `find_repo_by_name`, `find_repo_by_path` cap at 20 results

Other context-heavy responses such as `GET /symbols/:symbolId/context` are still intentionally unpaginated in v1. Source reading is a separate concern — `get_symbol_context` returns only metadata and graph relationships, while `read_file_content` and `read_symbol_source` return actual source text with bounded output and truncation metadata.

## Agent trust boundary

Coding agents should treat repository context as trustworthy when the repo is `ready` and the latest run is not `running` or `failed`.

If the repo is `indexing` or `error`:

- symbol context may be stale
- graph edges may be temporarily partial
- a fresh index run should be triggered before making high-confidence changes

## Operational scope

The project intentionally does not include:

- auth
- multi-tenant deployment concerns
- cloud deployment scaffolding
- frontend UI
- advanced task scheduling

Those can be added later without changing the MVP goal of being a strong local code context backend.
