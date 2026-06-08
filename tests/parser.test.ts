// ============================================================
// mdmeta — Parser Tests
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseContent, extractHeadings } from '../src/parser/parser.js';
import { parseMd, readMeta, writeMeta, removeMeta } from '../src/parser/index.js';
import { computeChecksum } from '../src/shared/utils.js';
import type { MdMetaConfig, DocumentMeta } from '../src/shared/types.js';

// ── Helpers ──────────────────────────────────────────────────

const FIXTURES = resolve(import.meta.dirname, 'fixtures');

function fixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf-8');
}

function fixturePath(name: string): string {
  return resolve(FIXTURES, name);
}

const defaultConfig: MdMetaConfig = {
  roots: ['.'],
  ignore: [],
  idStrategy: 'slug',
  indexStrategy: 'lazy',
};

function parse(content: string, config?: Partial<MdMetaConfig>): DocumentMeta {
  return parseContent(content, { ...defaultConfig, ...config }, 'test.md');
}

// ── Heading Extraction ───────────────────────────────────────

describe('extractHeadings', () => {
  it('extracts ATX headings with correct levels and lines', () => {
    const content = fixture('simple.md');
    const headings = extractHeadings(content);

    expect(headings).toHaveLength(3);
    expect(headings[0]).toEqual({ text: 'Introduction', level: 1, line: 1 });
    expect(headings[1]).toEqual({ text: 'Getting Started', level: 2, line: 5 });
    expect(headings[2]).toEqual({ text: 'Configuration', level: 2, line: 13 });
  });

  it('extracts deeply nested headings', () => {
    const headings = extractHeadings(fixture('nested.md'));

    // Count by level
    const levels = headings.map((h) => h.level);
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(levels.filter((l) => l === 2)).toHaveLength(2);
    expect(levels.filter((l) => l === 3)).toHaveLength(4);
    expect(levels.filter((l) => l === 4)).toHaveLength(5);
  });

  it('ignores headings inside fenced code blocks', () => {
    const headings = extractHeadings(fixture('code-blocks.md'));

    // Only real headings should be extracted
    const texts = headings.map((h) => h.text);
    expect(texts).toContain('Real Heading');
    expect(texts).toContain('Second Real Heading');
    expect(texts).toContain('Third Real Heading');
    expect(texts).toHaveLength(3);

    // Fake headings inside code blocks must NOT appear
    expect(texts).not.toContain('Fake Heading Inside Code');
    expect(texts).not.toContain('Another Fake Heading');
    expect(texts).not.toContain('Yet another fake heading');
  });

  it('extracts setext-style headings', () => {
    const headings = extractHeadings(fixture('setext.md'));

    expect(headings.length).toBeGreaterThanOrEqual(4);

    // Setext h1 (===)
    const mainTitle = headings.find((h) => h.text === 'Main Title');
    expect(mainTitle).toBeDefined();
    expect(mainTitle!.level).toBe(1);

    // Setext h2 (---)
    const subtitle = headings.find((h) => h.text === 'Subtitle');
    expect(subtitle).toBeDefined();
    expect(subtitle!.level).toBe(2);

    // ATX heading mixed in
    const atx = headings.find((h) => h.text === 'ATX Heading');
    expect(atx).toBeDefined();
    expect(atx!.level).toBe(2);
  });

  it('returns empty array for document with no headings', () => {
    const headings = extractHeadings(fixture('no-headings.md'));
    expect(headings).toHaveLength(0);
  });
});

// ── Section Boundaries ───────────────────────────────────────

describe('parseContent — section boundaries', () => {
  it('computes correct line ranges for simple document', () => {
    const meta = parse(fixture('simple.md'));

    const intro = meta.sections.find((s) => s.id === 'introduction');
    const getting = meta.sections.find((s) => s.id === 'getting-started');
    const config = meta.sections.find((s) => s.id === 'configuration');

    expect(intro).toBeDefined();
    expect(getting).toBeDefined();
    expect(config).toBeDefined();

    // Parent h1 section spans the entire document (contains its h2 children)
    expect(intro!.line_start).toBe(1);
    const lines = fixture('simple.md').split('\n');
    expect(intro!.line_end).toBe(lines.length);

    // Sibling h2 sections should not overlap with each other
    expect(getting!.line_end).toBeLessThan(config!.line_start);

    // Last section should end at the last line
    expect(config!.line_end).toBe(lines.length);
  });

  it('sections span from heading to next equal-or-higher heading', () => {
    const meta = parse(fixture('nested.md'));

    // h1 "Project Overview" should span the entire document
    const overview = meta.sections.find((s) => s.id === 'project-overview');
    expect(overview).toBeDefined();
    const totalLines = fixture('nested.md').split('\n').length;
    expect(overview!.line_start).toBe(1);
    expect(overview!.line_end).toBe(totalLines);
  });

  it('handles document with no headings as single preamble', () => {
    const meta = parse(fixture('no-headings.md'));

    expect(meta.sections).toHaveLength(1);
    expect(meta.sections[0].id).toBe('_preamble');
    expect(meta.sections[0].level).toBe(0);
    expect(meta.sections[0].line_start).toBe(1);

    const totalLines = fixture('no-headings.md').split('\n').length;
    expect(meta.sections[0].line_end).toBe(totalLines);
  });
});

// ── Parent/Child Relationships ───────────────────────────────

describe('parseContent — parent/child relationships', () => {
  it('builds correct parent links for nested document', () => {
    const meta = parse(fixture('nested.md'));

    const find = (id: string) => meta.sections.find((s) => s.id === id);

    // Top-level h1 has no parent
    expect(find('project-overview')?.parent).toBeNull();

    // h2 sections are children of h1
    expect(find('architecture')?.parent).toBe('project-overview');
    expect(find('deployment')?.parent).toBe('project-overview');

    // h3 sections are children of their h2
    expect(find('frontend')?.parent).toBe('architecture');
    expect(find('backend')?.parent).toBe('architecture');
    expect(find('staging')?.parent).toBe('deployment');
    expect(find('production')?.parent).toBe('deployment');

    // h4 sections are children of their h3
    expect(find('components')?.parent).toBe('frontend');
    expect(find('routing')?.parent).toBe('frontend');
    expect(find('database')?.parent).toBe('backend');
    expect(find('rollback')?.parent).toBe('production');
  });

  it('populates subsections arrays correctly', () => {
    const meta = parse(fixture('nested.md'));

    const find = (id: string) => meta.sections.find((s) => s.id === id);

    // Project Overview has 2 direct children: Architecture, Deployment
    const overview = find('project-overview');
    expect(overview?.subsections).toEqual(['architecture', 'deployment']);
    expect(overview?.subsection_count).toBe(2);

    // Frontend has 2 children: Components, Routing
    const frontend = find('frontend');
    expect(frontend?.subsections).toEqual(['components', 'routing']);
    expect(frontend?.subsection_count).toBe(2);

    // Leaf nodes have no children
    expect(find('components')?.subsections).toEqual([]);
    expect(find('components')?.subsection_count).toBe(0);
  });

  it('simple document has correct parent/child structure', () => {
    const meta = parse(fixture('simple.md'));

    const intro = meta.sections.find((s) => s.id === 'introduction');
    expect(intro?.parent).toBeNull();
    expect(intro?.subsections).toEqual(['getting-started', 'configuration']);

    const getting = meta.sections.find((s) => s.id === 'getting-started');
    expect(getting?.parent).toBe('introduction');
    expect(getting?.subsections).toEqual([]);
  });
});

// ── Preamble Detection ───────────────────────────────────────

describe('parseContent — preamble', () => {
  it('detects preamble when content precedes first heading', () => {
    const meta = parse(fixture('preamble.md'));

    const preamble = meta.sections.find((s) => s.id === '_preamble');
    expect(preamble).toBeDefined();
    expect(preamble!.level).toBe(0);
    expect(preamble!.heading).toBe('');
    expect(preamble!.line_start).toBe(1);
    expect(preamble!.parent).toBeNull();
  });

  it('preamble ends at the line before first heading', () => {
    const content = fixture('preamble.md');
    const meta = parse(content);

    const preamble = meta.sections.find((s) => s.id === '_preamble');
    const firstHeading = meta.sections.find((s) => s.level > 0);

    expect(preamble).toBeDefined();
    expect(firstHeading).toBeDefined();
    expect(preamble!.line_end).toBe(firstHeading!.line_start - 1);
  });

  it('no preamble when document starts with a heading', () => {
    const meta = parse(fixture('simple.md'));

    const preamble = meta.sections.find((s) => s.id === '_preamble');
    expect(preamble).toBeUndefined();
  });
});

// ── Code Block Safety ────────────────────────────────────────

describe('parseContent — code blocks', () => {
  it('does not create sections for headings inside code blocks', () => {
    const meta = parse(fixture('code-blocks.md'));

    const ids = meta.sections.map((s) => s.id);

    // Only real headings should produce sections
    expect(ids).toContain('real-heading');
    expect(ids).toContain('second-real-heading');
    expect(ids).toContain('third-real-heading');

    // No sections for fake headings
    expect(ids).not.toContain('fake-heading-inside-code');
    expect(ids).not.toContain('another-fake-heading');
  });

  it('sections after code blocks have correct line ranges', () => {
    const meta = parse(fixture('code-blocks.md'));
    const content = fixture('code-blocks.md');

    const second = meta.sections.find((s) => s.id === 'second-real-heading');
    expect(second).toBeDefined();

    // Verify the content at the section's line_start is actually the heading
    const lines = content.split('\n');
    const headingLine = lines[second!.line_start - 1];
    expect(headingLine).toBe('## Second Real Heading');
  });
});

// ── Setext Headings ──────────────────────────────────────────

describe('parseContent — setext headings', () => {
  it('correctly parses setext h1 and h2 headings', () => {
    const meta = parse(fixture('setext.md'));

    const mainTitle = meta.sections.find((s) => s.heading === 'Main Title');
    expect(mainTitle).toBeDefined();
    expect(mainTitle!.level).toBe(1);

    const subtitle = meta.sections.find((s) => s.heading === 'Subtitle');
    expect(subtitle).toBeDefined();
    expect(subtitle!.level).toBe(2);
    expect(subtitle!.parent).toBe(mainTitle!.id);
  });

  it('mixes ATX and setext headings correctly', () => {
    const meta = parse(fixture('setext.md'));

    const headings = meta.sections.map((s) => s.heading);
    expect(headings).toContain('Main Title');
    expect(headings).toContain('Subtitle');
    expect(headings).toContain('ATX Heading');
    expect(headings).toContain('Another Section');
  });
});

// ── Duplicate Heading IDs ────────────────────────────────────

describe('parseContent — duplicate heading deduplication', () => {
  it('appends -2, -3 suffixes to duplicate IDs', () => {
    const meta = parse(fixture('duplicate-headings.md'));

    const ids = meta.sections.map((s) => s.id);

    // First occurrence: normal
    expect(ids).toContain('setup');
    expect(ids).toContain('configuration');
    expect(ids).toContain('usage');

    // Second occurrence: -2 suffix
    expect(ids).toContain('configuration-2');
    expect(ids).toContain('usage-2');
    expect(ids).toContain('setup-2');
  });

  it('all IDs are unique', () => {
    const meta = parse(fixture('duplicate-headings.md'));

    const ids = meta.sections.map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ── ID Strategies ────────────────────────────────────────────

describe('parseContent — ID strategies', () => {
  const content = fixture('nested.md');

  it('slug strategy produces kebab-case IDs', () => {
    const meta = parse(content, { idStrategy: 'slug' });

    const ids = meta.sections.map((s) => s.id);
    expect(ids).toContain('project-overview');
    expect(ids).toContain('frontend');
    expect(ids).toContain('database');

    // All IDs should be lowercase kebab-case
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('path strategy encodes hierarchy in IDs', () => {
    const meta = parse(content, { idStrategy: 'path' });

    const find = (heading: string) =>
      meta.sections.find((s) => s.heading === heading);

    // Top-level: just the slug
    expect(find('Project Overview')?.id).toBe('project-overview');

    // Nested: parent/child path
    expect(find('Architecture')?.id).toBe('project-overview/architecture');
    expect(find('Frontend')?.id).toBe(
      'project-overview/architecture/frontend',
    );
    expect(find('Components')?.id).toBe(
      'project-overview/architecture/frontend/components',
    );
  });

  it('hash strategy produces opaque s_ prefixed IDs', () => {
    const meta = parse(content, { idStrategy: 'hash' });

    for (const section of meta.sections) {
      expect(section.id).toMatch(/^s_[a-f0-9]{8}$/);
    }

    // All IDs should be unique
    const ids = meta.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('hash strategy produces deterministic IDs', () => {
    const meta1 = parse(content, { idStrategy: 'hash' });
    const meta2 = parse(content, { idStrategy: 'hash' });

    for (let i = 0; i < meta1.sections.length; i++) {
      expect(meta1.sections[i].id).toBe(meta2.sections[i].id);
    }
  });

  it('stores the strategy name in metadata', () => {
    expect(parse(content, { idStrategy: 'slug' }).id_strategy).toBe('slug');
    expect(parse(content, { idStrategy: 'path' }).id_strategy).toBe('path');
    expect(parse(content, { idStrategy: 'hash' }).id_strategy).toBe('hash');
  });
});

// ── Character Counts ─────────────────────────────────────────

describe('parseContent — character counts', () => {
  it('char_count is positive for sections with content', () => {
    const meta = parse(fixture('simple.md'));

    for (const section of meta.sections) {
      expect(section.char_count).toBeGreaterThan(0);
    }
  });

  it('total_char_count >= char_count', () => {
    const meta = parse(fixture('nested.md'));

    for (const section of meta.sections) {
      expect(section.total_char_count).toBeGreaterThanOrEqual(
        section.char_count,
      );
    }
  });

  it('parent total_char_count > child total_char_count', () => {
    const meta = parse(fixture('nested.md'));

    const find = (id: string) => meta.sections.find((s) => s.id === id)!;

    const overview = find('project-overview');
    const architecture = find('architecture');
    const frontend = find('frontend');

    expect(overview.total_char_count).toBeGreaterThan(
      architecture.total_char_count,
    );
    expect(architecture.total_char_count).toBeGreaterThan(
      frontend.total_char_count,
    );
  });
});

// ── Checksums ────────────────────────────────────────────────

describe('parseContent — checksums', () => {
  it('document checksum matches SHA-256 of content', () => {
    const content = fixture('simple.md');
    const meta = parse(content);
    expect(meta.checksum).toBe(computeChecksum(content));
  });

  it('section checksums change when content changes', () => {
    const content1 = '# Hello\n\nWorld\n';
    const content2 = '# Hello\n\nChanged content\n';

    const meta1 = parse(content1);
    const meta2 = parse(content2);

    expect(meta1.sections[0].checksum).not.toBe(meta2.sections[0].checksum);
  });

  it('section checksums are stable for identical content', () => {
    const content = fixture('simple.md');

    const meta1 = parse(content);
    const meta2 = parse(content);

    for (let i = 0; i < meta1.sections.length; i++) {
      expect(meta1.sections[i].checksum).toBe(meta2.sections[i].checksum);
    }
  });

  it('each section has a non-empty checksum', () => {
    const meta = parse(fixture('nested.md'));

    for (const section of meta.sections) {
      expect(section.checksum).toBeTruthy();
      expect(section.checksum.length).toBe(64); // SHA-256 hex = 64 chars
    }
  });
});

// ── Meta File I/O ────────────────────────────────────────────

describe('parseMd — file I/O roundtrip', () => {
  const testFile = fixturePath('simple.md');

  beforeEach(() => {
    // Clean up any leftover .meta file
    removeMeta(testFile);
  });

  it('writes .meta file and reads it back', () => {
    const meta = parseMd(testFile, defaultConfig);

    // .meta file should now exist
    const readBack = readMeta(testFile);
    expect(readBack).not.toBeNull();
    expect(readBack!.version).toBe(meta.version);
    expect(readBack!.checksum).toBe(meta.checksum);
    expect(readBack!.sections).toHaveLength(meta.sections.length);

    // Clean up
    removeMeta(testFile);
  });

  it('readMeta returns null when .meta does not exist', () => {
    const result = readMeta(testFile);
    expect(result).toBeNull();
  });

  it('removeMeta cleans up .meta file', () => {
    parseMd(testFile, defaultConfig);

    // Should exist now
    expect(readMeta(testFile)).not.toBeNull();

    removeMeta(testFile);

    // Should be gone
    expect(readMeta(testFile)).toBeNull();
  });
});

// ── Document Metadata ────────────────────────────────────────

describe('parseContent — document metadata', () => {
  it('sets version to current schema version', () => {
    const meta = parse(fixture('simple.md'));
    expect(meta.version).toBe(1);
  });

  it('sets source path', () => {
    const meta = parseContent(fixture('simple.md'), defaultConfig, 'docs/simple.md');
    expect(meta.source).toBe('docs/simple.md');
  });

  it('sets last_indexed to a valid ISO timestamp', () => {
    const meta = parse(fixture('simple.md'));
    const date = new Date(meta.last_indexed);
    expect(date.getTime()).not.toBeNaN();
  });

  it('sections are in document order', () => {
    const meta = parse(fixture('nested.md'));

    for (let i = 1; i < meta.sections.length; i++) {
      expect(meta.sections[i].line_start).toBeGreaterThanOrEqual(
        meta.sections[i - 1].line_start,
      );
    }
  });
});
