// ============================================================
// mdmeta — Configuration Loading
// ============================================================

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { CONFIG_FILENAME } from './constants.js';
import type { MdMetaConfig } from './types.js';

/** Default configuration used when no config file is found */
export const DEFAULT_CONFIG: MdMetaConfig = {
  roots: ['.'],
  ignore: ['node_modules', '.git'],
  idStrategy: 'slug',
  indexStrategy: 'lazy',
};

/**
 * Load configuration from a `mdmeta.config.json` file.
 *
 * Search order:
 * 1. If `configPath` is provided, load from that exact path
 * 2. Otherwise, search upward from `cwd` for `mdmeta.config.json`
 *
 * Missing fields are filled with defaults. If no config file is found,
 * returns the default configuration.
 *
 * @param configPath - Optional explicit path to the config file
 * @param cwd        - Working directory for relative path resolution (defaults to process.cwd())
 * @returns The merged configuration
 */
export function loadConfig(configPath?: string, cwd?: string): MdMetaConfig {
  const workingDir = cwd ?? process.cwd();

  let resolvedPath: string | null = null;

  if (configPath) {
    resolvedPath = resolve(workingDir, configPath);
  } else {
    // Search upward from cwd for the config file
    resolvedPath = findConfigFile(workingDir);
  }

  if (!resolvedPath || !existsSync(resolvedPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(resolvedPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<MdMetaConfig>;

    return {
      roots: parsed.roots ?? DEFAULT_CONFIG.roots,
      ignore: parsed.ignore ?? DEFAULT_CONFIG.ignore,
      idStrategy: parsed.idStrategy ?? DEFAULT_CONFIG.idStrategy,
      indexStrategy: parsed.indexStrategy ?? DEFAULT_CONFIG.indexStrategy,
    };
  } catch {
    // If the config file is malformed, fall back to defaults
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Resolve relative root paths in the config to absolute paths.
 *
 * @param config   - The loaded configuration
 * @param basePath - Base path to resolve relative roots against (typically the config file's directory or cwd)
 * @returns Array of absolute directory paths
 */
export function resolveRoots(config: MdMetaConfig, basePath: string): string[] {
  return config.roots.map((root) => resolve(basePath, root));
}

/**
 * Search upward from `startDir` for a `mdmeta.config.json` file.
 * Returns the first matching path, or null if none is found.
 */
function findConfigFile(startDir: string): string | null {
  let dir = resolve(startDir);

  while (true) {
    const candidate = resolve(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = dirname(dir);
    if (parentDir === dir) {
      // Reached filesystem root
      return null;
    }
    dir = parentDir;
  }
}
