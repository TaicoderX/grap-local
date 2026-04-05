import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMcpServer } from '../src/modules/mcp/server.js';
import { repositoryService } from '../src/modules/repo/repository.service.js';

describe('MCP server', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes get_repo_status through repositoryService.getRepositoryStatusSummary', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer();
    const client = new Client({
      name: 'grap-local-test-client',
      version: '0.1.0'
    });
    const serviceSpy = vi.spyOn(repositoryService, 'getRepositoryStatusSummary').mockResolvedValue({
      repository: { _id: 'repo-1', name: 'demo', rootPath: '/tmp/repo', status: 'ready' } as never,
      latestIndexRun: null,
      indexedFileCount: 7
    });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: 'get_repo_status',
      arguments: {
        repoId: 'repo-1'
      }
    });

    expect(serviceSpy).toHaveBeenCalledWith('repo-1');
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({
      indexedFileCount: 7
    });

    await server.close();
    await clientTransport.close();
    await serverTransport.close();
  });
});
