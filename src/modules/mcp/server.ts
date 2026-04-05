import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { logger } from '../../config/logger.js';
import { connectToMongo, disconnectFromMongo } from '../../db/mongo.js';
import { graphService } from '../graph/graph.service.js';
import { repositoryService } from '../repo/repository.service.js';
import { symbolService } from '../symbols/symbol.service.js';
import { sourceService } from '../source/source.service.js';
import { serializeError } from '../../shared/utils/error.js';

const toToolResult = (payload: unknown) => {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
};

const mcpLogger = logger.child({
  component: 'mcp'
});

const createJsonToolHandler = <TArgs extends Record<string, unknown>>(
  toolName: string,
  handler: (args: TArgs) => Promise<unknown>
) => {
  return async (args: TArgs) => {
    try {
      return toToolResult(await handler(args));
    } catch (error) {
      mcpLogger.error(
        {
          toolName,
          error: serializeError(error)
        },
        'MCP tool failed'
      );
      throw error;
    }
  };
};

export const createMcpServer = (): McpServer => {
  const server = new McpServer({
    name: 'grap-local',
    version: '0.1.0'
  });

  server.registerTool(
    'find_symbol',
    {
      description: 'Find symbols by name or fqName fragment inside a registered repository.',
      inputSchema: {
        repoId: z.string().min(1),
        query: z.string().min(1),
        limit: z.number().int().positive().max(100).optional()
      }
    },
    createJsonToolHandler('find_symbol', async ({ repoId, query, limit }) => {
      const symbols = await symbolService.findSymbolsByName(repoId, query, limit ?? 20);
      return { symbols };
    })
  );

  server.registerTool(
    'get_symbol_context',
    {
      description: 'Return definition, surrounding file neighborhood, and direct dependency context for one symbol.',
      inputSchema: {
        symbolId: z.string().min(1)
      }
    },
    createJsonToolHandler('get_symbol_context', async ({ symbolId }) => graphService.getSymbolContext(symbolId))
  );

  server.registerTool(
    'get_file_symbols',
    {
      description: 'List extracted symbols for one indexed file.',
      inputSchema: {
        fileId: z.string().min(1)
      }
    },
    createJsonToolHandler('get_file_symbols', async ({ fileId }) =>
      symbolService.getFileSymbolsPage(fileId, { limit: 100, offset: 0 })
    )
  );

  server.registerTool(
    'get_symbol_impact',
    {
      description: 'Traverse nearby callers, callees, and inheritance edges for a symbol.',
      inputSchema: {
        symbolId: z.string().min(1),
        depth: z.number().int().positive().max(5).optional()
      }
    },
    createJsonToolHandler('get_symbol_impact', async ({ symbolId, depth }) =>
      graphService.getSymbolImpact(symbolId, depth ?? 2)
    )
  );

  server.registerTool(
    'search_files',
    {
      description: 'Search indexed files by path, symbol name, import path, or content snippet.',
      inputSchema: {
        repoId: z.string().min(1),
        query: z.string().min(1),
        limit: z.number().int().positive().max(50).optional()
      }
    },
    createJsonToolHandler('search_files', async ({ repoId, query, limit }) => {
      const files = await graphService.searchFiles(repoId, query, limit ?? 20);
      return { files };
    })
  );

  server.registerTool(
    'get_repo_status',
    {
      description: 'Return repository metadata, latest index run, and indexed file count.',
      inputSchema: {
        repoId: z.string().min(1)
      }
    },
    createJsonToolHandler('get_repo_status', async ({ repoId }) =>
      repositoryService.getRepositoryStatusSummary(repoId)
    )
  );

  server.registerTool(
    'read_file_content',
    {
      description:
        'Read bounded source code from an indexed file. Accepts fileId or repo-relative path. Returns content with truncation metadata. Use this to inspect actual code — get_symbol_context only returns metadata.',
      inputSchema: {
        repoId: z.string().min(1),
        fileIdOrPath: z.string().min(1),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
        maxLines: z.number().int().positive().max(500).optional()
      }
    },
    createJsonToolHandler('read_file_content', async ({ repoId, fileIdOrPath, startLine, endLine, maxLines }) =>
      sourceService.readFileContent({ repoId, fileIdOrPath, startLine, endLine, maxLines })
    )
  );

  server.registerTool(
    'read_symbol_source',
    {
      description:
        'Read the actual source code of a symbol plus surrounding context lines. Use after get_symbol_context to see the real implementation.',
      inputSchema: {
        symbolId: z.string().min(1),
        contextLines: z.number().int().nonnegative().max(50).optional()
      }
    },
    createJsonToolHandler('read_symbol_source', async ({ symbolId, contextLines }) =>
      sourceService.readSymbolSource({ symbolId, contextLines })
    )
  );

  server.registerTool(
    'list_repos',
    {
      description:
        'List all registered repositories with their repoId, name, rootPath, status, and lastIndexedAt. Use this first if you do not know the repoId.',
      inputSchema: {}
    },
    createJsonToolHandler('list_repos', async () => {
      const repositories = await repositoryService.listRepositories();
      return {
        repos: repositories.map((repo) => ({
          repoId: repo._id.toString(),
          name: repo.name,
          rootPath: repo.rootPath,
          status: repo.status,
          lastIndexedAt: repo.lastIndexedAt
        }))
      };
    })
  );

  server.registerTool(
    'find_repo',
    {
      description:
        'Discover a repository by name or local path fragment. Returns matching repos with repoId. Use when you know the project name or directory but not the repoId.',
      inputSchema: {
        query: z.string().min(1),
        by: z.enum(['name', 'path']).default('name'),
        limit: z.number().int().positive().max(20).optional()
      }
    },
    createJsonToolHandler('find_repo', async ({ query, by, limit }) => {
      const repos =
        by === 'path'
          ? await repositoryService.findRepositoryByPath(query, limit)
          : await repositoryService.findRepositoryByName(query, limit);
      return { repos };
    })
  );

  return server;
};

const main = async (): Promise<void> => {
  await connectToMongo();
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error('grap-local MCP server running on stdio');

  const shutdown = async () => {
    await server.close();
    await disconnectFromMongo();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });

  process.on('SIGTERM', () => {
    void shutdown();
  });
};

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  void main().catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await disconnectFromMongo();
    process.exit(1);
  });
}
