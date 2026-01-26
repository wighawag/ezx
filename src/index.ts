import {transformMarkdown} from 'zx/cli';
import {$, fs, path} from 'zx';
import {randomBytes} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {preprocessMarkdown, sanitizeMarkdownForZx} from './preprocessor.js';

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
	sections?: string[]; // Execute only sections under these headings
	preprocessOnly?: boolean | string; // Output preprocessed markdown without executing (optionally to file path)
	standalone?: boolean; // Create .npmrc file after setting directory for standalone npm mode in monorepos
	killOnComplete?: boolean; // Kill all spawned processes when script completes
}

/**
 * Extract sections from markdown based on heading matches
 * Returns only the content under the specified headings
 */
function extractSectionsByHeading(markdown: string, sectionHeadings: string[]): string {
	if (!sectionHeadings || sectionHeadings.length === 0) {
		return markdown;
	}

	const lines = markdown.split('\n');
	const result: string[] = [];
	let inMatchingSection = false;
	let currentSectionLevel = 0;
	let inCodeBlock = false;

	// Normalize section headings (case-insensitive, trim whitespace)
	const normalizedSectionHeadings = sectionHeadings.map(h => h.trim().toLowerCase());
	const headingRegex = /^(#{1,6})\s+(.+)$/;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		
		// Track code blocks
		if (line.startsWith('```')) {
			inCodeBlock = !inCodeBlock;
		}

		// Only check for headings when not in a code block
		const match = !inCodeBlock ? line.match(headingRegex) : null;

		if (match) {
			const level = match[1].length;
			const headingText = match[2].trim().toLowerCase();

			// Check if this heading matches one of our target headings
			if (normalizedSectionHeadings.includes(headingText)) {
				inMatchingSection = true;
				currentSectionLevel = level;
				result.push(line); // Include the heading itself
			} else if (inMatchingSection) {
				// If we're in a matching section and hit another heading of same or higher level
				// (less # means higher in the hierarchy), exit the section
				if (level <= currentSectionLevel) {
					inMatchingSection = false;
				}
			}
		} else if (inMatchingSection) {
			result.push(line);
		}
	}

	return result.join('\n');
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

		// Extract sections if specified
		if (options.sections && options.sections.length > 0) {
			markdownContent = extractSectionsByHeading(markdownContent, options.sections);
		}

		// Preprocess markdown with ezx enhancements
		const {preprocessedMarkdown, hasAsyncBlocks} = preprocessMarkdown(markdownContent, {
			cwd: options.cwd || process.cwd(),
			standalone: options.standalone,
			killOnComplete: options.killOnComplete,
		});

		// Sanitize markdown to prevent zx from misinterpreting indented prose as code
		// This handles edge cases like indented code blocks within list items
		const sanitizedMarkdown = sanitizeMarkdownForZx(preprocessedMarkdown);

		// If preprocessOnly is set, output the preprocessed markdown and return
		if (options.preprocessOnly) {
			if (typeof options.preprocessOnly === 'string') {
				// Write to file
				await fs.writeFile(options.preprocessOnly, sanitizedMarkdown);
			} else {
				// Output to stdout
				console.log(sanitizedMarkdown);
			}
			return;
		}

		// Transform markdown to JavaScript
		let jsCode = transformMarkdown(sanitizedMarkdown);

		// Resolve the absolute path to zx/globals using Node's module resolution
		// This will work regardless of where ezx is installed (local, global, or as a dependency)
		const zxGlobalsPath = await import.meta.resolve('zx/globals');

		// Prepend globals import to make $, fs, path, etc. available in the script context
		// Use the resolved absolute path to ensure zx is found
		let preamble = `await import('${zxGlobalsPath}')\n\n`;
		
		// If killOnComplete is enabled and there are async blocks, add process tracking
		if (options.killOnComplete && hasAsyncBlocks) {
			preamble += `const __ezx_async_processes = [];\n\n`;
		}
		
		jsCode = preamble + jsCode;
		
		// If killOnComplete is enabled and there are async blocks, add cleanup code
		if (options.killOnComplete && hasAsyncBlocks) {
			jsCode += `\n\n// Kill all async processes on completion\n__ezx_async_processes.forEach(p => p.kill());\n`;
		}

		// Write to temp file in current directory (not tmpdir) so zx can be resolved
		// Node's module resolution looks for package.json starting from the file's directory,
		// so the temp file needs to be in a location that has access to node_modules
		const cwd = options.cwd || process.cwd();
		const tempFile = path.join(cwd, `.ezx-${randomBytes(8).toString('hex')}.mjs`);
		await fs.writeFile(tempFile, jsCode);

		// Register cleanup handlers for various exit scenarios
		let tempFileCleaned = false;
		const cleanup = async () => {
			if (tempFileCleaned) return;
			tempFileCleaned = true;
			try {
				await fs.rm(tempFile, {force: true});
			} catch {
				// Ignore cleanup errors
			}
		};

		// Ensure cleanup on normal exit, uncaught errors, and signals
		process.on('exit', cleanup);
		process.on('uncaughtException', cleanup);
		process.on('SIGINT', cleanup);
		process.on('SIGTERM', cleanup);

		try {
			// Import and execute the transformed code (same as CLI)
			await import(pathToFileURL(tempFile).toString());
		} finally {
			// Clean up temp file and remove event listeners
			await cleanup();
			process.off('exit', cleanup);
			process.off('uncaughtException', cleanup);
			process.off('SIGINT', cleanup);
			process.off('SIGTERM', cleanup);
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
