// ============================================================
// mdmeta — MCP Server Tool Registrations
//
// Wraps the MdMeta SDK as MCP tools callable by AI agents.
// Each tool maps directly to an SDK method.
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MdMeta } from '../sdk/sdk.js';
import type { MdMetaConfig } from '../shared/types.js';

/**
 * Create and configure an MCP server with all mdmeta tools registered.
 *
 * @param config   - mdmeta configuration
 * @param basePath - Base path for resolving file paths
 * @returns Configured McpServer instance
 */
export function createMdMetaServer(
  config: MdMetaConfig,
  basePath: string,
): McpServer {
  const sdk = new MdMeta(config, basePath);

  const server = new McpServer({
    name: 'mdmeta',
    version: '0.1.0',
  });

  // ── get_section ──────────────────────────────────────────

  server.tool(
    'get_section',
    'Get the full content of a Markdown section by heading name or section ID. ' +
      'Supports case-insensitive and partial heading matching.',
    {
      file: z.string().describe('Path to the .md file'),
      heading: z
        .string()
        .describe('Heading text or section ID to look up'),
    },
    async ({ file, heading }) => {
      try {
        const result = sdk.getSection(file, heading);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  heading: result.meta.heading,
                  id: result.meta.id,
                  level: result.meta.level,
                  line_start: result.meta.line_start,
                  line_end: result.meta.line_end,
                  char_count: result.meta.char_count,
                  parent: result.meta.parent,
                  subsections: result.meta.subsections,
                  content: result.content,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── get_outline ──────────────────────────────────────────

  server.tool(
    'get_outline',
    'Get the full heading tree of a Markdown document. ' +
      'Returns nested sections with IDs, character counts, and last-modified timestamps. ' +
      'Use this to plan which sections to fetch.',
    {
      file: z.string().describe('Path to the .md file'),
    },
    async ({ file }) => {
      try {
        const outline = sdk.getOutline(file);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(outline, null, 2),
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── get_context ──────────────────────────────────────────

  server.tool(
    'get_context',
    'Get a section plus its structural context: parent section content and sibling section metadata. ' +
      'Gives awareness of where you are in the document.',
    {
      file: z.string().describe('Path to the .md file'),
      section_id: z
        .string()
        .describe('Section ID or heading text to get context for'),
    },
    async ({ file, section_id }) => {
      try {
        const ctx = sdk.getContext(file, section_id);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  section: {
                    id: ctx.section.meta.id,
                    heading: ctx.section.meta.heading,
                    level: ctx.section.meta.level,
                    content: ctx.section.content,
                  },
                  parent: ctx.parent
                    ? {
                        id: ctx.parent.meta.id,
                        heading: ctx.parent.meta.heading,
                        level: ctx.parent.meta.level,
                        content: ctx.parent.content,
                      }
                    : null,
                  siblings: ctx.siblings.map((s) => ({
                    id: s.id,
                    heading: s.heading,
                    level: s.level,
                    char_count: s.char_count,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── search_sections ──────────────────────────────────────

  server.tool(
    'search_sections',
    'Search across all sections of a Markdown document using a regex pattern. ' +
      'Returns matching sections with context snippets and match counts.',
    {
      file: z.string().describe('Path to the .md file'),
      pattern: z
        .string()
        .describe('Regex pattern to search for (e.g. "install.*npm")'),
    },
    async ({ file, pattern }) => {
      try {
        const result = sdk.searchSections(file, pattern);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  total_matches: result.matches.reduce(
                    (sum, m) => sum + m.match_count,
                    0,
                  ),
                  sections: result.matches.map((m) => ({
                    id: m.section.id,
                    heading: m.section.heading,
                    match_count: m.match_count,
                    snippets: m.snippets,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── list_files ───────────────────────────────────────────

  server.tool(
    'list_files',
    'List all indexed Markdown files in the configured root directories. ' +
      'Returns file paths relative to the project root.',
    {},
    async () => {
      try {
        const files = sdk.listFiles();
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { total: files.length, files },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}
