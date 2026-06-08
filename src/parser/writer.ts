// ============================================================
// mdmeta — Meta File I/O
//
// Reads and writes `.meta` companion files (JSON format).
// ============================================================

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { getMetaPath } from '../shared/index.js';
import type { DocumentMeta } from '../shared/index.js';

/**
 * Write a `DocumentMeta` object to the `.meta` companion file.
 *
 * The file is written as pretty-printed JSON (2-space indent)
 * for human inspectability and git diffability.
 *
 * @param mdPath - Path to the source `.md` file
 * @param meta   - The document metadata to write
 */
export function writeMeta(mdPath: string, meta: DocumentMeta): void {
  const metaPath = getMetaPath(mdPath);
  const json = JSON.stringify(meta, null, 2) + '\n';
  writeFileSync(metaPath, json, 'utf-8');
}

/**
 * Read and parse the `.meta` companion file for a given `.md` file.
 *
 * Returns `null` if the `.meta` file doesn't exist or is malformed JSON.
 * Does NOT validate the schema beyond basic JSON parsing — the caller
 * should check the `version` field and `checksum` for staleness.
 *
 * @param mdPath - Path to the source `.md` file
 * @returns Parsed `DocumentMeta` or `null`
 */
export function readMeta(mdPath: string): DocumentMeta | null {
  const metaPath = getMetaPath(mdPath);

  if (!existsSync(metaPath)) {
    return null;
  }

  try {
    const raw = readFileSync(metaPath, 'utf-8');
    const parsed = JSON.parse(raw) as DocumentMeta;

    // Basic sanity check: must have version and sections array
    if (
      typeof parsed.version !== 'number' ||
      !Array.isArray(parsed.sections)
    ) {
      return null;
    }

    return parsed;
  } catch {
    // Malformed JSON or read error
    return null;
  }
}

/**
 * Remove the `.meta` companion file for a given `.md` file.
 * No-op if the `.meta` file doesn't exist.
 *
 * @param mdPath - Path to the source `.md` file
 */
export function removeMeta(mdPath: string): void {
  const metaPath = getMetaPath(mdPath);

  if (existsSync(metaPath)) {
    unlinkSync(metaPath);
  }
}
