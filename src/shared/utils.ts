// ============================================================
// mdmeta — Utility Functions
// ============================================================

import { createHash } from 'node:crypto';
import { META_EXTENSION } from './constants.js';
import type { DocumentMeta } from './types.js';

/**
 * Compute a SHA-256 hex digest of the given content.
 */
export function computeChecksum(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Derive the `.meta` companion file path from a `.md` file path.
 *
 * @example
 * getMetaPath('/docs/setup.md') // → '/docs/setup.md.meta'
 */
export function getMetaPath(mdPath: string): string {
  return mdPath + META_EXTENSION;
}

/**
 * Check whether a cached `DocumentMeta` is stale relative to
 * the current `.md` file content.
 *
 * Returns `true` if the metadata should be recomputed.
 */
export function isMetaStale(meta: DocumentMeta, mdContent: string): boolean {
  const currentChecksum = computeChecksum(mdContent);
  return meta.checksum !== currentChecksum;
}

/**
 * Extract a range of lines from content.
 *
 * @param content - The full file content
 * @param start  - 1-indexed start line (inclusive)
 * @param end    - 1-indexed end line (inclusive)
 * @returns The extracted text including newlines between lines
 */
export function readLines(content: string, start: number, end: number): string {
  const lines = content.split('\n');
  // Convert 1-indexed to 0-indexed, slice is exclusive on end
  const slice = lines.slice(start - 1, end);
  return slice.join('\n');
}

/**
 * Slugify a heading string into a URL/ID-safe format.
 *
 * - Converts to lowercase
 * - Replaces whitespace and special characters with hyphens
 * - Collapses consecutive hyphens
 * - Trims leading/trailing hyphens
 *
 * @example
 * slugify('Install Steps')        // → 'install-steps'
 * slugify('What is MDX?')         // → 'what-is-mdx'
 * slugify('  Spaced  Out  ')      // → 'spaced-out'
 * slugify('C++ & Rust')           // → 'c-rust'
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')    // strip non-word chars (except spaces and hyphens)
    .replace(/[\s_]+/g, '-')     // spaces and underscores → hyphens
    .replace(/-+/g, '-')         // collapse consecutive hyphens
    .replace(/^-+|-+$/g, '');    // trim leading/trailing hyphens
}
