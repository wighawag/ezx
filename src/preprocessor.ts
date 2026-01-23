import {readFileSync, writeFileSync, mkdirSync} from 'fs';
import {resolve, dirname} from 'path';

export interface CodeBlock {
	language: string;
	content: string;
	startLine: number;
	endLine: number;
}

export interface FileExtraction {
	filePath: string;
	content: string;
	language: string;
}

export interface PreprocessResult {
	preprocessedMarkdown: string;
	extractedFiles: FileExtraction[];
}

/**
 * Comment tokens for different languages
 */
const COMMENT_TOKENS: Record<string, string> = {
	// Languages with // comment
	typescript: '//',
	javascript: '//',
	js: '//',
	ts: '//',
	cpp: '//',
	c: '//',
	csharp: '//',
	go: '//',
	rust: '//',
	java: '//',
	kotlin: '//',
	swift: '//',
	php: '//',
	// Languages with # comment
	bash: '#',
	sh: '#',
	shell: '#',
	python: '#',
	rb: '#',
	ruby: '#',
	perl: '#',
	r: '#',
	// Languages with -- comment
	sql: '--',
	lua: '--',
	haskell: '--',
	// Languages with ; comment
	asm: ';',
	// Languages with <!-- comment -->
	html: '<!--',
	xml: '<!--',
	markdown: '<!--',
	md: '<!--',
};

/**
 * Get the comment token for a language
 */
function getCommentToken(language: string): string | null {
	const lowerLang = language.toLowerCase().trim();
	return COMMENT_TOKENS[lowerLang] || null;
}

/**
 * Parse markdown and extract all code blocks with their line numbers
 */
function parseCodeBlocks(markdown: string): CodeBlock[] {
	const codeBlocks: CodeBlock[] = [];
	const lines = markdown.split('\n');
	let inCodeBlock = false;
	let currentBlock: Partial<CodeBlock> = {};
	let blockStartLine = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Check for code block start
		if (line.match(/^```(\w+)?/)) {
			if (!inCodeBlock) {
				// Starting a new code block
				const languageMatch = line.match(/^```(\w+)?/);
				currentBlock = {
					language: languageMatch?.[1] || '',
					content: '',
					startLine: i,
				};
				inCodeBlock = true;
				blockStartLine = i;
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
					});
				}
				inCodeBlock = false;
				currentBlock = {};
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
 * Check if a line contains a file extraction comment
 */
function isFileExtractionComment(line: string, commentToken: string): string | null {
	const trimmed = line.trim();

	// For HTML/XML style comments, we need to remove the closing -->
	let searchLine = trimmed;
	if (commentToken === '<!--') {
		searchLine = trimmed.replace(/-->.*$/, '');
	}

	const filePattern = new RegExp(`^${escapeRegExp(commentToken)}\\s*file:\\s*(.+)$`, 'i');
	const match = searchLine.match(filePattern);
	if (match) {
		return match[1].trim();
	}
	return null;
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Preprocess markdown file
 */
export function preprocessMarkdown(
	input: string,
	options: {outputFiles?: boolean; cwd?: string} = {},
): PreprocessResult {
	const {outputFiles = false, cwd = process.cwd()} = options;
	const lines = input.split('\n');
	const codeBlocks = parseCodeBlocks(input);
	const extractedFiles: FileExtraction[] = [];

	// Track the current directory context
	let currentDirectory: string | null = null;

	// Set of block indices to remove completely (for file extraction)
	const blocksToRemove: Set<number> = new Set();
	// Map of block indices to transformations (prepend cd)
	const blocksToTransform: Map<number, string> = new Map();

	// Process each code block
	for (let i = 0; i < codeBlocks.length; i++) {
		const block = codeBlocks[i];
		const blockLines = block.content.split('\n');
		const isBash = block.language === 'bash' || block.language === 'sh' || block.language === 'shell';
		const commentToken = getCommentToken(block.language);

		// Check if this is a file extraction block
		if (commentToken) {
			const firstLine = blockLines[0] || '';
			const filePath = isFileExtractionComment(firstLine, commentToken);

			if (filePath) {
				// This is a file extraction block
				// Remove the comment line from the file content
				const fileContent = blockLines.slice(1).join('\n').trim();
				extractedFiles.push({
					filePath: resolve(cwd, filePath),
					content: fileContent,
					language: block.language,
				});

				// Mark this block for removal
				blocksToRemove.add(i);

				// If outputFiles is true, write the file
				if (outputFiles) {
					const filePath = extractedFiles[extractedFiles.length - 1].filePath;
					const dir = dirname(filePath);

					// Create directory if it doesn't exist
					mkdirSync(dir, {recursive: true});

					writeFileSync(filePath, fileContent, 'utf-8');
					console.log(`Extracted file: ${filePath}`);
				}

				continue;
			}
		}

		// Check for directory set command in bash blocks
		if (isBash) {
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
	let processedBlocks = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Check if this is the start of a code block
		if (line.match(/^```(\w+)?/)) {
			const blockIndex = codeBlocks.findIndex((b) => b.startLine === i);

			if (blockIndex !== -1) {
				const block = codeBlocks[blockIndex];

				// Check if this block should be removed
				if (blocksToRemove.has(blockIndex)) {
					// Skip this entire block
					i = block.endLine;
					continue;
				}

				// Output the opening ``` line
				preprocessedLines.push(line);

				// Check if we need to prepend cd command
				if (blocksToTransform.has(blockIndex)) {
					const dir = blocksToTransform.get(blockIndex)!;
					preprocessedLines.push(`cd ${dir}`);
				}

				// Output the block content
				if (block.content) {
					preprocessedLines.push(block.content);
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

	return {
		preprocessedMarkdown: preprocessedLines.join('\n'),
		extractedFiles,
	};
}

/**
 * Read and preprocess a markdown file
 */
export function preprocessFile(
	filePath: string,
	options: {outputFiles?: boolean; cwd?: string} = {},
): PreprocessResult {
	const content = readFileSync(filePath, 'utf-8');
	return preprocessMarkdown(content, options);
}
