import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

interface CodeBlock {
	language: string;
	content: string;
	startLine: number;
	endLine: number;
}

interface FileExtraction {
	filePath: string;
	content: string;
	language: string;
}

interface PreprocessResult {
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
				if (currentBlock.language !== undefined && currentBlock.content !== undefined && currentBlock.startLine !== undefined) {
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
	const filePattern = new RegExp(`^${escapeRegExp(commentToken)}\\s*file:\\s*(.+)$`, 'i');
	const match = trimmed.match(filePattern);
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
export function preprocessMarkdown(input: string, options: { outputFiles?: boolean; cwd?: string } = {}): PreprocessResult {
	const { outputFiles = false, cwd = process.cwd() } = options;
	const lines = input.split('\n');
	const codeBlocks = parseCodeBlocks(input);
	const extractedFiles: FileExtraction[] = [];
	
	// Track the current directory context
	let currentDirectory: string | null = null;
	
	// Set of block indices to remove completely
	const blocksToRemove: Set<number> = new Set();
	// Map of block indices to transformations (prepend cd)
	const blocksToTransform: Map<number, string> = new Map();

	// Process each code block
	for (let i = 0; i < codeBlocks.length; i++) {
		const block = codeBlocks[i];
		const blockLines = block.content.split('\n');
		const isBash = block.language === 'bash' || block.language === 'sh';
		const commentToken = getCommentToken(block.language);

		// Check if this is a file extraction block
		if (commentToken) {
			const firstLine = blockLines[0] || '';
			const filePath = isFileExtractionComment(firstLine, commentToken);
			
			if (filePath) {
				// This is a file extraction block
				const fileContent = blockLines.slice(1).join('\n').trim();
				extractedFiles.push({
					filePath: resolve(cwd, filePath),
					content: fileContent,
					language: block.language,
				});
				
				// Mark this block for removal
				blocksToRemove.add(i);
				
				// Reset directory context after file extraction
				currentDirectory = null;
				
				// If outputFiles is true, write the file
				if (outputFiles) {
					const filePath = extractedFiles[extractedFiles.length - 1].filePath;
					const dir = dirname(filePath);
					
					// Create directory if it doesn't exist
					mkdirSync(dir, { recursive: true });
					
					writeFileSync(filePath, fileContent, 'utf-8');
					console.log(`Extracted file: ${filePath}`);
				}
				
				continue;
			}
		}

		// Check for directory set command in bash blocks
		if (isBash) {
			for (let j = 0; j < blockLines.length; j++) {
				const line = blockLines[j];
				
				if (isDirectorySetCommand(line)) {
					// Found directory set command
					const nextLine = blockLines[j + 1];
					if (nextLine) {
						const cdMatch = nextLine.match(/^\s*cd\s+(.+)$/);
						if (cdMatch) {
							currentDirectory = cdMatch[1].trim();
							// Remove the comment and cd lines from the block
							const newBlockLines = [...blockLines];
							newBlockLines.splice(j, 2);
							codeBlocks[i] = {
								...block,
								content: newBlockLines.join('\n'),
							};
							break;
						}
					}
				}
			}

			// If we have a current directory, prepend cd to this bash block
			if (currentDirectory && block.content.trim() !== '') {
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
			const blockIndex = codeBlocks.findIndex(
				b => b.startLine === i
			);

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
export function preprocessFile(filePath: string, options: { outputFiles?: boolean; cwd?: string } = {}): PreprocessResult {
	const content = readFileSync(filePath, 'utf-8');
	return preprocessMarkdown(content, options);
}