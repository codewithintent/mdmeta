#!/usr/bin/env node
// ============================================================
// mdmeta — CLI
//
// Commands:
//   mdmeta serve [--watch] [--config <path>] [--root <dir>]
//   mdmeta watch [--config <path>] [--root <dir>]
//   mdmeta parse <file> [--id-strategy slug|path|hash]
//   mdmeta init
// ============================================================

import { resolve } from 'node:path';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { startServer } from './index.js';
import { parseMd } from '../parser/index.js';
import { loadConfig, DEFAULT_CONFIG } from '../shared/config.js';
import { CONFIG_FILENAME } from '../shared/constants.js';
import { MetaWatcher } from '../watcher/index.js';
import type { MdMetaConfig, IdStrategyName } from '../shared/types.js';

// ── Argument Parsing ─────────────────────────────────────────

interface CliArgs {
  command: string;
  file?: string;
  configPath?: string;
  root?: string;
  watch?: boolean;
  idStrategy?: IdStrategyName;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2); // skip node and script path
  const command = args[0] ?? 'help';

  const result: CliArgs = { command };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--config':
        result.configPath = args[++i];
        break;
      case '--root':
        result.root = args[++i];
        break;
      case '--watch':
        result.watch = true;
        break;
      case '--id-strategy':
        result.idStrategy = args[++i] as IdStrategyName;
        break;
      default:
        // Positional argument (e.g., file path for `parse`)
        if (!arg.startsWith('-') && !result.file) {
          result.file = arg;
        }
        break;
    }
  }

  return result;
}

// ── Commands ─────────────────────────────────────────────────

async function cmdServe(args: CliArgs): Promise<void> {
  const config = buildConfig(args);
  const basePath = process.cwd();
  let onShutdown: (() => Promise<void>) | undefined;

  if (args.watch) {
    console.error('[mdmeta] Starting with file watcher...');
    const watcher = new MetaWatcher(basePath, { config });

    watcher.on('add', (path) => console.error(`[watcher] Added & indexed: ${path}`));
    watcher.on('change', (path) => console.error(`[watcher] Updated & re-indexed: ${path}`));
    watcher.on('unlink', (path) => console.error(`[watcher] Removed metadata for: ${path}`));
    watcher.on('error', (err) => console.error(`[watcher] Error:`, err));

    await watcher.start();
    console.error('[mdmeta] File watcher ready.');

    onShutdown = async () => {
      console.error('[mdmeta] Stopping file watcher...');
      await watcher.stop();
    };
  }

  await startServer(config, basePath, onShutdown);
}

function cmdParse(args: CliArgs): void {
  if (!args.file) {
    console.error('Usage: mdmeta parse <file> [--id-strategy slug|path|hash]');
    process.exit(1);
  }

  const filePath = resolve(process.cwd(), args.file);

  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const config = buildConfig(args);

  if (args.idStrategy) {
    config.idStrategy = args.idStrategy;
  }

  const meta = parseMd(filePath, config);

  // Output to stdout as pretty JSON
  console.log(JSON.stringify(meta, null, 2));
}

function cmdInit(): void {
  const configPath = resolve(process.cwd(), CONFIG_FILENAME);

  if (existsSync(configPath)) {
    console.error(`Config file already exists: ${configPath}`);
    process.exit(1);
  }

  const defaultJson = JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n';
  writeFileSync(configPath, defaultJson, 'utf-8');

  console.log(`Created ${CONFIG_FILENAME}`);
  console.log(defaultJson);
}

async function cmdWatch(args: CliArgs): Promise<void> {
  const config = buildConfig(args);
  const basePath = process.cwd();

  console.error(`[mdmeta] Starting standalone file watcher in ${basePath}...`);
  const watcher = new MetaWatcher(basePath, { config });

  watcher.on('ready', () => console.error('[watcher] Initial scan complete. Watching for changes...'));
  watcher.on('add', (path) => console.error(`[watcher] Added & indexed: ${path}`));
  watcher.on('change', (path) => console.error(`[watcher] Updated & re-indexed: ${path}`));
  watcher.on('unlink', (path) => console.error(`[watcher] Removed metadata for: ${path}`));
  watcher.on('error', (err) => console.error(`[watcher] Error:`, err));

  await watcher.start();

  const cleanup = async () => {
    console.error('\n[mdmeta] Stopping watcher...');
    await watcher.stop();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

function cmdHelp(): void {
  console.log(`
mdmeta — AI-native Markdown document indexing

Commands:
  serve [--watch]              Start the MCP server (with optional file watcher)
  parse <file>                 Parse a .md file and output .meta JSON
  watch                        Run the file watcher standalone
  init                         Create a default mdmeta.config.json

Options:
  --config <path>              Path to mdmeta.config.json
  --root <dir>                 Override root directory
  --id-strategy <name>         ID strategy: slug, path, or hash (parse only)

Examples:
  mdmeta serve                 Start MCP server
  mdmeta serve --watch         Start MCP server with file watching
  mdmeta parse docs/setup.md   Parse a single file
  mdmeta init                  Create config file
`.trim());
}

// ── Helpers ──────────────────────────────────────────────────

function buildConfig(args: CliArgs): MdMetaConfig {
  const config = loadConfig(args.configPath);

  if (args.root) {
    config.roots = [args.root];
  }

  return config;
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  switch (args.command) {
    case 'serve':
      await cmdServe(args);
      break;
    case 'parse':
      cmdParse(args);
      break;
    case 'watch':
      await cmdWatch(args);
      break;
    case 'init':
      cmdInit();
      break;
    case 'help':
    case '--help':
    case '-h':
      cmdHelp();
      break;
    default:
      console.error(`Unknown command: ${args.command}`);
      cmdHelp();
      process.exit(1);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
