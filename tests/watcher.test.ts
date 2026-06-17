import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MetaWatcher } from '../src/watcher/watcher.js';
import { readMeta, writeMeta } from '../src/parser/writer.js';
import { computeChecksum } from '../src/shared/utils.js';
import type { MdMetaConfig } from '../src/shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TMP_DIR = resolve(__dirname, 'tmp_watcher');

function cleanupTmpDir() {
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true, force: true });
  }
}

describe('MetaWatcher', () => {
  beforeEach(() => {
    cleanupTmpDir();
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanupTmpDir();
  });

  const defaultConfig: MdMetaConfig = {
    roots: ['.'],
    ignore: ['node_modules', '.git'],
    idStrategy: 'slug',
    indexStrategy: 'lazy',
  };

  it('lazy indexing: does not index on boot', async () => {
    const mdFile = join(TMP_DIR, 'test.md');
    writeFileSync(mdFile, '# Heading\nContent', 'utf-8');

    const watcher = new MetaWatcher(TMP_DIR, {
      config: { ...defaultConfig, indexStrategy: 'lazy' },
      debounceMs: 20,
    });

    await watcher.start();

    expect(existsSync(mdFile + '.meta')).toBe(false);

    await watcher.stop();
  });

  it('eager indexing: indexes all files on boot', async () => {
    const mdFile = join(TMP_DIR, 'test.md');
    writeFileSync(mdFile, '# Heading\nContent', 'utf-8');

    const watcher = new MetaWatcher(TMP_DIR, {
      config: { ...defaultConfig, indexStrategy: 'eager' },
      debounceMs: 20,
    });

    await watcher.start();

    expect(existsSync(mdFile + '.meta')).toBe(true);

    const meta = readMeta(mdFile);
    expect(meta).toBeDefined();
    expect(meta?.sections[0].heading).toBe('Heading');

    await watcher.stop();
  });

  it('hybrid indexing: only indexes stale or missing files on boot', async () => {
    const file1 = join(TMP_DIR, 'file1.md');
    const file2 = join(TMP_DIR, 'file2.md');

    writeFileSync(file1, '# File 1\nContent', 'utf-8');
    writeFileSync(file2, '# File 2\nContent', 'utf-8');

    // Create meta files initially using eager watcher
    const initWatcher = new MetaWatcher(TMP_DIR, {
      config: { ...defaultConfig, indexStrategy: 'eager' },
      debounceMs: 10,
    });
    await initWatcher.start();
    await initWatcher.stop();

    expect(existsSync(file1 + '.meta')).toBe(true);
    expect(existsSync(file2 + '.meta')).toBe(true);

    // Modify file1 (stale)
    writeFileSync(file1, '# File 1\nModified Content', 'utf-8');

    // Mutate file2.meta's timestamp manually so we can verify if it gets rewritten
    const meta2 = readMeta(file2)!;
    const oldTimestamp = '2000-01-01T00:00:00.000Z';
    meta2.last_indexed = oldTimestamp;
    writeMeta(file2, meta2);

    // Start hybrid watcher
    const watcher = new MetaWatcher(TMP_DIR, {
      config: { ...defaultConfig, indexStrategy: 'hybrid' },
      debounceMs: 20,
    });

    await watcher.start();

    // file1.meta should be updated with the new checksum
    const newMeta1 = readMeta(file1)!;
    expect(newMeta1.checksum).toBe(computeChecksum('# File 1\nModified Content'));
    expect(newMeta1.last_indexed).not.toBe(oldTimestamp);

    // file2.meta should NOT be updated because it was not stale
    const newMeta2 = readMeta(file2)!;
    expect(newMeta2.last_indexed).toBe(oldTimestamp);

    await watcher.stop();
  });

  it('detects file creation (add event) and handles file deletion (unlink event)', async () => {
    const watcher = new MetaWatcher(TMP_DIR, {
      config: { ...defaultConfig, indexStrategy: 'lazy' },
      debounceMs: 20,
    });

    await watcher.start();

    const mdFile = join(TMP_DIR, 'new.md');

    // 1. Test creation
    const addPromise = new Promise<string>((resolve) => {
      watcher.on('add', (relPath) => resolve(relPath));
    });

    writeFileSync(mdFile, '# New Document\nSome content here.', 'utf-8');

    const addedPath = await addPromise;
    expect(addedPath).toBe('new.md');
    expect(existsSync(mdFile + '.meta')).toBe(true);

    // 2. Test deletion
    const unlinkPromise = new Promise<string>((resolve) => {
      watcher.on('unlink', (relPath) => resolve(relPath));
    });

    rmSync(mdFile);

    const deletedPath = await unlinkPromise;
    expect(deletedPath).toBe('new.md');
    expect(existsSync(mdFile + '.meta')).toBe(false);

    await watcher.stop();
  });

  it('detects file changes and preserves last_modified for unchanged sections', async () => {
    const mdFile = join(TMP_DIR, 'doc.md');
    writeFileSync(mdFile, '# Sec A\nContent A\n\n# Sec B\nContent B\n', 'utf-8');

    const watcher = new MetaWatcher(TMP_DIR, {
      config: { ...defaultConfig, indexStrategy: 'eager' },
      debounceMs: 20,
    });

    await watcher.start();

    // Verify initial meta structure
    const initialMeta = readMeta(mdFile)!;
    const secAInit = initialMeta.sections.find((s) => s.id === 'sec-a')!;
    const secBInit = initialMeta.sections.find((s) => s.id === 'sec-b')!;

    expect(secAInit).toBeDefined();
    expect(secBInit).toBeDefined();

    // Manually skew initial section timestamps so we can clearly tell if they were modified/preserved
    const skewDate = '2020-05-05T05:05:05.000Z';
    secAInit.last_modified = skewDate;
    secBInit.last_modified = skewDate;
    writeMeta(mdFile, initialMeta);

    // Modify only Section B in the file
    const changePromise = new Promise<void>((resolve) => {
      watcher.on('change', () => resolve());
    });

    writeFileSync(mdFile, '# Sec A\nContent A\n\n# Sec B\nContent B Modified\n', 'utf-8');

    await changePromise;

    const updatedMeta = readMeta(mdFile)!;
    const secAUpdated = updatedMeta.sections.find((s) => s.id === 'sec-a')!;
    const secBUpdated = updatedMeta.sections.find((s) => s.id === 'sec-b')!;

    // Section A content didn't change: last_modified should be preserved
    expect(secAUpdated.last_modified).toBe(skewDate);

    // Section B content changed: last_modified should be updated to a newer date
    expect(secBUpdated.last_modified).not.toBe(skewDate);
    expect(new Date(secBUpdated.last_modified).getTime()).toBeGreaterThan(
      new Date(skewDate).getTime()
    );

    await watcher.stop();
  });

  it('debounces multiple rapid saves into a single parse execution', async () => {
    const mdFile = join(TMP_DIR, 'save.md');
    writeFileSync(mdFile, '# Title\nInitial', 'utf-8');

    const watcher = new MetaWatcher(TMP_DIR, {
      config: { ...defaultConfig, indexStrategy: 'eager' },
      debounceMs: 100,
    });

    await watcher.start();

    let changeEventCount = 0;
    watcher.on('change', () => {
      changeEventCount++;
    });

    // Write rapidly 4 times
    writeFileSync(mdFile, '# Title\nWrite 1', 'utf-8');
    writeFileSync(mdFile, '# Title\nWrite 2', 'utf-8');
    writeFileSync(mdFile, '# Title\nWrite 3', 'utf-8');
    writeFileSync(mdFile, '# Title\nWrite 4', 'utf-8');

    // Wait longer than debounceMs
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Should only trigger 1 change event
    expect(changeEventCount).toBe(1);

    // Meta file content should reflect the final write
    const finalMeta = readMeta(mdFile)!;
    expect(finalMeta.checksum).toBe(computeChecksum('# Title\nWrite 4'));

    await watcher.stop();
  });
});
