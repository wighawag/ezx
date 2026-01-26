import {readFileSync} from 'node:fs';
import {marked, Lexer} from 'marked';

/**
 * Directive types supported in blockquotes
 */
export type DirectiveType = 'file' | 'async';

/**
 * Parsed directive from a blockquote line
 */
export interface Directive {
	type: DirectiveType;
	value: string; // file path for 'file', description for 'async'
}

export interface CodeBlock {
	language: string;
	content: string;
	startLine: number;
	endLine: number;
	filePath?: string; // File path from file: directive
	isAsync?: boolean; // Whether this is an async block from async: directive
	asyncDescription?: string; // Optional description from async: directive
	precedingBlockquoteLine?: number; // Line number of the blockquote with directive
	sleepSeconds?: number; // Sleep duration from sleep:N modifier
}

export interface FileExtraction {
	filePath: string;
	content: string;
	language: string;
}

export interface PreprocessResult {
	preprocessedMarkdown: string;
	extractedFiles: FileExtraction[];
	hasAsyncBlocks: boolean; // Whether the markdown contains async blocks
}

/**
 * Information about a block that will be transformed to a heredoc
 */
interface HeredocTransform {
	filePath: string;
	content: string;
	directoryPrefix?: string; // Optional cd prefix for unified directory context
}

/**
 * Information about a block that will be transformed to async JS
 */
interface AsyncTransform {
	content: string;
	directoryPrefix?: string; // Optional cd prefix for unified directory context
	description?: string; // Optional description for documentation
}


/**
 * Sanitize markdown to prevent zx's parser from misinterpreting
 * indented prose as code blocks.
 *
 * zx treats lines starting with 2+ spaces after an empty line as code.
 * We use marked to identify actual code blocks and rebuild the markdown
 * with only headings and code blocks (stripping all prose).
 *
 * This also handles the edge case of indented code blocks within list items
 * (e.g., "  ```bash" within a list), which zx's regex parser cannot handle.
 */
export function sanitizeMarkdownForZx(markdown: string): string {
	const tokens = Lexer.lex(markdown);
	const output: string[] = [];

	// Recursively process tokens to extract code blocks and headings
	function processTokens(tokenArray: any[], depth: number = 0) {
		for (const token of tokenArray) {
			if (token.type === 'code') {
				// Keep fenced code blocks - marked handles indentation correctly
				// Remove bracketed modifiers like [npm], [pnpm], etc. but preserve zx's modifiers like skip
				// zx doesn't understand bracketed modifiers and will skip code blocks with them
				const langTag = token.lang || '';
				// Remove bracketed modifiers using regex to match [anything]
				const cleanLangTag = langTag.replace(/\s*\[.*?\]\s*/g, ' ').trim();
				const fence = '```';
				output.push(`${fence}${cleanLangTag}`);
				output.push(token.text);
				output.push(fence);
				output.push(''); // Empty line after for readability
			} else if (token.type === 'heading') {
				// Keep headings (useful for section extraction in ezx)
				output.push(`${'#'.repeat(token.depth)} ${token.text}`);
				output.push('');
			} else if (token.type === 'list' && token.items) {
				// Process list items to find nested code blocks
				for (const item of token.items) {
					if (item.tokens) {
						processTokens(item.tokens, depth + 1);
					}
				}
			}
			// Other content (paragraphs, lists, blockquotes, etc.) is dropped
			// since it's not executable and could confuse zx's parser
		}
	}

	processTokens(tokens);

	return output.join('\n');
}

/**
 * Check if a language is a bash/shell language
 */
function isBashLanguage(language: string): boolean {
	const lang = language.toLowerCase();
	return lang === 'bash' || lang === 'sh' || lang === 'shell';
}

/**
 * Parse language tag and extract modifiers
 * e.g., "bash sleep:3 skip" -> { language: "bash", languageTag: "bash skip", sleepSeconds: 3 }
 * e.g., "bash [npm] skip" -> { language: "bash", languageTag: "bash skip", sleepSeconds: undefined }
 * The languageTag has sleep:N and bracketed modifiers like [npm] removed, but preserves zx's modifiers like skip
 */
function parseLanguageTag(langTag: string): { language: string; languageTag: string; sleepSeconds?: number } {
	const parts = langTag.trim().split(/\s+/);
	const language = parts[0] || '';
	let sleepSeconds: number | undefined;
	const otherModifiers: string[] = [];

	for (let i = 1; i < parts.length; i++) {
		const part = parts[i];
		const sleepMatch = part.match(/^sleep:(\d+)$/i);
		if (sleepMatch) {
			sleepSeconds = parseInt(sleepMatch[1], 10);
		} else if (part.match(/^\[.*?\]$/)) {
			// Skip bracketed modifiers like [npm], [pnpm], etc.
			// These are not understood by zx and cause code blocks to be skipped
			continue;
		} else {
			// Preserve other modifiers like 'skip'
			otherModifiers.push(part);
		}
	}

	// Build language tag without sleep:N and bracketed modifiers
	const languageTag = [language, ...otherModifiers].join(' ');

	return { language, languageTag, sleepSeconds };
}

/**
 * Extract directive from a blockquote line
 *
 * Supports:
 * - file: directive: > file: `path/to/file.json` or > file: path/to/file.json
 * - async: directive: > async: `description` or > async: description or > async:
 *
 * Note: The old syntax `> `filename`` without a directive prefix is NO LONGER supported.
 * This is a breaking change - use `> file: `filename`` instead.
 */
function extractDirectiveFromBlockquote(line: string): Directive | null {
	const trimmed = line.trim();
	
	// Match file: directive with optional backticks
	// e.g., > file: `package.json` or > file: package.json
	const fileMatch = trimmed.match(/^>\s*file:\s*(?:`([^`]+)`|(\S.*?))\s*$/i);
	if (fileMatch) {
		const value = (fileMatch[1] || fileMatch[2] || '').trim();
		if (!value) {
			return null; // file: requires a path
		}
		return {
			type: 'file',
			value,
		};
	}
	
	// Match async: directive with optional backticks
	// e.g., > async: `start server` or > async: start server or > async:
	const asyncMatch = trimmed.match(/^>\s*async:\s*(?:`([^`]*)`|(.*))?\s*$/i);
	if (asyncMatch) {
		return {
			type: 'async',
			value: (asyncMatch[1] || asyncMatch[2] || '').trim(),
		};
	}
	
	return null;
}

/**
 * Parse markdown and extract all code blocks with their line numbers
 * Also extracts directives (file: or async:) from preceding blockquote if present
 */
function parseCodeBlocks(markdown: string): CodeBlock[] {
	const codeBlocks: CodeBlock[] = [];
	const lines = markdown.split('\n');
	let inCodeBlock = false;
	let currentBlock: Partial<CodeBlock> = {};
	let blockStartLine = 0;
	let precedingBlockquoteLine: number | undefined;
	let pendingDirective: Directive | undefined;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Check for code block start (including indented code blocks in list items)
		if (line.match(/^\s*```/)) {
			if (!inCodeBlock) {
				// Starting a new code block - extract full language tag including modifiers
				const languageMatch = line.match(/^\s*```(.*)$/);
				const fullLangTag = languageMatch?.[1] || '';
				const { language, languageTag, sleepSeconds } = parseLanguageTag(fullLangTag);
				
				// Validate async directive is only used with bash blocks
				if (pendingDirective?.type === 'async' && !isBashLanguage(language)) {
					throw new Error(
						`[ezx] async: directive error at line ${(precedingBlockquoteLine ?? 0) + 1}\n` +
						`The async: directive can only be used with bash, sh, or shell code blocks.\n` +
						`Found: \`\`\`${language || '(no language specified)'}\n` +
						`\n` +
						`To fix this, either:\n` +
						`1. Change the code block language to bash, sh, or shell\n` +
						`2. Remove the async: directive from the preceding blockquote`
					);
				}
				
				currentBlock = {
					language,
					filePath: pendingDirective?.type === 'file' ? pendingDirective.value : undefined,
					isAsync: pendingDirective?.type === 'async',
					asyncDescription: pendingDirective?.type === 'async' ? pendingDirective.value : undefined,
					precedingBlockquoteLine: precedingBlockquoteLine,
					sleepSeconds,
					content: '',
					startLine: i,
				};
				inCodeBlock = true;
				blockStartLine = i;
				precedingBlockquoteLine = undefined;
				pendingDirective = undefined; // Reset for next block
			} else {
				// Ending the current code block
				if (
					currentBlock.language !== undefined &&
					currentBlock.content !== undefined &&
					currentBlock.startLine !== undefined
				) {
					codeBlocks.push({
							language: currentBlock.language,
							content: currentBlock.content,
							startLine: currentBlock.startLine,
							endLine: i,
							filePath: currentBlock.filePath,
							isAsync: currentBlock.isAsync,
							asyncDescription: currentBlock.asyncDescription,
							precedingBlockquoteLine: currentBlock.precedingBlockquoteLine,
							sleepSeconds: currentBlock.sleepSeconds,
						});
				}
				inCodeBlock = false;
				currentBlock = {};
			}
		} else if (!inCodeBlock) {
			// Look for blockquote with directive (only outside code blocks)
			const directive = extractDirectiveFromBlockquote(line);
			if (directive) {
				precedingBlockquoteLine = i;
				pendingDirective = directive;
			}
		} else if (inCodeBlock && currentBlock.content !== undefined) {
			// Add line to current block content
			currentBlock.content += (currentBlock.content ? '\n' : '') + line;
		}
	}

	return codeBlocks;
}

/**
 * Check if a line contains a directory set command
 */
function isDirectorySetCommand(line: string): boolean {
	const trimmed = line.trim().toLowerCase();
	return trimmed === '# set the current directory';
}


/**
 * Preprocess markdown file
 */
export function preprocessMarkdown(
	input: string,
	options: {cwd?: string; standalone?: boolean; killOnComplete?: boolean} = {},
): PreprocessResult {
	const {cwd = process.cwd(), standalone = false, killOnComplete = false} = options;
	const lines = input.split('\n');
	const codeBlocks = parseCodeBlocks(input);
	const extractedFiles: FileExtraction[] = [];

	// Track the current directory context
	let currentDirectory: string | null = null;

	// Map of block indices to transformations (prepend cd)
	const blocksToTransform: Map<number, string> = new Map();
	// Map of block indices to transform to heredoc
	const blocksToHeredoc: Map<number, HeredocTransform> = new Map();
	// Map of block indices to transform to async JS
	const blocksToAsync: Map<number, AsyncTransform> = new Map();
	// Track where we need to insert .npmrc after directory set
	const npmrcInsertBlocks: Set<number> = new Set();

	// Process each code block
	for (let i = 0; i < codeBlocks.length; i++) {
		const block = codeBlocks[i];
		const isBash = isBashLanguage(block.language);

		// Check if this is an async block
		if (block.isAsync) {
			// Transform to async JS block
			blocksToAsync.set(i, {
				content: block.content.trim(),
				directoryPrefix: currentDirectory || undefined,
				description: block.asyncDescription,
			});
			continue;
		}

		// Check if this is a file extraction block (file path from file: directive)
		if (block.filePath) {
			// This is a file extraction block - transform to heredoc
			const fileContent = block.content.trim();
			extractedFiles.push({
				filePath: block.filePath,
				content: fileContent,
				language: block.language,
			});

			// Mark this block for transformation to heredoc
			// If we have a current directory, prepend it to the heredoc command
			blocksToHeredoc.set(i, {
				filePath: block.filePath,
				content: fileContent,
				directoryPrefix: currentDirectory || undefined,
			});

			continue;
		}

		// Check for directory set command in bash blocks
		if (isBash) {
			const blockLines = block.content.split('\n');
			let justSetDirectory = false;

			// First, check if this block has a directory set command
			const hasDirectorySet = blockLines.some((line) => isDirectorySetCommand(line));

			if (hasDirectorySet) {
				// If we have a current directory from a PREVIOUS block, prepend cd to this block
				// This ensures the cd command in this block is relative to the current virtual directory
				if (currentDirectory) {
					blocksToTransform.set(i, currentDirectory);
				}

				for (let j = 0; j < blockLines.length; j++) {
					const line = blockLines[j];
					if (isDirectorySetCommand(line)) {
						// Found directory set command, now look for the next cd command
						for (let k = j + 1; k < blockLines.length; k++) {
							const lineAfter = blockLines[k];
							const cdMatch = lineAfter.match(/^\s*cd\s+(.+)$/);
							if (cdMatch) {
								// The cd command will execute relative to the prepended virtual directory
								const newPath = cdMatch[1].trim();
								// Update the virtual directory context
								if (currentDirectory) {
									currentDirectory = `${currentDirectory}/${newPath}`;
								} else {
									currentDirectory = newPath;
								}
								justSetDirectory = true;
								// If standalone mode is enabled, mark this block for .npmrc insertion
								if (standalone) {
									npmrcInsertBlocks.add(i);
								}
								break;
							}
						}
						break;
					}
				}
			}

			// If we have a current directory from a PREVIOUS block, prepend cd to this bash block
			// Only prepend if this is NOT the block where we just set the directory (we already did above)
			if (currentDirectory && !justSetDirectory) {
				blocksToTransform.set(i, currentDirectory);
			}
		}
	}

	// Build preprocessed markdown
	const preprocessedLines: string[] = [];
	// Track lines to skip (blockquote lines that contained directives)
	const linesToSkip = new Set<number>();
	for (const block of codeBlocks) {
		if (block.precedingBlockquoteLine !== undefined && (block.filePath || block.isAsync)) {
			linesToSkip.add(block.precedingBlockquoteLine);
		}
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Skip blockquote lines that contained directives (they were consumed)
		if (linesToSkip.has(i)) {
			continue;
		}

		// Check if this is the start of a code block (including indented code blocks in list items)
		if (line.match(/^\s*```/)) {
			const blockIndex = codeBlocks.findIndex((b) => b.startLine === i);

			if (blockIndex !== -1) {
				const block = codeBlocks[blockIndex];

				// Check if this block should be transformed to async JS
				if (blocksToAsync.has(blockIndex)) {
					const asyncBlock = blocksToAsync.get(blockIndex)!;
					// Transform to JS block with $ template literal
					preprocessedLines.push('```js');
					
					// Join multiple lines with ; to execute as a single command chain
					// Filter out empty lines and comments that start with #
					const commandLines = asyncBlock.content
						.split('\n')
						.map(line => line.trim())
						.filter(line => line && !line.startsWith('#'));
					let command = commandLines.join('; ');
					
					// Add cd prefix if we have a directory context
					if (asyncBlock.directoryPrefix) {
						command = `cd ${asyncBlock.directoryPrefix} && ${command}`;
					}
					
					// Escape backticks in the command for the template literal
					const escapedCommand = command.replace(/`/g, '\\`');
					
					// Output the $ template literal (fire-and-forget, no await)
					// If killOnComplete is enabled, push to tracking array so we can kill it later
					if (killOnComplete) {
						// Wrap in a block to create a temp variable, attach .catch() to suppress
						// ONLY SIGKILL/SIGTERM errors (when we kill the process), then push to tracking array
						// Other errors (command failures, etc.) should still be reported
						preprocessedLines.push(`{ const __p = $\`${escapedCommand}\`; __p.catch((e) => { if (e?.signal !== 'SIGKILL' && e?.signal !== 'SIGTERM') throw e; }); __ezx_async_processes.push(__p); }`);
					} else {
						// zx will await all pending promises at the end
						preprocessedLines.push(`$\`${escapedCommand}\``);
					}
					preprocessedLines.push('```');
					// Skip to the closing ```
					i = block.endLine;
					continue;
				}

				// Check if this block should be transformed to heredoc
				if (blocksToHeredoc.has(blockIndex)) {
					const heredoc = blocksToHeredoc.get(blockIndex)!;
					// Transform to bash heredoc block
					preprocessedLines.push('```bash');
					// If we have a directory prefix, prepend cd && to the cat command
					// Also strip the directory prefix from the file path if it matches
					let catPath = heredoc.filePath;
					if (heredoc.directoryPrefix) {
						// Remove the directory prefix from the file path if it starts with it
						if (catPath.startsWith(heredoc.directoryPrefix + '/')) {
							catPath = catPath.slice(heredoc.directoryPrefix.length + 1);
						}
						preprocessedLines.push(`cd ${heredoc.directoryPrefix} && cat > '${catPath}' << 'EZXEOF'`);
					} else {
						preprocessedLines.push(`cat > '${catPath}' << 'EZXEOF'`);
					}
					preprocessedLines.push(heredoc.content);
					preprocessedLines.push('EZXEOF');
					preprocessedLines.push('```');
					// Skip to the closing ```
					i = block.endLine;
					continue;
				}

				// Output the opening ``` line (strip only sleep:N, preserve other modifiers like skip)
				// We need to get the languageTag from the original line since block.language is just the base language
				const origLangMatch = line.match(/^\s*```(.*)$/);
				const origFullTag = origLangMatch?.[1] || '';
				const { languageTag } = parseLanguageTag(origFullTag);
				preprocessedLines.push(`\`\`\`${languageTag}`);

				// Check if we need to prepend sleep command (only for bash blocks)
				if (block.sleepSeconds && isBashLanguage(block.language)) {
					preprocessedLines.push(`sleep ${block.sleepSeconds}`);
				}

				// Check if we need to prepend cd command
				if (blocksToTransform.has(blockIndex)) {
					const dir = blocksToTransform.get(blockIndex)!;
					preprocessedLines.push(`cd ${dir}`);
				}

				// Output the block content
				if (block.content) {
					preprocessedLines.push(block.content);
				}

				// If standalone mode is enabled and this block set the directory, append .npmrc creation
				if (npmrcInsertBlocks.has(blockIndex)) {
					preprocessedLines.push('');
					preprocessedLines.push('cat > .npmrc << \'EZXEOF\'');
					preprocessedLines.push('# Disable workspace awareness for test project');
					preprocessedLines.push('# This ensures that pnpm install and other commands work in standalone mode');
					preprocessedLines.push('enable-pre-post-scripts=true');
					preprocessedLines.push('shamefully-hoist=false');
					preprocessedLines.push('strict-peer-dependencies=false');
					preprocessedLines.push('EZXEOF');
				}

				// Skip to the closing ```
				i = block.endLine - 1;
			} else {
				// This is a closing ``` we've already processed
				preprocessedLines.push(line);
			}
		} else {
			// Regular line
			preprocessedLines.push(line);
		}
	}

	// Check if there are any async blocks
	const hasAsyncBlocks = blocksToAsync.size > 0;

	return {
		preprocessedMarkdown: preprocessedLines.join('\n'),
		extractedFiles,
		hasAsyncBlocks,
	};
}

/**
 * Read and preprocess a markdown file
 */
export function preprocessFile(
	filePath: string,
	options: {cwd?: string} = {},
): PreprocessResult {
	const content = readFileSync(filePath, 'utf-8');
	return preprocessMarkdown(content, options);
}
