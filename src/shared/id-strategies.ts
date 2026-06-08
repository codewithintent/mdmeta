// ============================================================
// mdmeta — ID Generation Strategies
// ============================================================

import { createHash } from 'node:crypto';
import { slugify } from './utils.js';
import type { IdStrategyFn, IdStrategyName } from './types.js';

/**
 * Slug strategy: heading text → kebab-case slug.
 *
 * Produces readable, short IDs like `install-steps`.
 * Duplicate IDs are handled externally by the parser (appends `-2`, `-3`, etc.).
 *
 * @example
 * slugStrategy('Install Steps', 2, 'getting-started', 0) // → 'install-steps'
 */
export const slugStrategy: IdStrategyFn = (
  heading: string,
  _level: number,
  _parentId: string | null,
  _index: number,
): string => {
  return slugify(heading);
};

/**
 * Path strategy: encodes the full hierarchy in the ID.
 *
 * Produces globally unique IDs like `getting-started/install-steps`.
 * The parent's ID is prepended with a `/` separator.
 *
 * @example
 * pathStrategy('Install Steps', 2, 'getting-started', 0) // → 'getting-started/install-steps'
 * pathStrategy('Getting Started', 1, null, 0)             // → 'getting-started'
 */
export const pathStrategy: IdStrategyFn = (
  heading: string,
  _level: number,
  parentId: string | null,
  _index: number,
): string => {
  const slug = slugify(heading);
  if (parentId === null) {
    return slug;
  }
  return `${parentId}/${slug}`;
};

/**
 * Hash strategy: short SHA-256 hash of heading + level + index.
 *
 * Produces opaque but stable IDs like `s_a3f9c2b1`.
 * Always unique regardless of heading text. Prefixed with `s_`
 * to ensure the ID starts with a letter.
 *
 * @example
 * hashStrategy('Install Steps', 2, null, 3) // → 's_a3f9c2b1'
 */
export const hashStrategy: IdStrategyFn = (
  heading: string,
  level: number,
  parentId: string | null,
  index: number,
): string => {
  const input = `${heading}:${level}:${parentId ?? ''}:${index}`;
  const hash = createHash('sha256').update(input, 'utf-8').digest('hex');
  return `s_${hash.slice(0, 8)}`;
};

/** Map of strategy names to their implementations */
const strategies: Record<IdStrategyName, IdStrategyFn> = {
  slug: slugStrategy,
  path: pathStrategy,
  hash: hashStrategy,
};

/**
 * Get an ID generation strategy function by name.
 *
 * @throws {Error} if the strategy name is not recognized
 */
export function getIdStrategy(name: IdStrategyName): IdStrategyFn {
  const strategy = strategies[name];
  if (!strategy) {
    throw new Error(
      `Unknown ID strategy: "${name}". Valid strategies: ${Object.keys(strategies).join(', ')}`,
    );
  }
  return strategy;
}
