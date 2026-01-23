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

### 2. File Extraction

Extract code blocks to files using language-specific comment syntax:

**TypeScript/JavaScript:**
```typescript
// file: package.json
{
  "name": "my-project",
  "version": "1.0.0"
}
```

**Bash/Shell:**
```bash
# file: .npmrc
shared-workspace-lockfile=false
```

**Markdown:**
```markdown
<!-- file: README.md -->
# My Project
```

Supported languages include: typescript, javascript, js, ts, bash, sh, shell, python, ruby, go, rust, java, sql, html, xml, and more.

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

// Preprocess markdown file with auto-extraction
const result = preprocessFile('./script.md', { 
  outputFiles: true,  // Write files to disk
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

\`\`\`typescript
// file: package.json
{
  "name": "my-app",
  "version": "1.0.0",
  "scripts": {
    "start": "node index.js"
  }
}
\`\`\`

\`\`\`typescript
// file: index.ts
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
  - `outputFiles` (boolean) - Write extracted files to disk
  - `cwd` (string) - Current working directory

**Returns:** PreprocessResult
- `preprocessedMarkdown` (string) - The preprocessed markdown
- `extractedFiles` (FileExtraction[]) - Array of extracted files

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

Apache-2.0