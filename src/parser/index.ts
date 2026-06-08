// ============================================================
// mdmeta — Parser Public API
// ============================================================

import { readFileSync } from 'node:fs';
import { relative, dirname } from 'node:path';
import { parseContent, extractHeadings } from './parser.js';
import { writeMeta, readMeta, removeMeta } from './writer.js';
import { loadConfig } from '../shared/config.js';
import type { DocumentMeta, MdMetaConfig } from '../shared/types.js';

/**
 * Parse a Markdown file and write its `.meta` companion file.
 *
 * This is the main entry point for one-shot parsing. It:
 * 1. Reads the `.md` file from disk
 * 2. Parses the content into a `DocumentMeta` structure
 * 3. Writes the `.meta` file alongside the source
 * 4. Returns the metadata
 *
 * @param mdPath - Absolute or relative path to the `.md` file
 * @param config - Configuration (optional — loads from `mdmeta.config.json` if omitted)
 * @returns The computed document metadata
 */
export function parseMd(mdPath: string, config?: MdMetaConfig): DocumentMeta {
  const resolvedConfig = config ?? loadConfig(undefined, dirname(mdPath));
  const content = readFileSync(mdPath, 'utf-8');
  const sourcePath = relative(process.cwd(), mdPath);
  const meta = parseContent(content, resolvedConfig, sourcePath);

  writeMeta(mdPath, meta);

  return meta;
}

// Re-export internals for direct use
export { parseContent, extractHeadings } from './parser.js';
export { writeMeta, readMeta, removeMeta } from './writer.js';
