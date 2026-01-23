import {transformMarkdown} from 'zx/cli';
import {$, fs, path} from 'zx';
import {randomBytes} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {preprocessMarkdown} from './preprocessor.js';

// Import zx globals to make $, path, fs, etc. available globally
await import('zx/globals');

export interface RunMarkdownOptions {
	verbose?: boolean;
	quiet?: boolean;
	shell?: string;
	prefix?: string;
	postfix?: string;
	cwd?: string;
	preferLocal?: boolean;
}

/**
 * Run markdown content or file with CLI-like options
 *
 * @param markdown - Markdown content or file path
 * @param options - CLI-like options
 */
export async function runMarkdown(markdown: string | Buffer, options: RunMarkdownOptions = {}): Promise<void> {
	// Save current state
	const savedState = {
		verbose: $.verbose,
		quiet: $.quiet,
		shell: $.shell,
		prefix: $.prefix,
		postfix: $.postfix,
		cwd: $.cwd,
		preferLocal: $.preferLocal,
	};

	try {
		// Apply options
		if (options.verbose !== undefined) $.verbose = options.verbose;
		if (options.quiet !== undefined) $.quiet = options.quiet;
		if (options.shell) $.shell = options.shell;
		if (options.prefix) $.prefix = options.prefix;
		if (options.postfix) $.postfix = options.postfix;
		if (options.cwd) $.cwd = options.cwd;
		if (options.preferLocal !== undefined) $.preferLocal = options.preferLocal;

		// Read markdown content if it's a file path
		let markdownContent: string;
		if (typeof markdown === 'string' && (markdown.endsWith('.md') || markdown.includes('\n') === false)) {
			markdownContent = await fs.readFile(markdown, 'utf8');
		} else {
			markdownContent = markdown.toString();
		}

		// Preprocess markdown with ezx enhancements
		// Write extracted files to disk
		const {preprocessedMarkdown, extractedFiles} = preprocessMarkdown(markdownContent, {
			cwd: options.cwd || process.cwd(),
			outputFiles: true,
		});

		// Transform markdown to JavaScript
		let jsCode = transformMarkdown(preprocessedMarkdown);

		// Prepend globals import to make $, fs, path, etc. available in the script context
		jsCode = `await import('zx/globals')\n\n${jsCode}`;

		// Write to temp file in current directory (not tmpdir) so zx can be resolved
		const cwd = options.cwd || process.cwd();
		const tempFile = path.join(cwd, `.ezx-${randomBytes(8).toString('hex')}.mjs`);
		await fs.writeFile(tempFile, jsCode);

		try {
			// Import and execute the transformed code (same as CLI)
			await import(pathToFileURL(tempFile).toString());
		} finally {
			// Clean up temp file
			await fs.rm(tempFile, {force: true}).catch(() => {});
		}
	} finally {
		// Restore state
		Object.assign($, savedState);
	}
}

/**
 * Run a markdown file from disk
 *
 * @param filePath - Path to markdown file
 * @param options - CLI-like options
 */
export async function runMarkdownFile(filePath: string, options: RunMarkdownOptions = {}): Promise<void> {
	return runMarkdown(filePath, options);
}

/**
 * Run markdown content directly
 *
 * @param markdownContent - Markdown content as string
 * @param options - CLI-like options
 */
export async function runMarkdownContent(markdownContent: string, options: RunMarkdownOptions = {}): Promise<void> {
	return runMarkdown(markdownContent, options);
}

// Re-export everything from zx for convenience
export * from 'zx';

// Export preprocessor functions
export * from './preprocessor.js';
