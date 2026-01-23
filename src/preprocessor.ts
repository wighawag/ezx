import {readFileSync} from 'node:fs';

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
 * Information about a block that will be transformed to a heredoc
 */
interface HeredocTransform {
	filePath: string;
	content: string;
	directoryPrefix?: string; // Optional cd prefix for unified directory context
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
 * Try to extract file path from a line using multiple comment patterns
 */
function tryExtractFilePath(line: string): string | null {
	// Common comment patterns to try, in order of preference
	const commentPatterns = [
		'//',        // Most common
		'#',         // Shell/Python
		'<!--',      // HTML/XML/Markdown
		'--',        // SQL/Lua
		';',         // Assembly
	];

	const trimmed = line.trim();

	for (const pattern of commentPatterns) {
		const filePath = isFileExtractionComment(trimmed, pattern);
		if (filePath) {
			return filePath;
		}
	}

	return null;
}

/**
 * Preprocess markdown file
 */
export function preprocessMarkdown(
	input: string,
	options: {cwd?: string} = {},
): PreprocessResult {
	const {cwd = process.cwd()} = options;
	const lines = input.split('\n');
	const codeBlocks = parseCodeBlocks(input);
	const extractedFiles: FileExtraction[] = [];

	// Track the current directory context
	let currentDirectory: string | null = null;

	// Map of block indices to transformations (prepend cd)
	const blocksToTransform: Map<number, string> = new Map();
	// Map of block indices to transform to heredoc
	const blocksToHeredoc: Map<number, HeredocTransform> = new Map();

	// Process each code block
	for (let i = 0; i < codeBlocks.length; i++) {
		const block = codeBlocks[i];
		const blockLines = block.content.split('\n');
		const isBash = block.language === 'bash' || block.language === 'sh' || block.language === 'shell';

		// Check if this is a file extraction block by trying multiple comment patterns
		const firstLine = blockLines[0] || '';
		const filePath = tryExtractFilePath(firstLine);

		if (filePath) {
			// This is a file extraction block - transform to heredoc
			// Remove the comment line from the file content
			const fileContent = blockLines.slice(1).join('\n').trim();
			extractedFiles.push({
				filePath: filePath, // Keep relative path for heredoc command
				content: fileContent,
				language: block.language,
			});

			// Mark this block for transformation to heredoc
			// If we have a current directory, prepend it to the heredoc command
			blocksToHeredoc.set(i, {
				filePath: filePath,
				content: fileContent,
				directoryPrefix: currentDirectory || undefined,
			});

			continue;
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
	options: {cwd?: string} = {},
): PreprocessResult {
	const content = readFileSync(filePath, 'utf-8');
	return preprocessMarkdown(content, options);
}
