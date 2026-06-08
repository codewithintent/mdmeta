import { parseContent } from '../src/parser/parser.js';

const md = `# Getting Started

Some intro text here.

## Prerequisites

You need Node.js 20+.

## Installation

Run npm install.

### From Source

Clone the repo first.

# API Reference

The API docs.
`;

const meta = parseContent(md, { roots: ['.'], ignore: [], idStrategy: 'slug', indexStrategy: 'lazy' }, 'test.md');
console.log(JSON.stringify(meta, null, 2));
