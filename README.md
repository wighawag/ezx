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

**Note:** The directory context also affects file extraction blocks. After `# set the current directory`, a `file:` path that starts with the context directory (e.g. `my-project/package.json`) is written to that location, and any other relative path is resolved inside the context directory.

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

File extraction blocks are transformed into JavaScript blocks that write the file with `fs`, executing in order with the rest of the markdown. The path and the content are embedded as JSON strings, so the file receives the block's text byte for byte (backticks, `${...}`, backslashes and all), followed by a final newline. Leading and trailing whitespace of the block is trimmed, as before.

```js
// Without directory context: relative to the working directory (--cwd, else the current directory)
fs.writeFileSync(path.resolve($.cwd || process.cwd(), "path/to/file"), "content here\n");

// With directory context (after "# set the current directory" + "cd my-project"):
// the directory is resolved by the shell, so it means what `cd my-project` means in bash blocks
fs.writeFileSync(path.resolve((await $`cd my-project && pwd`.quiet()).stdout.replace(/\n$/, ''), "path/to/file"), "content here\n");
```

With a directory context, a path that starts with the context directory (`my-project/path/to/file`) has that prefix stripped; any other relative path is resolved inside the context directory.

Parent directories are not created: if one doesn't exist, the write fails and the script stops (as expected). Create directories first using `mkdir -p` in a bash block.

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

The lines of the block are joined with `; ` into a single command (empty lines and lines starting with `#` are dropped), and the command is escaped for the template literal, so the shell receives it unchanged (see [Special characters](#5-special-characters-are-passed-through-unchanged)).

The command runs without `await`, so execution continues immediately. zx automatically awaits all pending promises at the end of the script.

**Kill on Complete:** Use the `--kill-on-complete` (or `-k`) CLI option to kill all async processes when the script completes, instead of waiting for them:

```bash
ezx --kill-on-complete script.md
ezx -k script.md
```

This is useful for development servers or other long-running processes that should be terminated after the script runs.

**Important:** The `async:` directive only works with bash/sh/shell blocks. Using it with other languages will result in an error.

### 5. Special characters are passed through unchanged

zx runs a `bash`/`sh`/`shell` block by pasting its lines between the backticks of a JavaScript template literal (`` await $`...` ``) without escaping them. In plain zx, a backtick in the block therefore ends the command early (the script fails to parse), `${x}` is evaluated as JavaScript instead of reaching the shell, and backslash sequences such as `\n` are turned into the characters they denote.

ezx guarantees that the text of a block reaches its destination unchanged:

- **Bash blocks and `async:` blocks:** ezx generates the `` await $`...` `` itself (as a `js` block) and escapes `\`, `` ` `` and `${` for the template literal, so the shell receives exactly what is written in the Markdown. Because ezx no longer leaves bash fences to zx, this stays correct if a future zx release starts escaping bash blocks itself. `` `cmd` `` is a shell command substitution, `${VAR}` is a shell expansion, and `\n` is a backslash followed by `n`, as in any shell script.
- **`file:` blocks:** the file is written with `fs` from a JSON-encoded string, without going through a shell, so any content can be extracted, including TypeScript template literal types such as `` `0x${string}` ``, comments with backticks, backslashes, and a line reading `EZXEOF`.

This means a bash block can no longer use `${...}` to interpolate a JavaScript value, which in zx happened by accident of the transformation. Use a `js` block with `` $`...` `` when you need that.

#### Migrating from ezx 0.0.x

This is a breaking change for documents written around the old behaviour:

- **Backslash workarounds now reach the shell or the file.** If you wrote `\${` or `` \` `` to get `${` or a backtick through, the backslash is now kept, so the shell sees an escaped (literal) `${` or backtick, and an extracted file contains the backslash. Remove the backslash. ezx prints a warning to stderr (unless `--quiet`) for every bash, `async:` or `file:` block containing `\${` or `` \` ``, since such a backslash may also be intentional.
- **Doubled backslashes are no longer halved.** Backslash sequences used to be interpreted by JavaScript first, so `\\` produced one backslash and `\n` a newline. They are now passed on as written. If you doubled backslashes to compensate, undo it. Shell line continuations (a `\` at the end of a line) behave as before.
- **`${jsVariable}` in a bash block** is no longer a JavaScript interpolation. Under zx's default `set -u` it usually fails with "unbound variable". Move the command to a `js` block: `` await $`echo ${jsVariable}` ``.
- **`file:` blocks are not written by a shell.** `--prefix`, `--postfix` and `--shell` do not apply to them, and `--verbose` does not print a command for them.

### Known pitfalls

- **zx executes `js`, `javascript`, `ts` and `typescript` blocks.** zx runs every block tagged exactly `js`, `javascript`, `ts` or `typescript` as JavaScript (TypeScript blocks are not type-stripped). A TypeScript snippet shown for documentation, that is not a `file:` block, usually crashes the script with a syntax error. Mark such blocks so zx ignores them, by adding any word after the language (`` ```ts no-eval ``) or by using a tag zx does not run (`` ```tsx ``, `` ```TypeScript ``). Blocks with any other language (`json`, `text`, `solidity`, ...) are never executed.
- **Only exact fence tags run.** A bash block runs only when its tag is exactly `bash`, `sh` or `shell` after ezx removes `sleep:N` and `[label]` modifiers. Any other word after the language (`` ```bash skip ``) makes zx ignore the block.
- **`--preprocess-only` shows zx's input.** The printed Markdown is what ezx hands to zx: executed bash blocks appear as `js` blocks containing `` await $`...` `` with their backticks, `${` and backslashes escaped, and `file:` blocks appear as `js` blocks calling `fs.writeFileSync`.
- **Multi-line `async:` blocks become one line.** Their lines are joined with `; `, so constructs that span lines (heredocs, `if`/`fi` written over several lines with comments) may not work in an `async:` block.

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
- `killOnComplete` (boolean) - Kill all spawned async processes when script completes

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
- `preprocessedMarkdown` (string) - The preprocessed markdown, ready for zx: file directive blocks are transformed into `js` blocks that write the file, and bash block bodies are escaped for zx's template literal
- `extractedFiles` (FileExtraction[]) - Array of extracted file information (for informational purposes only)
- `hasAsyncBlocks` (boolean) - Whether the markdown contains `async:` blocks
- `warnings` (string[]) - Non-fatal hints, such as the migration warning about `\${` and `` \` ``; `runMarkdown` prints them to stderr unless `quiet` is set

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

# Run tests (builds first, then runs test/*.test.mjs with node --test)
npm test
```

## License

MIT