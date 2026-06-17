# mdmeta

AI-Native Markdown Document Indexing & Structural Query Engine

**NOTE:** This repository is a conceptual idea fully implemented by an AI agent under pair programming guidance.

## The Problem

LLMs and autonomous AI agents frequently require context from documentation files to answer queries, perform edits, or execute tasks. However:
- **Token Inflation**: Standard file tools force agents to read entire markdown documents, consuming excessive tokens and increasing operational costs.
- **Context Pollution**: Irrelevant parts of the document crowd the prompt, degrading the model's focus and increasing the likelihood of hallucinations.
- **High Latency**: Reading large documents repeatedly slows down agent response cycles.
- **Out-of-Date Indexes**: Simple static file caching strategies quickly become stale during active editing sessions.

---

## The Experimental Solution

`mdmeta` resolves these issues by parsing Markdown documents into logical sections based on heading structures and generating companion `.meta` files.
- **Token-Efficient Access**: Agents use the metadata index to fetch only the relevant subsections, parent context, or siblings on demand instead of the whole file.
- **High-Performance Parser**: Uses a lightweight `markdown-it` lexer pipeline to calculate accurate line boundaries, character counts, parent/child relationships, and checksums.
- **Incremental Cache Updates**: A background file watcher processes filesystem events (`add`, `change`, `unlink`) with eager/lazy/hybrid strategies to keep indices fresh.
- **Unified Tool Integration**: Features a built-in Model Context Protocol (MCP) server, offering these retrieval tools directly to AI systems.

---

## Benchmarking Framework (Pending)

A comprehensive benchmarking suite is planned to compare the efficiency of agents using:
1. **Raw File Retrieval**: Fetching whole `.md` documents directly.
2. **Metadata-Driven Retrieval**: Fetching sections via the `mdmeta` MCP server.

We will measure and compare:
- **Token Efficiency**: Reductions in prompt/context token consumption.
- **Latency**: Time-to-first-token and overall execution speed for document querying.
- **Context Relevance**: F1 score of text retrieval relative to targeted query questions.

Stay tuned!

---


## Installation

```bash
npm install -g mdmeta
```

Or run via `npx`:

```bash
npx mdmeta --help
```

---

## CLI Usage

### 1. Initialize Configuration
Creates a default `mdmeta.config.json` in the current directory:
```bash
mdmeta init
```

### 2. Parse a File
Parses a Markdown file and outputs the generated metadata as pretty-printed JSON to `stdout`:
```bash
mdmeta parse docs/install.md --id-strategy slug
```

### 3. Run the Standalone File Watcher
Recursively watches configured directories for edits, automatically generating or removing `.meta` companion files in the background:
```bash
mdmeta watch
```

### 4. Serve the MCP Server
Starts the MCP server using Standard I/O (stdio) transport:
```bash
mdmeta serve
```

To run both the MCP server and the background file watcher in a single process:
```bash
mdmeta serve --watch
```

---

## Configuration (`mdmeta.config.json`)

Customize indexing roots, ignore patterns, and strategy modes:

```json
{
  "roots": ["."],
  "ignore": ["node_modules", ".git", "dist"],
  "idStrategy": "slug",
  "indexStrategy": "lazy"
}
```

### Strategy Parameters

- **`idStrategy`**:
  - `slug`: Heading text transformed to URL slugs (e.g. `install-steps`).
  - `path`: Hierarchical prefix mapping (e.g. `getting-started/install-steps`).
  - `hash`: Shorthand deterministic SHA-256 hash segments (e.g. `s_a5fd92`).

- **`indexStrategy`**:
  - `lazy`: Index files only when requested via the SDK or when file events occur while running.
  - `eager`: Re-index all Markdown files under roots immediately on watcher startup.
  - `hybrid` (Recommended): Check existing `.meta` checksums on startup; only re-index files that are missing metadata or have stale contents.

---

## Model Context Protocol (MCP) Integration

To use `mdmeta` with **Claude Desktop**, add the following server configuration to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mdmeta": {
      "command": "node",
      "args": ["/absolute/path/to/mdmeta/dist/mcp/cli.js", "serve", "--watch"]
    }
  }
}
```

### Registered Tools

1. **`get_outline`**: Returns a tree outline of a file's headings, character counts, and modification times.
2. **`get_section`**: Retrieves the full text content and metadata of a specific section by heading name or ID.
3. **`get_context`**: Fetches a section along with its parent section content and direct siblings for broader structural context.
4. **`search_sections`**: Performs regular expression queries across sections, returning snippet matches with surrounding lines.
5. **`list_files`**: Lists all indexed Markdown files within the configured project roots.

---

## SDK Usage

You can also use `mdmeta` as a library in your Node/TypeScript projects:

```typescript
import { MdMeta } from 'mdmeta';

const sdk = new MdMeta();

// Get the structured outline of a document
const outline = sdk.getOutline('docs/architecture.md');

// Fetch a specific section
const section = sdk.getSection('docs/architecture.md', 'Data Flow');
console.log(section.content);
```

---

## License

MIT License.
