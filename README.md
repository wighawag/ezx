# ezx - Enhanced zx

An enhanced version of zx with markdown preprocessing features to solve common annoyances when writing shell scripts in markdown.

## Features

### 1. Directory Context Persistence

In standard zx, each bash code block runs in a fresh context, so `cd` commands don't persist across blocks. ezx solves this with a special comment syntax:

```bash
# set the current directory
mkdir -p my-project
cd my-project
```

All subsequent bash blocks will automatically prepend `cd my-project`:

```bash
echo "We're still in my-project!"
pwd
```

**Note:** The directory context also affects file extraction blocks. Files created after `# set the current directory` will have their paths relative to the original directory, but the command will prepend `cd` to create them in the correct location.

### 2. File Extraction

Extract code blocks to files using the info string syntax on the code fence. The file directive is specified after the language identifier using `file:` or `file=`. The file path is always relative to the original working directory (not affected by `# set the current directory`).

**JSON:**
```json file:my-project/package.json
{
  "name": "my-project",
  "version": "1.0.0"
}
```

**TypeScript/JavaScript:**
```typescript file:my-project/index.ts
console.log("Hello world")
```

**Bash/Shell:**
```bash file:my-project/.npmrc
shared-workspace-lockfile=false
```

**Markdown:**
```markdown file:my-project/README.md
# My Project
```

**Any language:** The file directive works with any language, including unknown languages, because it's specified in the code fence info string, not inside the code content.

File extraction blocks are transformed to bash heredoc commands that execute in order with the rest of the markdown. If a directory context is active, the heredoc command will prepend `cd`:

```bash
# Without directory context:
cat > 'path/to/file' << 'EZXEOF'
content here
EZXEOF

# With directory context (after "# set the current directory my-project"):
cd my-project && cat > 'path/to/file' << 'EZXEOF'
content here
EZXEOF
```

This means if a parent directory doesn't exist, the command will fail (as expected). You should create directories first using `mkdir -p` in a bash block.

## Installation

```bash
npm install ezx
```

## Usage

### CLI Usage

Run markdown scripts with ezx enhancements:

```bash
ezx script.md
ezx --verbose script.md
ezx --shell=/bin/bash script.md
```

### Programmatic Usage

```typescript
import { runMarkdownFile, runMarkdownContent } from 'ezx'

// Run markdown file
await runMarkdownFile('./script.md', { verbose: true })

// Run markdown content directly
await runMarkdownContent(`
\`\`\`bash
# set the current directory
mkdir -p my-project
cd my-project
\`\`\`

\`\`\`bash
echo "Still in my-project!"
\`\`\`
`, { verbose: true })
```

### Preprocessor API

You can also use the preprocessor directly:

```typescript
import { preprocessMarkdown, preprocessFile } from 'ezx'

// Preprocess markdown content
const { preprocessedMarkdown, extractedFiles } = preprocessMarkdown(markdown)

// Preprocess markdown file
const result = preprocessFile('./script.md', {
  cwd: process.cwd()
})
```

## Example

Here's a complete example showing both features:

```markdown
# Setup a new project

\`\`\`bash
# set the current directory
mkdir -p my-app
cd my-app
npm init -y
\`\`\`

\`\`\`json file:my-app/package.json
{
  "name": "my-app",
  "version": "1.0.0",
  "scripts": {
    "start": "node index.js"
  }
}
\`\`\`

\`\`\`typescript file:my-app/index.ts
console.log('Hello from ezx!')
\`\`\`

\`\`\`bash
npm install
npm start
\`\`\`

\`\`\`bash
cd ..
rm -rf my-app
\`\`\`
```

## API Reference

### `runMarkdown(markdown, options)`

Run markdown content or file with CLI-like options.

**Parameters:**
- `markdown` (string | Buffer) - Markdown content or file path
- `options` (RunMarkdownOptions) - CLI-like options

**Options:**
- `verbose` (boolean) - Enable verbose mode
- `quiet` (boolean) - Suppress output
- `shell` (string) - Custom shell binary
- `prefix` (string) - Prefix all commands
- `postfix` (string) - Postfix all commands
- `cwd` (string) - Current working directory
- `preferLocal` (boolean) - Prefer locally installed packages

### `runMarkdownFile(filePath, options)`

Convenience function to run a markdown file from disk.

### `runMarkdownContent(markdownContent, options)`

Convenience function to run markdown content directly as a string.

### `preprocessMarkdown(input, options)`

Preprocess markdown content.

**Parameters:**
- `input` (string) - Markdown content
- `options` (object)
  - `cwd` (string) - Current working directory (default: `process.cwd()`)

**Returns:** PreprocessResult
- `preprocessedMarkdown` (string) - The preprocessed markdown with file directive blocks transformed to bash heredocs
- `extractedFiles` (FileExtraction[]) - Array of extracted file information (for informational purposes only)

### `preprocessFile(filePath, options)`

Read and preprocess a markdown file.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Run tests
node dist/cli.js test-preprocessor.md --verbose
```

## License

MIT