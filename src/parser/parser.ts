// ============================================================
// mdmeta — Markdown Parser
//
// Parses a Markdown string into structured section metadata
// using markdown-it's lexer (no rendering). Handles:
// - ATX headings (# ... ######)
// - Setext headings (=== and ---)
// - Preamble (content before first heading)
// - Headings inside code blocks (correctly ignored)
// - Duplicate heading IDs (deduplication with -2, -3 suffixes)
// ============================================================

import MarkdownIt from 'markdown-it';
import {
  computeChecksum,
  readLines,
  getIdStrategy,
  PREAMBLE_ID,
  SCHEMA_VERSION,
} from '../shared/index.js';
import type {
  HeadingInfo,
  SectionMeta,
  DocumentMeta,
  MdMetaConfig,
  IdStrategyFn,
} from '../shared/index.js';

/** Reusable markdown-it instance (stateless, safe to share) */
const md = new MarkdownIt();

// ────────────────────────────────────────────────────────────
// Step 1: Heading Extraction
// ────────────────────────────────────────────────────────────

/**
 * Extract all headings from a Markdown string using markdown-it's lexer.
 *
 * markdown-it correctly ignores headings inside fenced code blocks
 * and handles both ATX (`#`) and setext (`===`/`---`) styles.
 *
 * @param content - Raw Markdown source
 * @returns Array of headings with text, level, and 1-indexed line numbers
 */
export function extractHeadings(content: string): HeadingInfo[] {
  const tokens = md.parse(content, {});
  const headings: HeadingInfo[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.type === 'heading_open' && token.map) {
      const level = parseInt(token.tag.slice(1), 10); // 'h2' → 2
      const line = token.map[0] + 1; // Convert 0-indexed to 1-indexed

      // The inline token immediately follows heading_open and contains the text
      const inlineToken = tokens[i + 1];
      const text = inlineToken?.content ?? '';

      headings.push({ text, level, line });
    }
  }

  return headings;
}

// ────────────────────────────────────────────────────────────
// Step 2: Section Boundary Computation
// ────────────────────────────────────────────────────────────

/** Intermediate section data before final metadata is computed */
interface RawSection {
  heading: HeadingInfo;
  lineStart: number;
  lineEnd: number;
  ownContentStart: number;
  ownContentEnd: number;
  parentIdx: number | null;
  childIndices: number[];
}

/**
 * Compute section boundaries, parent/child relationships, and
 * content ranges from a list of headings.
 *
 * Section boundary rule: a heading at depth D owns all content
 * from its line to the line before the next heading at depth ≤ D (or EOF).
 *
 * @param headings   - Extracted headings in document order
 * @param totalLines - Total number of lines in the document
 * @returns Array of raw sections with computed boundaries
 */
function computeSectionBoundaries(
  headings: HeadingInfo[],
  totalLines: number,
): RawSection[] {
  const sections: RawSection[] = [];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];

    // line_end: find the next heading at depth ≤ this heading's depth
    let lineEnd = totalLines;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= heading.level) {
        lineEnd = headings[j].line - 1;
        break;
      }
    }

    // own content: from heading line to the first child heading (or section end)
    let ownContentEnd = lineEnd;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].line > lineEnd) break;
      if (headings[j].level > heading.level) {
        // First child heading found
        ownContentEnd = headings[j].line - 1;
        break;
      }
    }

    sections.push({
      heading,
      lineStart: heading.line,
      lineEnd,
      ownContentStart: heading.line,
      ownContentEnd,
      parentIdx: null,
      childIndices: [],
    });
  }

  return sections;
}

/**
 * Build parent/child relationships between sections using a stack-based approach.
 *
 * As we process headings in document order, we maintain a stack of
 * "current ancestor at each level". When we encounter a heading at level L,
 * we pop everything at level ≥ L, and the new top-of-stack is the parent.
 */
function buildParentChildLinks(sections: RawSection[]): void {
  // Stack entries: [sectionIndex, level]
  const stack: Array<[number, number]> = [];

  for (let i = 0; i < sections.length; i++) {
    const level = sections[i].heading.level;

    // Pop everything at depth ≥ current level
    while (stack.length > 0 && stack[stack.length - 1][1] >= level) {
      stack.pop();
    }

    // Parent is the top of the stack (if any)
    if (stack.length > 0) {
      const parentIdx = stack[stack.length - 1][0];
      sections[i].parentIdx = parentIdx;
      sections[parentIdx].childIndices.push(i);
    }

    stack.push([i, level]);
  }
}

// ────────────────────────────────────────────────────────────
// Step 3: Full Parse Pipeline
// ────────────────────────────────────────────────────────────

/**
 * Parse a Markdown string into a complete `DocumentMeta` structure.
 *
 * This is the core parse pipeline:
 * 1. Lex with markdown-it (fast, no rendering)
 * 2. Extract headings with line positions
 * 3. Compute section boundaries
 * 4. Build parent/child tree
 * 5. Compute checksums and character counts
 * 6. Assign IDs using the configured strategy
 * 7. Handle preamble (content before first heading)
 *
 * @param content    - Raw Markdown source
 * @param config     - Configuration (controls ID strategy)
 * @param sourcePath - Relative path to the source file (stored in metadata)
 * @returns Complete document metadata
 */
export function parseContent(
  content: string,
  config: MdMetaConfig,
  sourcePath: string = '',
  previousMeta?: DocumentMeta,
): DocumentMeta {
  const lines = content.split('\n');
  const totalLines = lines.length;
  const headings = extractHeadings(content);
  const idStrategy = getIdStrategy(config.idStrategy);
  const now = new Date().toISOString();

  // Build raw sections from headings
  const rawSections = computeSectionBoundaries(headings, totalLines);
  buildParentChildLinks(rawSections);

  // Track seen IDs for deduplication
  const seenIds = new Map<string, number>();

  // Convert raw sections to SectionMeta (first pass — without preamble)
  const sectionMetas: SectionMeta[] = [];

  // Maps rawSection index → sectionMeta index (accounts for preamble offset)
  const indexMap = new Map<number, number>();

  // Handle preamble: content before the first heading
  const hasPreamble = headings.length === 0 || headings[0].line > 1;
  if (hasPreamble) {
    const preambleEnd = headings.length > 0 ? headings[0].line - 1 : totalLines;
    const preambleContent = readLines(content, 1, preambleEnd);
    const trimmed = preambleContent.trim();

    if (trimmed.length > 0) {
      const checksum = computeChecksum(preambleContent);
      let lastModified = now;
      if (previousMeta) {
        const prevPreamble = previousMeta.sections.find((s) => s.id === PREAMBLE_ID);
        if (prevPreamble && prevPreamble.checksum === checksum) {
          lastModified = prevPreamble.last_modified;
        }
      }

      sectionMetas.push({
        id: PREAMBLE_ID,
        heading: '',
        level: 0,
        line_start: 1,
        line_end: preambleEnd,
        char_count: trimmed.length,
        total_char_count: trimmed.length,
        subsection_count: 0,
        subsections: [],
        parent: null,
        checksum: checksum,
        last_modified: lastModified,
      });
    }
  }

  // Process each heading section
  for (let i = 0; i < rawSections.length; i++) {
    const raw = rawSections[i];

    // Get parent ID
    let parentId: string | null = null;
    if (raw.parentIdx !== null) {
      const parentMetaIdx = indexMap.get(raw.parentIdx);
      if (parentMetaIdx !== undefined) {
        parentId = sectionMetas[parentMetaIdx].id;
      }
    }

    // Generate ID with the configured strategy
    const rawId = idStrategy(raw.heading.text, raw.heading.level, parentId, i);

    // Deduplicate: append -2, -3, etc. for collisions
    const id = deduplicateId(rawId, seenIds);

    // Compute own content (between heading and first child, or section end)
    const ownContent = readLines(content, raw.ownContentStart, raw.ownContentEnd);

    // Compute full section content (including subsections)
    const fullContent = readLines(content, raw.lineStart, raw.lineEnd);

    // Store the mapping from raw index to sectionMeta index
    const metaIdx = sectionMetas.length;
    indexMap.set(i, metaIdx);

    const checksum = computeChecksum(ownContent);
    let lastModified = now;
    if (previousMeta) {
      const prevSec = previousMeta.sections.find((s) => s.id === id);
      if (prevSec && prevSec.checksum === checksum) {
        lastModified = prevSec.last_modified;
      }
    }

    sectionMetas.push({
      id,
      heading: raw.heading.text,
      level: raw.heading.level,
      line_start: raw.lineStart,
      line_end: raw.lineEnd,
      char_count: ownContent.length,
      total_char_count: fullContent.length,
      subsection_count: raw.childIndices.length,
      subsections: [], // Filled in second pass
      parent: parentId,
      checksum: checksum,
      last_modified: lastModified,
    });
  }

  // Second pass: fill in subsection IDs (now that all IDs are assigned)
  for (let i = 0; i < rawSections.length; i++) {
    const raw = rawSections[i];
    const metaIdx = indexMap.get(i)!;

    sectionMetas[metaIdx].subsections = raw.childIndices.map((childRawIdx) => {
      const childMetaIdx = indexMap.get(childRawIdx)!;
      return sectionMetas[childMetaIdx].id;
    });
  }

  return {
    version: SCHEMA_VERSION,
    source: sourcePath,
    checksum: computeChecksum(content),
    last_indexed: now,
    id_strategy: config.idStrategy,
    sections: sectionMetas,
  };
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Ensure an ID is unique by appending `-2`, `-3`, etc. if a
 * collision is detected. Updates the `seenIds` map.
 */
function deduplicateId(rawId: string, seenIds: Map<string, number>): string {
  const count = seenIds.get(rawId) ?? 0;
  seenIds.set(rawId, count + 1);

  if (count === 0) {
    return rawId;
  }

  // First collision gets -2, next gets -3, etc.
  const newId = `${rawId}-${count + 1}`;

  // Recursively check the new ID isn't also taken (edge case: heading literally named "foo-2")
  if (seenIds.has(newId)) {
    return deduplicateId(newId, seenIds);
  }

  seenIds.set(newId, 1);
  return newId;
}
