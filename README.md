# ezx - Markdown Preprocessor for zx

A markdown preprocessor that addresses common annoyances when using [zx](https://github.com/google/zx) to execute code blocks in markdown files.

## Features

### 1. Directory Context Persistence

When using zx to execute bash code blocks in markdown, each block executes in a fresh context, meaning `cd` commands don't persist between blocks. ezx solves this by allowing you to set a persistent directory context.

```bash
# set the current directory
cd my-project
npm install
```

The comment `# set the current directory` tells ezx to prepend `cd my-project` to all subsequent bash code blocks.

```bash
npm run build  # This will run in my-project directory
```

### 2. File Extraction

Extract code blocks to files automatically, avoiding the need for heredocs and `cat` commands.

```typescript
// file: src/index.ts
export function hello(name: string): string {
	return `Hello, ${name}!`;
}
```

```python
# file: scripts/main.py
def greet(name):
	return f"Greetings, {name}!"
```

```bash
# file: .npmrc
shared-workspace-lockfile=false
```

The file extraction blocks are removed from the preprocessed markdown and written to their specified paths.

### 3. Multi-Language Support

File extraction works with comment tokens for multiple languages:

- `//` - TypeScript, JavaScript, C++, Go, Rust, Java, Kotlin, Swift, PHP
- `#` - Bash, Python, Ruby, Perl, R
- `--` - SQL, Lua, Haskell
- `;` - Assembly
- `<!--` - HTML, XML

## Installation

```bash
npm install -g ezx
```

Or use with npx:

```bash
npx ezx input.md
```

## Usage

### Basic Usage

Preprocess a markdown file and output to stdout:

```bash
ezx input.md
```

### Write to File

```bash
ezx input.md -o output.md
```

### Extract Files

Extract file blocks to disk:

```bash
ezx input.md -w
```

### Combine Options

Preprocess and extract files:

```bash
ezx input.md -o output.md -w
```

### Specify Working Directory

```bash
ezx input.md -c /path/to/project
```

### Pipe from stdin

```bash
cat input.md | ezx stdin
```

## CLI Options

- `<input>` - Input markdown file path (required)
- `-o, --output <path>` - Output file path (defaults to stdout)
- `-w, --write-files` - Extract and write files to disk
- `-c, --cwd <path>` - Working directory for relative paths (default: current directory)
- `-h, --help` - Display help information
- `-V, --version` - Display version number

## How It Works

### Directory Context

1. When ezx encounters `# set the current directory` followed by a `cd` command, it stores the directory
2. The comment and `cd` command are removed from the output
3. All subsequent bash code blocks have `cd <directory>` prepended to them
4. The context persists until changed by another `# set the current directory` or reset by a file extraction

### File Extraction

1. When ezx encounters a file extraction comment (e.g., `// file: path/to/file`), it:
   - Removes the entire code block from the output markdown
   - Extracts the content (excluding the comment line)
   - Writes the file to the specified path (if `-w` flag is used)
2. File extraction blocks reset the directory context

## Example

### Input (input.md)

```markdown
# My Project Setup

```bash
# set the current directory
cd my-project
npm install
```

```bash
npm run build
```

```typescript
// file: src/index.ts
console.log("Hello World");
```

```bash
echo "Backend work"
```
```

### Output (with `ezx input.md`)

```markdown
# My Project Setup

```bash
cd my-project
npm install
```

```bash
cd my-project
npm run build
```

```bash
echo "Backend work"
```
```

### Extracted Files (with `-w` flag)

- `src/index.ts`:
  ```typescript
  console.log("Hello World");
  ```

## Use Cases

1. **Documentation with Executable Examples** - Keep your documentation executable while maintaining proper directory context
2. **Project Setup Guides** - Automatically extract configuration files from markdown documentation
3. **Tutorials** - Create multi-step tutorials where commands run in the correct directories
4. **Development Workflows** - Document and automate development processes

## Integration with zx

After preprocessing with ezx, you can use the output with zx:

```bash
ezx input.md -o processed.md
zx processed.md
```

Or pipe directly:

```bash
ezx input.md | zx
```

## License

MIT