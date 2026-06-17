// ============================================================
// mdmeta — MCP Server Entry Point
//
// Creates the MCP server, connects it to a stdio transport,
// and handles graceful shutdown.
// ============================================================

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMdMetaServer } from './server.js';
import { loadConfig, resolveRoots } from '../shared/config.js';
import type { MdMetaConfig } from '../shared/types.js';

/**
 * Start the MCP server with stdio transport.
 *
 * @param config   - Configuration (loads from mdmeta.config.json if omitted)
 * @param basePath - Base path for resolving roots (defaults to cwd)
 */
export async function startServer(
  config?: MdMetaConfig,
  basePath?: string,
  onShutdown?: () => Promise<void>,
): Promise<void> {
  const resolvedBase = basePath ?? process.cwd();
  const resolvedConfig = config ?? loadConfig(undefined, resolvedBase);

  const server = createMdMetaServer(resolvedConfig, resolvedBase);
  const transport = new StdioServerTransport();

  // Log to stderr (stdout is reserved for JSON-RPC protocol)
  const roots = resolveRoots(resolvedConfig, resolvedBase);
  console.error(`[mdmeta] Starting MCP server`);
  console.error(`[mdmeta] Roots: ${roots.join(', ')}`);
  console.error(`[mdmeta] ID strategy: ${resolvedConfig.idStrategy}`);
  console.error(`[mdmeta] Index strategy: ${resolvedConfig.indexStrategy}`);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.error('[mdmeta] Shutting down...');
    if (onShutdown) {
      await onShutdown();
    }
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.error('[mdmeta] Shutting down...');
    if (onShutdown) {
      await onShutdown();
    }
    await server.close();
    process.exit(0);
  });

  await server.connect(transport);
  console.error('[mdmeta] Server connected and ready');
}

export { createMdMetaServer } from './server.js';
