# AGENTS.md - AI Agent Context for ezx

This document provides context for AI agents working on the ezx project.

## Project Overview

**ezx** (Enhanced zx) is an enhanced version of Google's [zx](https://github.com/google/zx) that adds markdown preprocessing features to solve common annoyances when writing shell scripts in markdown.

### Why ezx exists

zx allows executing markdown files as scripts, running fenced code blocks. However, it has several limitations:

1. **No directory persistence** - Each bash block runs in a fresh context; `cd` doesn't persist
2. **No file extraction** - Can't easily create files from code blocks in markdown
3. **Markdown parsing issues** - zx uses regex-based parsing that fails on:
   - Indented code blocks within lists ([Issue #1388](https://github.com/google/zx/issues/1388))
   - Indented prose after empty lines ([Issue #1389](https://github.com/google/zx/issues/1389))

ezx solves all these issues by preprocessing markdown before passing it to zx.

## Architecture

```
Markdown File
    │
    ▼
┌─────────────────────────────────────────┐
│ extractSectionsByHeading() [index.ts]   │  ← Optional: --sections flag
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│ preprocessMarkdown() [preprocessor.ts]  │  ← ezx features: directory context, file extraction
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│ sanitizeMarkdownForZx() [preprocessor.ts] │  ← Fix indentation issues using marked
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│ transformMarkdown() [zx/cli]            │  ← zx's markdown → JS conversion
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│ Execute as ESM module                   │
└─────────────────────────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `src/cli.ts` | CLI entry point using commander |
| `src/index.ts` | Main API: `runMarkdown()`, `runMarkdownFile()`, `runMarkdownContent()` |
| `src/preprocessor.ts` | Preprocessing logic: directory context, file extraction, markdown sanitization |

## Key Features

### 1. Markdown Parsing Fixes

Uses `marked` library to properly parse markdown and extract code blocks, fixing zx's regex limitations:

```typescript
// In preprocessor.ts
export function sanitizeMarkdownForZx(markdown: string): string {
  const tokens = Lexer.lex(markdown);
  // Recursively extract code blocks (including nested in lists)
  // Rebuild clean markdown for zx
}
```

### 2. Directory Context Persistence

Special comment `# set the current directory` makes `cd` persist across blocks:

```markdown
```bash
# set the current directory
cd my-project
```⁠

```bash
pwd  # Still in my-project!
```⁠
```

**Implementation:** `preprocessMarkdown()` tracks a virtual current directory and prepends `cd` to subsequent blocks.

### 3. File Extraction

Use the `file:` directive in a blockquote to create files:

```markdown
> file: `package.json`

```json
{"name": "my-project"}
```⁠
```

> ⚠️ **Breaking Change**: The `file:` prefix is now required. The old syntax `> `filename`` no longer works.

**Implementation:** Transformed to bash heredocs:
```bash
cat > 'package.json' << 'EZXEOF'
{"name": "my-project"}
EZXEOF
```

### 4. Async Bash Execution

Use the `async:` directive to run bash commands asynchronously (fire-and-forget):

```markdown
> async: `start dev server`

```bash
npm run dev
```⁠
```

**Implementation:** Transformed to JavaScript with zx's `$` template (without await):
```javascript
$`npm run dev`
```

This allows the command to run in the background while the script continues. zx automatically awaits all pending promises at the end.

**Note:** The `async:` directive only works with bash/sh/shell blocks.

## Dependencies

| Dependency | Purpose |
|------------|---------|
| `zx` | Core shell scripting functionality |
| `commander` | CLI argument parsing |
| `marked` | Markdown parsing for sanitization |

## Development

```bash
# Build
pnpm build

# Watch mode
pnpm dev

# Test with markdown files
node dist/cli.js TEST.md --verbose
node dist/cli.js TEST2.md --verbose
```

## Testing

Test files in the project root:

| File | Tests |
|------|-------|
| `TEST.md` | Full feature test with directory context and file extraction |
| `TEST2.md` | Indentation edge cases (code blocks in lists) |
| `test-comprehensive.md` | Comprehensive feature tests |
| `example.md` | Example markdown script |

## Important Implementation Details

### sanitizeMarkdownForZx

This function is critical - it uses `marked.Lexer.lex()` to parse markdown and:
1. Recursively walks tokens (including nested list items)
2. Extracts only code blocks and headings
3. Rebuilds clean markdown without indented prose

This ensures zx's regex parser won't misinterpret content.

### Heredoc EOF Marker

Uses `EZXEOF` as the heredoc delimiter for file extraction. This is chosen to be unlikely to appear in file content.

### Directory Context Handling

The virtual directory is tracked as a string path that accumulates (e.g., `my-project/subdir`). Prepended `cd` commands use `&&` to ensure the command runs in the correct directory.

## Code Style

- TypeScript with strict mode
- ESM modules (`"type": "module"`)
- Prettier for formatting (see `.prettierrc`)
- Tab-based indentation