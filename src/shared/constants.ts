// ============================================================
// mdmeta — Constants
// ============================================================

/** File extension for metadata companion files */
export const META_EXTENSION = '.meta';

/** Current schema version for `.meta` files */
export const SCHEMA_VERSION = 1;

/** Default config file name */
export const CONFIG_FILENAME = 'mdmeta.config.json';

/** Default debounce interval for the file watcher (ms) */
export const DEFAULT_DEBOUNCE_MS = 150;

/** Section ID used for content before the first heading */
export const PREAMBLE_ID = '_preamble';

/** Patterns that are always ignored by the watcher and indexer */
export const ALWAYS_IGNORED = [
  'node_modules',
  '.git',
] as const;
