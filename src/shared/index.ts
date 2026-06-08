// ============================================================
// mdmeta — Shared Module Barrel Export
// ============================================================

export type {
  HeadingInfo,
  SectionMeta,
  DocumentMeta,
  OutlineNode,
  IdStrategyName,
  IndexStrategyName,
  MdMetaConfig,
  IdStrategyFn,
} from './types.js';

export {
  META_EXTENSION,
  SCHEMA_VERSION,
  CONFIG_FILENAME,
  DEFAULT_DEBOUNCE_MS,
  PREAMBLE_ID,
  ALWAYS_IGNORED,
} from './constants.js';

export {
  computeChecksum,
  getMetaPath,
  isMetaStale,
  readLines,
  slugify,
} from './utils.js';

export {
  slugStrategy,
  pathStrategy,
  hashStrategy,
  getIdStrategy,
} from './id-strategies.js';

export {
  loadConfig,
  resolveRoots,
  DEFAULT_CONFIG,
} from './config.js';
