// ============================================================
// mdmeta — File Watcher
//
// MetaWatcher watches .md files using chokidar and updates
// .meta companion files on creation, change, or deletion.
// Supports eager, lazy, and hybrid indexing strategies.
// ============================================================

import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { watch } from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { parseContent } from '../parser/parser.js';
import { writeMeta, readMeta, removeMeta } from '../parser/writer.js';
import {
  loadConfig,
  resolveRoots,
  isMetaStale,
  DEFAULT_DEBOUNCE_MS,
  ALWAYS_IGNORED,
} from '../shared/index.js';
import type { MdMetaConfig, DocumentMeta } from '../shared/types.js';

export class MetaWatcher extends EventEmitter {
  private rootDir: string;
  private config: MdMetaConfig;
  private watcher: FSWatcher | null = null;
  private debounceMs: number;
  private isReady = false;
  private debounceTimeouts = new Map<string, NodeJS.Timeout>();

  /**
   * Create a MetaWatcher instance.
   *
   * @param rootDir - Root directory containing markdown files
   * @param options - Configuration options (overrides defaults)
   */
  constructor(rootDir: string, options?: { config?: MdMetaConfig; debounceMs?: number }) {
    super();
    this.rootDir = resolve(rootDir);
    this.config = options?.config ?? loadConfig(undefined, this.rootDir);
    this.debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /**
   * Start watching .md files. Returns a promise that resolves
   * when the initial scan is complete.
   */
  async start(): Promise<void> {
    if (this.watcher) {
      return;
    }

    const roots = resolveRoots(this.config, this.rootDir);
    const validRoots = roots.filter((r) => existsSync(r));

    if (validRoots.length === 0) {
      this.isReady = true;
      this.emit('ready');
      return;
    }

    const ignoredFn = (filePath: string) => {
      if (filePath.endsWith('.meta')) {
        return true;
      }

      const normalized = filePath.replace(/\\/g, '/');
      const parts = normalized.split('/');

      // Check always-ignored directories
      for (const pattern of ALWAYS_IGNORED) {
        if (parts.includes(pattern)) {
          return true;
        }
      }

      // Check config ignore patterns
      for (const pattern of this.config.ignore) {
        const cleanPattern = pattern.replace(/^\*\*\//, '').replace(/\/\*\*$/, '');
        if (parts.includes(cleanPattern)) {
          return true;
        }
        if (normalized.includes(cleanPattern)) {
          return true;
        }
      }

      return false;
    };

    this.watcher = watch(validRoots, {
      ignored: ignoredFn,
      persistent: true,
      ignoreInitial: false,
    });

    this.watcher.on('add', (filePath: string) => {
      const absolutePath = resolve(filePath);
      if (this.isReady) {
        this.debounceProcess(absolutePath, 'add');
      } else {
        this.processFileImmediate(absolutePath, 'add');
      }
    });

    this.watcher.on('change', (filePath: string) => {
      const absolutePath = resolve(filePath);
      this.debounceProcess(absolutePath, 'change');
    });

    this.watcher.on('unlink', (filePath: string) => {
      const absolutePath = resolve(filePath);
      this.handleDelete(absolutePath);
    });

    this.watcher.on('error', (error: unknown) => {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    });

    return new Promise<void>((resolvePromise) => {
      this.watcher!.once('ready', () => {
        this.isReady = true;
        this.emit('ready');
        resolvePromise();
      });
    });
  }

  /**
   * Stop watching and clean up all resources.
   */
  async stop(): Promise<void> {
    if (!this.watcher) {
      return;
    }

    for (const timeout of this.debounceTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.debounceTimeouts.clear();

    await this.watcher.close();
    this.watcher = null;
    this.isReady = false;
  }

  /**
   * Debounce file processing to handle rapid saves.
   */
  private debounceProcess(filePath: string, eventType: 'add' | 'change'): void {
    if (this.debounceTimeouts.has(filePath)) {
      clearTimeout(this.debounceTimeouts.get(filePath)!);
    }

    const timeout = setTimeout(() => {
      this.debounceTimeouts.delete(filePath);
      this.processFileImmediate(filePath, eventType);
    }, this.debounceMs);

    this.debounceTimeouts.set(filePath, timeout);
  }

  /**
   * Process a file immediately.
   */
  private processFileImmediate(filePath: string, eventType: 'add' | 'change'): void {
    if (!filePath.endsWith('.md')) {
      return;
    }

    try {
      if (!existsSync(filePath)) {
        return;
      }

      const content = readFileSync(filePath, 'utf-8');
      const existingMeta = readMeta(filePath) || undefined;

      // Handle indexing strategies during the initial scan
      if (!this.isReady) {
        if (this.config.indexStrategy === 'lazy') {
          return;
        }
        if (
          this.config.indexStrategy === 'hybrid' &&
          existingMeta &&
          !isMetaStale(existingMeta, content)
        ) {
          return;
        }
      }

      const relativeSource = relative(this.rootDir, filePath);
      const meta = parseContent(content, this.config, relativeSource, existingMeta);
      writeMeta(filePath, meta);

      this.emit(eventType, relativeSource, meta);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Handle file deletion.
   */
  private handleDelete(filePath: string): void {
    if (this.debounceTimeouts.has(filePath)) {
      clearTimeout(this.debounceTimeouts.get(filePath)!);
      this.debounceTimeouts.delete(filePath);
    }

    if (!filePath.endsWith('.md')) {
      return;
    }

    try {
      const relativeSource = relative(this.rootDir, filePath);
      removeMeta(filePath);
      this.emit('unlink', relativeSource);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }
}
