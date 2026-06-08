// ============================================================
// mdmeta — SDK
//
// The MdMeta class provides all query primitives for AI agents
// to access Markdown documents structurally. All reads go
// through .meta for structure and .md for content.
// ============================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, join, extname } from 'node:path';
import { parseContent } from '../parser/parser.js';
import { readMeta, writeMeta } from '../parser/writer.js';
import {
  loadConfig,
  resolveRoots,
  isMetaStale,
  readLines,
  ALWAYS_IGNORED,
} from '../shared/index.js';
import { buildOutline } from './outline.js';
import type {
  MdMetaConfig,
  DocumentMeta,
  SectionMeta,
  OutlineNode,
} from '../shared/types.js';

// ── Result Types ─────────────────────────────────────────────

export interface SectionResult {
  content: string;
  meta: SectionMeta;
}

export interface ContextResult {
  section: SectionResult;
  parent: SectionResult | null;
  siblings: SectionMeta[];
}

export interface SearchMatch {
  section: SectionMeta;
  snippets: string[];
  match_count: number;
}

export interface SearchResult {
  matches: SearchMatch[];
}

// ── MdMeta Class ─────────────────────────────────────────────

export class MdMeta {
  private config: MdMetaConfig;
  private basePath: string;

  /**
   * Create an MdMeta SDK instance.
   *
   * @param config   - Configuration (loads from mdmeta.config.json if omitted)
   * @param basePath - Base path for resolving roots (defaults to cwd)
   */
  constructor(config?: MdMetaConfig, basePath?: string) {
    this.basePath = basePath ?? process.cwd();
    this.config = config ?? loadConfig(undefined, this.basePath);
  }

  // ── Private Helpers ──────────────────────────────────────

  /**
   * Ensure the .meta file for a given .md path is fresh.
   * If missing or stale, recomputes from the .md file.
   *
   * @returns The current DocumentMeta and file content
   */
  private ensureMeta(mdPath: string): { meta: DocumentMeta; content: string } {
    const content = readFileSync(mdPath, 'utf-8');
    let meta = readMeta(mdPath);

    if (!meta || isMetaStale(meta, content)) {
      const sourcePath = relative(this.basePath, mdPath);
      meta = parseContent(content, this.config, sourcePath);
      writeMeta(mdPath, meta);
    }

    return { meta, content };
  }

  /**
   * Find a section by heading text (case-insensitive) or section ID.
   * Throws if not found.
   */
  private findSection(
    sections: SectionMeta[],
    heading: string,
  ): SectionMeta {
    // Try exact ID match first
    const byId = sections.find((s) => s.id === heading);
    if (byId) return byId;

    // Try case-insensitive heading text match
    const lower = heading.toLowerCase();
    const byHeading = sections.find(
      (s) => s.heading.toLowerCase() === lower,
    );
    if (byHeading) return byHeading;

    // Try partial match (heading text contains the query)
    const partial = sections.find(
      (s) => s.heading.toLowerCase().includes(lower),
    );
    if (partial) return partial;

    const available = sections
      .map((s) => `"${s.heading}" (${s.id})`)
      .join(', ');
    throw new Error(
      `Section not found: "${heading}". Available sections: ${available}`,
    );
  }

  /**
   * Extract the content for a section from the file content.
   */
  private getSectionContent(
    content: string,
    section: SectionMeta,
  ): string {
    return readLines(content, section.line_start, section.line_end);
  }

  // ── Public API ───────────────────────────────────────────

  /**
   * Get the full content of a section by heading name or ID.
   *
   * Accepts:
   * - Exact section ID (e.g. `"install-steps"`)
   * - Heading text, case-insensitive (e.g. `"Install Steps"`)
   * - Partial heading match (e.g. `"install"`)
   *
   * @throws {Error} if the section is not found
   */
  getSection(file: string, heading: string): SectionResult {
    const mdPath = this.resolveFile(file);
    const { meta, content } = this.ensureMeta(mdPath);
    const section = this.findSection(meta.sections, heading);

    return {
      content: this.getSectionContent(content, section),
      meta: section,
    };
  }

  /**
   * Get the heading tree of a document.
   *
   * Returns a nested outline with section IDs, headings, character counts,
   * and last_modified timestamps. Agents can scan this to decide what to fetch.
   */
  getOutline(file: string): OutlineNode[] {
    const mdPath = this.resolveFile(file);
    const { meta } = this.ensureMeta(mdPath);
    return buildOutline(meta.sections);
  }

  /**
   * Get a section plus its structural context: parent section and siblings.
   *
   * Gives the agent awareness of where it is in the document structure.
   *
   * @throws {Error} if the section is not found
   */
  getContext(file: string, sectionId: string): ContextResult {
    const mdPath = this.resolveFile(file);
    const { meta, content } = this.ensureMeta(mdPath);
    const section = this.findSection(meta.sections, sectionId);

    // Get parent
    let parent: SectionResult | null = null;
    if (section.parent !== null) {
      const parentSection = meta.sections.find(
        (s) => s.id === section.parent,
      );
      if (parentSection) {
        parent = {
          content: this.getSectionContent(content, parentSection),
          meta: parentSection,
        };
      }
    }

    // Get siblings (sections with the same parent, excluding self)
    const siblings = meta.sections.filter(
      (s) => s.parent === section.parent && s.id !== section.id,
    );

    return {
      section: {
        content: this.getSectionContent(content, section),
        meta: section,
      },
      parent,
      siblings,
    };
  }

  /**
   * Search across sections using a regex pattern.
   *
   * Returns matched sections with context snippets
   * (the matching line ± 2 lines of surrounding context).
   *
   * @param file    - Path to the .md file
   * @param pattern - Regex pattern string (e.g. `"install.*npm"`)
   * @returns Matching sections with snippets and match counts
   * @throws {Error} if the regex pattern is invalid
   */
  searchSections(file: string, pattern: string): SearchResult {
    const mdPath = this.resolveFile(file);
    const { meta, content } = this.ensureMeta(mdPath);

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'gi');
    } catch (e) {
      throw new Error(
        `Invalid regex pattern: "${pattern}". ${e instanceof Error ? e.message : ''}`,
      );
    }

    const matches: SearchMatch[] = [];

    for (const section of meta.sections) {
      const sectionContent = this.getSectionContent(content, section);
      const sectionLines = sectionContent.split('\n');

      const snippets: string[] = [];
      let matchCount = 0;
      const addedLineRanges = new Set<string>();

      for (let i = 0; i < sectionLines.length; i++) {
        // Reset regex lastIndex for each line (since we use 'g' flag)
        regex.lastIndex = 0;

        if (regex.test(sectionLines[i])) {
          matchCount++;

          // Build snippet: matched line ± 2 lines of context
          const snippetStart = Math.max(0, i - 2);
          const snippetEnd = Math.min(sectionLines.length - 1, i + 2);
          const rangeKey = `${snippetStart}-${snippetEnd}`;

          // Avoid duplicate overlapping snippets
          if (!addedLineRanges.has(rangeKey)) {
            addedLineRanges.add(rangeKey);
            const snippet = sectionLines
              .slice(snippetStart, snippetEnd + 1)
              .join('\n');
            snippets.push(snippet);
          }
        }
      }

      if (matchCount > 0) {
        matches.push({
          section,
          snippets,
          match_count: matchCount,
        });
      }
    }

    return { matches };
  }

  /**
   * List all indexed Markdown files in the configured roots.
   *
   * Walks directories recursively, respects ignore patterns,
   * and returns paths relative to the base path.
   */
  listFiles(): string[] {
    const roots = resolveRoots(this.config, this.basePath);
    const files: string[] = [];

    for (const root of roots) {
      this.walkDir(root, files);
    }

    return files.sort();
  }

  // ── Internal Utilities ───────────────────────────────────

  /**
   * Resolve a file path relative to the base path.
   * If already absolute, returns as-is.
   */
  private resolveFile(file: string): string {
    if (file.startsWith('/')) return file;
    return resolve(this.basePath, file);
  }

  /**
   * Recursively walk a directory, collecting .md file paths.
   * Respects the config's ignore patterns and always-ignored dirs.
   */
  private walkDir(dir: string, files: string[]): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      // Directory doesn't exist or can't be read
      return;
    }

    for (const entry of entries) {
      // Check against always-ignored patterns
      if (ALWAYS_IGNORED.includes(entry as typeof ALWAYS_IGNORED[number])) {
        continue;
      }

      // Check against user ignore patterns (simple glob matching)
      if (this.isIgnored(entry)) {
        continue;
      }

      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        this.walkDir(fullPath, files);
      } else if (stat.isFile() && extname(entry) === '.md') {
        files.push(relative(this.basePath, fullPath));
      }
    }
  }

  /**
   * Check if a filename or directory name matches any ignore pattern.
   * Supports simple patterns (exact match and ** glob prefix/suffix).
   */
  private isIgnored(name: string): boolean {
    for (const pattern of this.config.ignore) {
      // Strip leading **/ for simple matching
      const cleanPattern = pattern.replace(/^\*\*\//, '').replace(/\/\*\*$/, '');

      if (name === cleanPattern) return true;
      if (name.includes(cleanPattern)) return true;
    }
    return false;
  }
}
