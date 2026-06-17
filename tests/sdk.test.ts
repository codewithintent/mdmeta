// ============================================================
// mdmeta — SDK Tests
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { MdMeta } from '../src/sdk/sdk.js';
import { removeMeta } from '../src/parser/writer.js';
import { getMetaPath } from '../src/shared/utils.js';
import type { MdMetaConfig } from '../src/shared/types.js';

// ── Helpers ──────────────────────────────────────────────────

const REAL_FIXTURES = resolve(import.meta.dirname, 'fixtures');
const FIXTURES = resolve(import.meta.dirname, 'tmp_sdk');

function setupTmpSdk() {
  if (existsSync(FIXTURES)) {
    rmSync(FIXTURES, { recursive: true, force: true });
  }
  mkdirSync(FIXTURES, { recursive: true });

  const files = readdirSync(REAL_FIXTURES);
  for (const file of files) {
    const src = join(REAL_FIXTURES, file);
    const dest = join(FIXTURES, file);
    try {
      copyFileSync(src, dest);
    } catch {
      // ignore
    }
  }
}

function cleanupTmpSdk() {
  if (existsSync(FIXTURES)) {
    rmSync(FIXTURES, { recursive: true, force: true });
  }
}

function fixturePath(name: string): string {
  return resolve(FIXTURES, name);
}

const defaultConfig: MdMetaConfig = {
  roots: [FIXTURES],
  ignore: [],
  idStrategy: 'slug',
  indexStrategy: 'lazy',
};

function createSdk(configOverrides?: Partial<MdMetaConfig>): MdMeta {
  const config = { ...defaultConfig, ...configOverrides };
  return new MdMeta(config, FIXTURES);
}

/** Clean up any .meta files that were generated during tests */
function cleanMeta(...filenames: string[]): void {
  for (const name of filenames) {
    removeMeta(fixturePath(name));
  }
}

beforeEach(() => {
  setupTmpSdk();
});

afterEach(() => {
  cleanupTmpSdk();
});

// ── getSection ───────────────────────────────────────────────

describe('MdMeta.getSection', () => {
  afterEach(() => {
    cleanMeta('simple.md', 'nested.md', 'preamble.md');
  });

  it('finds a section by exact heading text', () => {
    const sdk = createSdk();
    const result = sdk.getSection(fixturePath('simple.md'), 'Getting Started');

    expect(result.meta.heading).toBe('Getting Started');
    expect(result.meta.level).toBe(2);
    expect(result.content).toContain('Install the package');
  });

  it('finds a section by heading text case-insensitively', () => {
    const sdk = createSdk();
    const result = sdk.getSection(fixturePath('simple.md'), 'getting started');

    expect(result.meta.heading).toBe('Getting Started');
  });

  it('finds a section by section ID', () => {
    const sdk = createSdk();
    const result = sdk.getSection(fixturePath('simple.md'), 'configuration');

    expect(result.meta.heading).toBe('Configuration');
    expect(result.meta.id).toBe('configuration');
  });

  it('finds a section by partial heading match', () => {
    const sdk = createSdk();
    const result = sdk.getSection(fixturePath('nested.md'), 'Frontend');

    expect(result.meta.heading).toBe('Frontend');
    expect(result.content).toContain('React');
  });

  it('returns correct content for a leaf section', () => {
    const sdk = createSdk();
    const result = sdk.getSection(fixturePath('nested.md'), 'database');

    expect(result.meta.heading).toBe('Database');
    expect(result.meta.subsection_count).toBe(0);
    expect(result.content).toContain('PostgreSQL');
  });

  it('returns content including subsections for a parent section', () => {
    const sdk = createSdk();
    const result = sdk.getSection(fixturePath('simple.md'), 'Introduction');

    // Introduction (h1) should include its h2 children content
    expect(result.content).toContain('Getting Started');
    expect(result.content).toContain('Configuration');
  });

  it('throws for a non-existent heading', () => {
    const sdk = createSdk();

    expect(() => {
      sdk.getSection(fixturePath('simple.md'), 'nonexistent-heading');
    }).toThrow(/Section not found/);
  });

  it('throws with available sections listed in error message', () => {
    const sdk = createSdk();

    try {
      sdk.getSection(fixturePath('simple.md'), 'does-not-exist');
      expect.fail('Should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('Introduction');
      expect(msg).toContain('Getting Started');
      expect(msg).toContain('Configuration');
    }
  });

  it('can retrieve the preamble section', () => {
    const sdk = createSdk();
    const result = sdk.getSection(fixturePath('preamble.md'), '_preamble');

    expect(result.meta.id).toBe('_preamble');
    expect(result.meta.level).toBe(0);
    expect(result.content).toContain('preamble content');
  });
});

// ── getOutline ───────────────────────────────────────────────

describe('MdMeta.getOutline', () => {
  afterEach(() => {
    cleanMeta('simple.md', 'nested.md', 'no-headings.md');
  });

  it('returns a nested tree for a simple document', () => {
    const sdk = createSdk();
    const outline = sdk.getOutline(fixturePath('simple.md'));

    // Root should have one h1 node
    expect(outline).toHaveLength(1);
    expect(outline[0].heading).toBe('Introduction');
    expect(outline[0].level).toBe(1);

    // h1 should have two h2 children
    expect(outline[0].children).toHaveLength(2);
    expect(outline[0].children[0].heading).toBe('Getting Started');
    expect(outline[0].children[1].heading).toBe('Configuration');
  });

  it('returns deeply nested tree', () => {
    const sdk = createSdk();
    const outline = sdk.getOutline(fixturePath('nested.md'));

    // Root: one h1
    expect(outline).toHaveLength(1);
    const root = outline[0];
    expect(root.heading).toBe('Project Overview');

    // h1 has 2 h2 children
    expect(root.children).toHaveLength(2);
    const arch = root.children.find((c) => c.heading === 'Architecture')!;
    const deploy = root.children.find((c) => c.heading === 'Deployment')!;

    // Architecture has 2 h3 children
    expect(arch.children).toHaveLength(2);
    const frontend = arch.children.find((c) => c.heading === 'Frontend')!;

    // Frontend has 2 h4 children
    expect(frontend.children).toHaveLength(2);
    expect(frontend.children.map((c) => c.heading)).toEqual([
      'Components',
      'Routing',
    ]);

    // Deployment > Production > Rollback
    const prod = deploy.children.find((c) => c.heading === 'Production')!;
    expect(prod.children).toHaveLength(1);
    expect(prod.children[0].heading).toBe('Rollback');
  });

  it('outline nodes have char_count and last_modified', () => {
    const sdk = createSdk();
    const outline = sdk.getOutline(fixturePath('simple.md'));

    const node = outline[0];
    expect(node.char_count).toBeGreaterThan(0);
    expect(node.total_char_count).toBeGreaterThan(0);
    expect(node.last_modified).toBeTruthy();
    expect(new Date(node.last_modified).getTime()).not.toBeNaN();
  });

  it('returns preamble as a root node when present', () => {
    const sdk = createSdk();
    const outline = sdk.getOutline(fixturePath('no-headings.md'));

    expect(outline).toHaveLength(1);
    expect(outline[0].id).toBe('_preamble');
    expect(outline[0].level).toBe(0);
    expect(outline[0].children).toHaveLength(0);
  });
});

// ── getContext ────────────────────────────────────────────────

describe('MdMeta.getContext', () => {
  afterEach(() => {
    cleanMeta('simple.md', 'nested.md');
  });

  it('returns parent and siblings for a nested section', () => {
    const sdk = createSdk();
    const ctx = sdk.getContext(fixturePath('simple.md'), 'getting-started');

    // Section itself
    expect(ctx.section.meta.heading).toBe('Getting Started');
    expect(ctx.section.content).toContain('Install the package');

    // Parent
    expect(ctx.parent).not.toBeNull();
    expect(ctx.parent!.meta.heading).toBe('Introduction');

    // Siblings (same parent, excluding self)
    expect(ctx.siblings).toHaveLength(1);
    expect(ctx.siblings[0].heading).toBe('Configuration');
  });

  it('returns null parent for top-level sections', () => {
    const sdk = createSdk();
    const ctx = sdk.getContext(fixturePath('simple.md'), 'introduction');

    expect(ctx.parent).toBeNull();
    expect(ctx.siblings).toHaveLength(0); // no other top-level sections
  });

  it('returns correct siblings for deeply nested sections', () => {
    const sdk = createSdk();
    const ctx = sdk.getContext(fixturePath('nested.md'), 'frontend');

    // Parent should be Architecture
    expect(ctx.parent!.meta.heading).toBe('Architecture');

    // Sibling should be Backend
    expect(ctx.siblings).toHaveLength(1);
    expect(ctx.siblings[0].heading).toBe('Backend');
  });

  it('throws for non-existent section', () => {
    const sdk = createSdk();

    expect(() => {
      sdk.getContext(fixturePath('simple.md'), 'nonexistent');
    }).toThrow(/Section not found/);
  });
});

// ── searchSections ───────────────────────────────────────────

describe('MdMeta.searchSections', () => {
  afterEach(() => {
    cleanMeta('simple.md', 'nested.md', 'code-blocks.md');
  });

  it('finds matches with a simple regex pattern', () => {
    const sdk = createSdk();
    const result = sdk.searchSections(fixturePath('simple.md'), 'config');

    expect(result.matches.length).toBeGreaterThan(0);

    // Configuration section should be in the matches
    const configMatch = result.matches.find(
      (m) => m.section.heading === 'Configuration',
    );
    expect(configMatch).toBeDefined();
    expect(configMatch!.match_count).toBeGreaterThan(0);
  });

  it('returns snippets with context around matches', () => {
    const sdk = createSdk();
    const result = sdk.searchSections(fixturePath('simple.md'), 'environment');

    expect(result.matches.length).toBeGreaterThan(0);

    const match = result.matches[0];
    expect(match.snippets.length).toBeGreaterThan(0);
    // Snippet should contain the matching line
    expect(match.snippets[0]).toContain('environment');
  });

  it('returns empty matches for no-match pattern', () => {
    const sdk = createSdk();
    const result = sdk.searchSections(
      fixturePath('simple.md'),
      'xyznonexistent123',
    );

    expect(result.matches).toHaveLength(0);
  });

  it('supports regex special characters', () => {
    const sdk = createSdk();
    const result = sdk.searchSections(
      fixturePath('simple.md'),
      'DEBUG=\\w+',
    );

    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('throws for invalid regex', () => {
    const sdk = createSdk();

    expect(() => {
      sdk.searchSections(fixturePath('simple.md'), '[invalid');
    }).toThrow(/Invalid regex/);
  });

  it('matches across multiple sections', () => {
    const sdk = createSdk();
    // "the" should appear in multiple sections
    const result = sdk.searchSections(fixturePath('nested.md'), 'the');

    expect(result.matches.length).toBeGreaterThan(1);
  });
});

// ── listFiles ────────────────────────────────────────────────

describe('MdMeta.listFiles', () => {
  it('lists all .md files in the fixtures directory', () => {
    const sdk = createSdk({ roots: [FIXTURES] });
    const files = sdk.listFiles();

    expect(files.length).toBeGreaterThanOrEqual(7);
    expect(files).toContain('simple.md');
    expect(files).toContain('nested.md');
    expect(files).toContain('code-blocks.md');
    expect(files).toContain('preamble.md');
  });

  it('returns sorted file list', () => {
    const sdk = createSdk({ roots: [FIXTURES] });
    const files = sdk.listFiles();

    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });

  it('does not include non-.md files', () => {
    const sdk = createSdk({ roots: [FIXTURES] });
    const files = sdk.listFiles();

    for (const file of files) {
      expect(file).toMatch(/\.md$/);
    }
  });

  it('respects ignore patterns', () => {
    const sdk = createSdk({
      roots: [FIXTURES],
      ignore: ['simple'],
    });
    const files = sdk.listFiles();

    expect(files).not.toContain('simple.md');
  });
});

// ── Stale Meta Auto-Recomputation ────────────────────────────

describe('MdMeta — stale meta recomputation', () => {
  const tmpDir = resolve(FIXTURES, '__tmp_stale_test');
  const tmpFile = join(tmpDir, 'stale-test.md');

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      tmpFile,
      '# Original\n\nOriginal content.\n\n## Section A\n\nFirst section.\n',
      'utf-8',
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('recomputes .meta when source file changes', () => {
    const sdk = new MdMeta(
      { ...defaultConfig, roots: [tmpDir] },
      tmpDir,
    );

    // First access — generates .meta
    const result1 = sdk.getSection(tmpFile, 'Original');
    expect(result1.content).toContain('Original content');

    // Modify the file
    writeFileSync(
      tmpFile,
      '# Original\n\nUpdated content here.\n\n## Section A\n\nFirst section.\n',
      'utf-8',
    );

    // Second access — should detect stale .meta and recompute
    const result2 = sdk.getSection(tmpFile, 'Original');
    expect(result2.content).toContain('Updated content here');
  });

  it('generates .meta on first access when none exists', () => {
    const sdk = new MdMeta(
      { ...defaultConfig, roots: [tmpDir] },
      tmpDir,
    );

    // No .meta file should exist yet
    expect(existsSync(getMetaPath(tmpFile))).toBe(false);

    // Access triggers generation
    sdk.getSection(tmpFile, 'Original');

    // .meta should now exist
    expect(existsSync(getMetaPath(tmpFile))).toBe(true);
  });

  it('detects new sections after file modification', () => {
    const sdk = new MdMeta(
      { ...defaultConfig, roots: [tmpDir] },
      tmpDir,
    );

    // First access
    const outline1 = sdk.getOutline(tmpFile);
    const sectionCount1 = outline1[0].children.length;

    // Add a new section
    writeFileSync(
      tmpFile,
      '# Original\n\nContent.\n\n## Section A\n\nFirst.\n\n## Section B\n\nSecond.\n',
      'utf-8',
    );

    // Second access — should find the new section
    const outline2 = sdk.getOutline(tmpFile);
    expect(outline2[0].children.length).toBe(sectionCount1 + 1);

    const newSection = sdk.getSection(tmpFile, 'Section B');
    expect(newSection.content).toContain('Second');
  });
});
