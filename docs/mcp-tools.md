# MCP Tools

`grap-local` exposes a stdio MCP server so coding agents can query local code context without re-implementing indexing logic themselves.

## Implemented tools

### `find_symbol`

Input:

- `repoId`
- `query`
- `limit` optional

Returns:

- matching symbols by `name` or `fqName`

### `get_symbol_context`

Input:

- `symbolId`

Returns:

- symbol definition
- parent and child symbols when present
- sibling symbols in the same file
- direct callers and callees
- resolved file import dependencies
- a compact neighborhood summary

### `get_file_symbols`

Input:

- `fileId`

Returns:

- indexed file metadata
- extracted symbols in that file
- page metadata from the shared pagination-aware symbol listing service

### `get_symbol_impact`

Input:

- `symbolId`
- `depth` optional

Returns:

- the root symbol
- nearby graph edges
- related symbols
- related files

### `search_files`

Input:

- `repoId`
- `query`
- `limit` optional

Returns:

- matching files
- why they matched (`path`, `symbol:<name>`, or `content`)
- optional preview text

### `get_repo_status`

Input:

- `repoId`

Returns:

- repository metadata
- latest index run
- indexed file count

### `read_file_content`

Input:

- `repoId`
- `fileIdOrPath` — accepts a MongoDB fileId or a repo-relative path
- `startLine` optional (1-indexed)
- `endLine` optional (1-indexed)
- `maxLines` optional (default 200, cap 500)

Returns:

- file metadata (fileId, path, totalLines)
- bounded source content
- truncation metadata (`truncated`, `truncationMessage`)

This is intentionally separate from `get_symbol_context`. The context tool returns metadata and graph relationships; `read_file_content` returns actual source text. This separation keeps context queries lightweight and source reads explicit.

### `read_symbol_source`

Input:

- `symbolId`
- `contextLines` optional (default 5, cap 50)

Returns:

- the symbol's source span plus surrounding context lines
- symbol metadata (name, kind, span lines)
- truncation metadata when the span plus context exceeds 500 lines

### `list_repos`

Input: none

Returns:

- all registered repositories with repoId, name, rootPath, status, lastIndexedAt

### `find_repo`

Input:

- `query` — name substring or path fragment to match
- `by` — `"name"` (default) or `"path"`
- `limit` optional (cap 20)

Returns:

- matching repositories with repoId, name, rootPath, status, lastIndexedAt

## How agents should use these tools

Recommended usage pattern:

1. Register and index the repo through REST or the CLI.
2. Call `list_repos` or `find_repo` to discover the `repoId` if you do not already have it.
3. Call `get_repo_status` and confirm the repo is `ready`.
4. Use `find_symbol` to anchor on the declaration you care about.
5. Use `get_symbol_context` to gather metadata, callers, callees, and dependencies.
6. Use `read_symbol_source` to see the actual implementation code.
7. Use `read_file_content` when you need to read broader sections of a file.
8. Use `get_symbol_impact` before refactors to see the likely blast radius.
9. Use `search_files` when you only know text, path fragments, or symbol names.

## Local usage

Run the MCP server:

```bash
npm run mcp
```

The server communicates over stdio, which is the simplest fit for local coding agents.

## Example MCP client configs

### Codex

Point the MCP client at:

- command: `npm`
- args: `["run", "mcp"]`
- cwd: your `grap-local` repo root

### Claude Code

Use a stdio MCP server entry that runs:

```json
{
  "command": "npm",
  "args": ["run", "mcp"],
  "cwd": "C:/path/to/grap-local"
}
```

### Cursor

Use the same stdio command pattern:

```json
{
  "command": "npm",
  "args": ["run", "mcp"],
  "cwd": "C:/path/to/grap-local"
}
```

## Important behavior notes

- MCP tools reuse the same service layer as REST endpoints.
- `get_repo_status` and `get_file_symbols` intentionally call the same service methods as the corresponding REST flows.
- Agents should avoid trusting deep symbol or impact results when `get_repo_status` reports `indexing` or `error`.
- The MCP server writes logs to stderr so stdio protocol output stays clean.
- The server expects MongoDB connectivity because it serves indexed data, not ad hoc filesystem-only queries.
