# Data Model

## Collections

### Repository

Fields:

- `name`
- `rootPath`
- `languageHints`
- `lastIndexedAt`
- `status`

Indexes:

- unique `rootPath`
- `status + lastIndexedAt`
- `name`

Purpose:

- identifies a registered local repository
- stores the current indexing state for that repo

### FileDocument

Fields:

- `repoId`
- `path`
- `extension`
- `contentHash`
- `lastModifiedAt`
- `indexedAt`
- `symbolIds`
- `importPaths`
- `textPreview`

Indexes:

- unique `repoId + path`
- `repoId + indexedAt`
- `repoId + importPaths`

Purpose:

- stores one indexed source file record
- tracks the hash used for incremental skip logic
- keeps lightweight search and context metadata without storing full file content

Notes:

- `indexedAt` is only set after a successful refresh for that file
- if a refresh fails before completion, the hash may already be present but the missing `indexedAt` keeps the file eligible for reindex

### SymbolDocument

Fields:

- `repoId`
- `fileId`
- `name`
- `kind`
- `fqName`
- `exported`
- `startLine`
- `endLine`
- `signature`
- `parentSymbolId`
- `metadata`

Indexes:

- unique `repoId + fqName`
- `repoId + name`
- `repoId + exported + name`
- `fileId + startLine`
- `parentSymbolId`

Purpose:

- stores extracted declarations and nested class methods
- supports symbol lookup by name and stable file-relative identity

### EdgeDocument

Fields:

- `repoId`
- `fromSymbolId`
- `toSymbolId`
- `type`
- `metadata`

Indexes:

- `repoId + fromSymbolId + type`
- `repoId + toSymbolId + type`
- unique `repoId + fromSymbolId + toSymbolId + type`

Purpose:

- stores graph relationships such as `calls`, `extends`, and `implements`

### IndexRun

Fields:

- `repoId`
- `startedAt`
- `finishedAt`
- `scannedFiles`
- `indexedFiles`
- `skippedFiles`
- `errors`
- `status`

Indexes:

- `repoId + startedAt`
- unique partial `repoId + status` when `status` is `running`

Purpose:

- provides a record of indexing activity and partial failures
- also acts as the per-repository concurrency guard for indexing

## Identity strategy

### File identity

Files are uniquely identified by `repoId + path`.

### Symbol identity

Symbols use a file-relative fully qualified name:

- `src/foo.ts::run`
- `src/foo.ts::Greeter`
- `src/foo.ts::Greeter#greet`

This is stable enough for the MVP and keeps the symbol graph human-readable.

## What is intentionally not stored

- full file content
- ASTs
- embeddings
- unresolved "best guess" call edges

The design keeps the database lean and only stores data the current MVP can produce honestly. It stores small previews for indexed files, but not full source content.
