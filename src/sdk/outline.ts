// ============================================================
// mdmeta — Outline Tree Builder
//
// Converts the flat `sections[]` array from DocumentMeta into
// a nested `OutlineNode[]` tree for the getOutline() API.
// ============================================================

import type { SectionMeta, OutlineNode } from '../shared/types.js';

/**
 * Convert a flat array of sections (in document order) into a nested
 * outline tree.
 *
 * Uses a stack-based approach: for each section, we find the correct
 * parent by looking at section levels and parent IDs.
 *
 * @param sections - Flat array of sections from DocumentMeta
 * @returns Nested outline tree
 */
export function buildOutline(sections: SectionMeta[]): OutlineNode[] {
  const roots: OutlineNode[] = [];

  // Map section IDs to their OutlineNode for fast parent lookup
  const nodeMap = new Map<string, OutlineNode>();

  for (const section of sections) {
    const node: OutlineNode = {
      id: section.id,
      heading: section.heading,
      level: section.level,
      char_count: section.char_count,
      total_char_count: section.total_char_count,
      last_modified: section.last_modified,
      children: [],
    };

    nodeMap.set(section.id, node);

    if (section.parent === null) {
      // Top-level section (or preamble)
      roots.push(node);
    } else {
      // Find parent node and add as child
      const parentNode = nodeMap.get(section.parent);
      if (parentNode) {
        parentNode.children.push(node);
      } else {
        // Orphan — shouldn't happen with valid metadata, but handle gracefully
        roots.push(node);
      }
    }
  }

  return roots;
}
