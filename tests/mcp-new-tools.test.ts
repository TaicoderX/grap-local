import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMcpServer } from '../src/modules/mcp/server.js';
import { sourceService } from '../src/modules/source/source.service.js';
import { repositoryService } from '../src/modules/repo/repository.service.js';

const setupMcpClient = async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({
    name: 'grap-local-mcp-test',
    version: '0.1.0'
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { server, client, clientTransport, serverTransport };
};

const cleanup = async (ctx: Awaited<ReturnType<typeof setupMcpClient>>) => {
  await ctx.server.close();
  await ctx.clientTransport.close();
  await ctx.serverTransport.close();
};

const parseToolResult = (result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> => {
  const firstContent = result.content[0] as { text: string };
  return JSON.parse(firstContent.text) as Record<string, unknown>;
};

describe('MCP new tools', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('read_file_content routes through sourceService.readFileContent', async () => {
    const spy = vi.spyOn(sourceService, 'readFileContent').mockResolvedValue({
      fileId: 'file-1',
      path: 'src/index.ts',
      totalLines: 100,
      startLine: 1,
      endLine: 50,
      content: 'const x = 1;',
      truncated: true,
      truncationMessage: 'Truncated to 50 lines.'
    });

    const ctx = await setupMcpClient();
    const result = await ctx.client.callTool({
      name: 'read_file_content',
      arguments: { repoId: 'repo-1', fileIdOrPath: 'src/index.ts', maxLines: 50 }
    });

    expect(spy).toHaveBeenCalledWith({
      repoId: 'repo-1',
      fileIdOrPath: 'src/index.ts',
      maxLines: 50
    });

    const parsed = parseToolResult(result);
    expect(parsed).toMatchObject({ truncated: true, path: 'src/index.ts' });

    await cleanup(ctx);
  });

  it('read_symbol_source routes through sourceService.readSymbolSource', async () => {
    const spy = vi.spyOn(sourceService, 'readSymbolSource').mockResolvedValue({
      symbolId: 'sym-1',
      symbolName: 'myFunc',
      symbolKind: 'function',
      filePath: 'src/app.ts',
      fileId: 'file-1',
      totalFileLines: 200,
      spanStartLine: 10,
      spanEndLine: 20,
      contextStartLine: 5,
      contextEndLine: 25,
      content: 'function myFunc() {}',
      truncated: false
    });

    const ctx = await setupMcpClient();
    const result = await ctx.client.callTool({
      name: 'read_symbol_source',
      arguments: { symbolId: 'sym-1', contextLines: 5 }
    });

    expect(spy).toHaveBeenCalledWith({ symbolId: 'sym-1', contextLines: 5 });

    const parsed = parseToolResult(result);
    expect(parsed).toMatchObject({
      symbolName: 'myFunc',
      content: 'function myFunc() {}'
    });

    await cleanup(ctx);
  });

  it('list_repos routes through repositoryService.listRepositories', async () => {
    const spy = vi.spyOn(repositoryService, 'listRepositories').mockResolvedValue([
      {
        _id: { toString: () => 'repo-1' },
        name: 'demo',
        rootPath: '/tmp/repo',
        status: 'ready',
        lastIndexedAt: new Date('2026-01-01')
      } as never
    ]);

    const ctx = await setupMcpClient();
    const result = await ctx.client.callTool({
      name: 'list_repos',
      arguments: {}
    });

    expect(spy).toHaveBeenCalled();

    const parsed = parseToolResult(result);
    expect(parsed).toMatchObject({
      repos: [{ name: 'demo', repoId: 'repo-1' }]
    });

    await cleanup(ctx);
  });

  it('find_repo by name routes through repositoryService.findRepositoryByName', async () => {
    const spy = vi.spyOn(repositoryService, 'findRepositoryByName').mockResolvedValue([
      {
        repoId: 'repo-2',
        name: 'my-app',
        rootPath: '/projects/my-app',
        status: 'ready',
        lastIndexedAt: new Date()
      }
    ]);

    const ctx = await setupMcpClient();
    const result = await ctx.client.callTool({
      name: 'find_repo',
      arguments: { query: 'my-app', by: 'name' }
    });

    expect(spy).toHaveBeenCalledWith('my-app', undefined);

    const parsed = parseToolResult(result);
    expect(parsed).toMatchObject({
      repos: [{ name: 'my-app' }]
    });

    await cleanup(ctx);
  });

  it('find_repo by path routes through repositoryService.findRepositoryByPath', async () => {
    const spy = vi.spyOn(repositoryService, 'findRepositoryByPath').mockResolvedValue([
      {
        repoId: 'repo-3',
        name: 'backend',
        rootPath: 'C:/projects/backend',
        status: 'ready',
        lastIndexedAt: new Date()
      }
    ]);

    const ctx = await setupMcpClient();
    const result = await ctx.client.callTool({
      name: 'find_repo',
      arguments: { query: 'projects/backend', by: 'path' }
    });

    expect(spy).toHaveBeenCalledWith('projects/backend', undefined);

    const parsed = parseToolResult(result);
    expect(parsed).toMatchObject({
      repos: [{ rootPath: 'C:/projects/backend' }]
    });

    await cleanup(ctx);
  });
});
