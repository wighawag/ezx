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
	warnings: string[]; // Non-fatal hints about the document, meant for stderr
}

/**
 * Information about a block that will be transformed into a file write
 */
interface FileWriteTransform {
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
 * Escape text so that it survives being placed between the backticks of a
 * JavaScript template literal and comes out unchanged.
 *
 * zx's `transformMarkdown` turns every bash/sh/shell block into
 * `await $\`` + raw lines + `\`` without escaping; ezx emits that same shape
 * itself with the body escaped. zx builds the command from the template's
 * COOKED strings (`buildCmd` concatenates `pieces[0]`, `pieces[1]`, ... and never
 * reads `pieces.raw`). So the only characters that need escaping are the ones a
 * template literal interprets: `\` (escape sequences), a backtick (end of the
 * literal) and `${` (substitution). A lone carriage return would be normalised
 * to a line feed, so it is written as the `\r` escape sequence.
 */
export function escapeForZxTemplate(text: string): string {
	return text
		.replace(/\\/g, '\\\\')
		.replace(/`/g, '\\`')
		.replace(/\$\{/g, '\\${')
		.replace(/\r/g, '\\r');
}

/**
 * Whether zx will execute a fenced block with this info string as a shell command.
 * Mirrors zx's own fence regex: only an info string that is exactly `sh`, `shell`
 * or `bash` (case-sensitive) runs; anything else (`bash skip`, `BASH`, ...) is
 * turned into comments by zx and must be left untouched. ezx rewrites the
 * blocks that match into `js` blocks with an escaped `await $\`...\``.
 */
function zxRunsAsBash(languageTag: string): boolean {
	return /^(sh|shell|bash)$/.test(languageTag);
}

/**
 * Until 0.1.0, ezx (like zx) let JavaScript interpret the text of bash and
 * file blocks, so authors wrote `\${` or a backslash-escaped backtick to get `${`
 * or a backtick through. That text is now passed on unchanged, backslash
 * included, which silently changes what such a block does. Record a warning for
 * the first such line of a block; it may also be intentional, hence not an error.
 */
function warnAboutBackslashWorkaround(block: CodeBlock, kind: string, warnings: string[]): void {
	const offending = block.content.split('\n').find((line) => /\\(\$\{|`)/.test(line));
	if (offending === undefined) {
		return;
	}
	warnings.push(
		`[ezx] warning: ${kind} at line ${block.startLine + 1} contains "\\\${" or "\\\`": ` +
			`since ezx 0.1.0 it is passed on as written, backslash included. ` +
			`If the backslash was a workaround for the old escaping bug, remove it.\n  ${offending.trim()}`,
	);
}

/**
 * Build the JavaScript statement that writes an extracted file.
 *
 * The path and the content are JSON-encoded, so no character in the file can be
 * interpreted by JavaScript or by a shell. Relative paths resolve against zx's
 * working directory (`$.cwd`, else `process.cwd()`), like the shell commands.
 * Parent directories are NOT created: writing into a missing directory fails,
 * as the former `cat > file` heredoc did.
 *
 * With a directory context, the directory is resolved by the shell itself
 * (`cd <dir> && pwd`), so `~`, quotes and variables in the `cd` target keep
 * meaning what they mean in the bash blocks.
 */
function buildFileWriteStatement(filePath: string, content: string, directoryPrefix?: string): string {
	let base = '$.cwd || process.cwd()';
	if (directoryPrefix) {
		const cdCommand = escapeForZxTemplate(`cd ${directoryPrefix} && pwd`);
		base = `(await $\`${cdCommand}\`.quiet()).stdout.replace(/\\n$/, '')`;
	}
	return `fs.writeFileSync(path.resolve(${base}, ${JSON.stringify(filePath)}), ${JSON.stringify(content + '\n')});`;
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
	// Normalise line endings (CRLF and lone CR count as line endings in Markdown).
	// Otherwise a CRLF document's fence lines ("```bash\r") are not recognised and
	// its blocks keep a trailing \r on every line.
	input = input.replace(/\r\n?/g, '\n');
	const lines = input.split('\n');
	const codeBlocks = parseCodeBlocks(input);
	const extractedFiles: FileExtraction[] = [];
	const warnings: string[] = [];

	// Track the current directory context
	let currentDirectory: string | null = null;

	// Map of block indices to transformations (prepend cd)
	const blocksToTransform: Map<number, string> = new Map();
	// Map of block indices to transform into a file write
	const blocksToFileWrite: Map<number, FileWriteTransform> = new Map();
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
			warnAboutBackslashWorkaround(block, 'async: block', warnings);
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
			// This is a file extraction block - transform into a file write
			const fileContent = block.content.trim();
			warnAboutBackslashWorkaround(block, `file: block (${block.filePath})`, warnings);
			extractedFiles.push({
				filePath: block.filePath,
				content: fileContent,
				language: block.language,
			});

			// Mark this block for transformation into a file write
			// If we have a current directory, the path is resolved inside it
			blocksToFileWrite.set(i, {
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
					
					// Escape the command for the template literal so the shell receives it unchanged
					const escapedCommand = escapeForZxTemplate(command);
					
					// Output the $ template literal (fire-and-forget, no await)
					// If killOnComplete is enabled, push to tracking array so we can kill it later
					if (killOnComplete) {
						// Wrap in a block to create a temp variable, attach .catch() to suppress
						// ONLY SIGKILL/SIGTERM/SIGINT errors (when we kill the process), then push to tracking array
						// Other errors (command failures, etc.) should still be reported
						preprocessedLines.push(`{ const __p = $\`${escapedCommand}\`; __p.catch((e) => { if (e?.signal !== 'SIGKILL' && e?.signal !== 'SIGTERM' && e?.signal !== 'SIGINT') throw e; }); __ezx_async_processes.push(__p); }`);
					} else {
						// zx will await all pending promises at the end
						preprocessedLines.push(`$\`${escapedCommand}\``);
					}
					preprocessedLines.push('```');
					// Skip to the closing ```
					i = block.endLine;
					continue;
				}

				// Check if this block should be transformed into a file write
				if (blocksToFileWrite.has(blockIndex)) {
					const fileWrite = blocksToFileWrite.get(blockIndex)!;
					// Transform to a JS block that writes the file with fs.
					// Not a bash heredoc: zx would place the heredoc inside a template
					// literal, where backticks and ${ in the content break the script.
					preprocessedLines.push('```js');
					// With a directory context, the path is relative to the context directory,
					// unless it starts with that directory, in which case the prefix is stripped
					let targetPath = fileWrite.filePath;
					if (fileWrite.directoryPrefix && targetPath.startsWith(fileWrite.directoryPrefix + '/')) {
						targetPath = targetPath.slice(fileWrite.directoryPrefix.length + 1);
					}
					preprocessedLines.push(buildFileWriteStatement(targetPath, fileWrite.content, fileWrite.directoryPrefix));
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
				const runsAsBash = zxRunsAsBash(languageTag);
				if (runsAsBash) {
					warnAboutBackslashWorkaround(block, 'bash block', warnings);
				}

				const bodyLines: string[] = [];

				// Check if we need to prepend sleep command (only for bash blocks)
				if (block.sleepSeconds && isBashLanguage(block.language)) {
					bodyLines.push(`sleep ${block.sleepSeconds}`);
				}

				// Check if we need to prepend cd command
				if (blocksToTransform.has(blockIndex)) {
					const dir = blocksToTransform.get(blockIndex)!;
					bodyLines.push(`cd ${dir}`);
				}

				// Output the block content
				if (block.content) {
					bodyLines.push(block.content);
				}

				// If standalone mode is enabled and this block set the directory, append .npmrc creation
				if (npmrcInsertBlocks.has(blockIndex)) {
					bodyLines.push('');
					bodyLines.push('cat > .npmrc << \'EZXEOF\'');
					bodyLines.push('# Disable workspace awareness for test project');
					bodyLines.push('# This ensures that pnpm install and other commands work in standalone mode');
					bodyLines.push('enable-pre-post-scripts=true');
					bodyLines.push('shamefully-hoist=false');
					bodyLines.push('strict-peer-dependencies=false');
					bodyLines.push('EZXEOF');
				}

				if (runsAsBash) {
					// Emit the `await $\`...\`` that zx would generate for a bash block,
					// but with the body escaped for the template literal, so the shell
					// receives exactly the text written in the Markdown. Doing it here,
					// instead of leaving a bash fence to zx's transformMarkdown, keeps the
					// result correct whether or not a future zx escapes bash blocks itself
					// (which would otherwise escape them a second time).
					preprocessedLines.push('```js');
					preprocessedLines.push('await $`');
					if (bodyLines.length > 0) {
						preprocessedLines.push(escapeForZxTemplate(bodyLines.join('\n')));
					}
					preprocessedLines.push('`');
				} else {
					// Not executed by zx as a shell command (js block, skipped block,
					// documentation-only language): keep the block as written.
					preprocessedLines.push(`\`\`\`${languageTag}`);
					if (bodyLines.length > 0) {
						preprocessedLines.push(bodyLines.join('\n'));
					}
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
		warnings,
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
