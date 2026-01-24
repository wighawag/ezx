# ezx - Enhanced zx

An enhanced version of zx with markdown preprocessing features to solve common annoyances when writing shell scripts in markdown.

## Features

### 1. Markdown Parsing Fixes (Indentation Issues)

ezx fixes known markdown parsing issues in zx related to indentation:

- **Indented code blocks within lists** - Code blocks indented within list items (e.g., `  ```bash` after a bullet point) are now correctly recognized and executed
- **Indented prose** - List item continuations and other indented prose won't be misinterpreted as code

These issues are tracked in the zx project:
- [Issue #1388 - Indented code blocks in lists not executed](https://github.com/google/zx/issues/1388)
- [Issue #1389 - Indented prose after empty line causes parsing error](https://github.com/google/zx/issues/1389)

**Example that works in ezx but not in zx:**

```markdown
### deploy your contract

- on localhost

  ```bash
  pnpm run contracts:deploy localhost
  ```

- on a network of your choice

  ```bash
  pnpm run contracts:deploy <network>
  ```
```

### 2. Directory Context Persistence

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

### 3. File Extraction

Extract code blocks to files using the `file:` directive in a preceding blockquote. The file path can optionally be wrapped in backticks.

> ⚠️ **Breaking Change**: The `file:` prefix is now **required**. The old syntax `> `filename`` without the prefix no longer works.

```markdown
> file: `package.json`

```json
{
  "name": "my-project",
  "version": "1.0.0"
}
```⁠
```

Or without backticks:

```markdown
> file: package.json

```json
{
  "name": "my-project"
}
```⁠
```

**JSON:**
> file: `my-project/package.json`

```json
{
  "name": "my-project",
  "version": "1.0.0"
}
```

**TypeScript/JavaScript:**
> file: `my-project/index.ts`

```typescript
console.log("Hello world")
```

**Bash/Shell:**
> file: `my-project/.npmrc`

```bash
shared-workspace-lockfile=false
```

**Markdown:**
> file: `my-project/README.md`

```markdown
# My Project
```

**Any language:** The file directive works with any language, including unknown languages, because it's specified in a preceding blockquote, not inside the code content.

**Note:** zx executes all code blocks in markdown files. If you have code blocks that are for documentation only (examples to show users, not to run or write as files), add the `no-eval` flag to prevent execution:

```markdown
```typescript no-eval
interface User {
  name: string;
  age: number;
}
```⁠
```

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

### 4. Async Bash Execution

Run bash commands asynchronously using the `async:` directive. This is useful for starting background processes like development servers.

> 💡 zx doesn't support background bash tasks with `&`. The `async:` directive solves this by transforming the bash block to a JavaScript `$` template that runs without `await`.

```markdown
> async: `start dev server`

```bash
npm run dev
```⁠
```

The text after `async:` is optional and serves as documentation only. Both formats work:

```markdown
> async: `start dev server`
> async: start dev server
> async:
```

**Example:** Running a server in the background while continuing with other tasks:

```markdown
> async: `start server`

```bash
npm run dev
```⁠

```bash
# This runs immediately, doesn't wait for the server
echo "Server starting in background..."
sleep 2
curl http://localhost:3000
```⁠
```

**How it works:** The async directive transforms bash blocks into JavaScript blocks using zx's `$` template literal:

```javascript
// Input: async bash block with "npm run dev"
// Output: JavaScript block
$`npm run dev`
```

The command runs without `await`, so execution continues immediately. zx automatically awaits all pending promises at the end of the script.

**Important:** The `async:` directive only works with bash/sh/shell blocks. Using it with other languages will result in an error.

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

#### Execute Specific Sections

You can execute only specific sections of a markdown file by specifying their heading titles. This is useful for running parts of a larger documentation file:

```bash
# Run only the "Create a new project" section
ezx --sections "Create a new project" docs/getting-started.md

# Run multiple sections
ezx --sections "Prerequisites" "Create a new project" docs/getting-started.md

# Short form
ezx -s "Create a new project" docs/getting-started.md
```

Section matching is case-insensitive and includes all content under the specified heading and its subheadings until another heading of the same or higher level is encountered.

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

Here's a complete example showing all features:

```markdown
# Setup a new project

\`\`\`bash
# set the current directory
mkdir -p my-app
cd my-app
npm init -y
\`\`\`

> file: `my-app/package.json`

\`\`\`json
{
  "name": "my-app",
  "version": "1.0.0",
  "scripts": {
    "start": "node index.js",
    "dev": "node --watch index.js"
  }
}
\`\`\`

> file: `my-app/index.js`

\`\`\`javascript
const http = require('http');
const server = http.createServer((req, res) => {
  res.end('Hello from ezx!');
});
server.listen(3000, () => console.log('Server running on port 3000'));
\`\`\`

> async: `start dev server`

\`\`\`bash
npm run dev
\`\`\`

\`\`\`bash
# This runs immediately while server starts in background
sleep 2
curl http://localhost:3000
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
- `sections` (string[]) - Execute only sections under these heading titles

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