#!/usr/bin/env node

import { Command } from 'commander';
import { readFile, writeFile, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { preprocessFile, preprocessMarkdown } from './preprocessor.js';

const program = new Command();

program
	.name('ezx')
	.description('A markdown preprocessor for zx that addresses directory context and file writing annoyances')
	.version('0.0.0')
	.argument('<input>', 'Input markdown file path')
	.option('-o, --output <path>', 'Output file path (defaults to stdout)')
	.option('-w, --write-files', 'Extract and write files to disk')
	.option('-c, --cwd <path>', 'Working directory for relative paths', process.cwd())
	.action((input, options) => {
		const inputPath = resolve(options.cwd, input);
		
		try {
			const result = preprocessFile(inputPath, {
				outputFiles: options.writeFiles,
				cwd: options.cwd,
			});

			if (options.output) {
				const outputPath = resolve(options.cwd, options.output);
				const outputDir = dirname(outputPath);
				
				// Create output directory if it doesn't exist
				mkdirSync(outputDir, { recursive: true });
				
				writeFile(outputPath, result.preprocessedMarkdown, 'utf-8', (err) => {
					if (err) {
						console.error(`Error writing output file: ${err.message}`);
						process.exit(1);
					}
					console.log(`Preprocessed markdown written to: ${outputPath}`);
					
					if (result.extractedFiles.length > 0) {
						console.log(`\nExtracted ${result.extractedFiles.length} file(s):`);
						result.extractedFiles.forEach(file => {
							console.log(`  - ${file.filePath} (${file.language})`);
						});
					}
				});
			} else {
				// Output to stdout
				console.log(result.preprocessedMarkdown);
				
				if (result.extractedFiles.length > 0 && !options.writeFiles) {
					console.error('\nNote: Files were detected but not written. Use --write-files flag to extract them.');
					console.error(`Found ${result.extractedFiles.length} file(s):`);
					result.extractedFiles.forEach(file => {
						console.error(`  - ${file.filePath} (${file.language})`);
					});
				}
			}
		} catch (error) {
			console.error(`Error processing file: ${error instanceof Error ? error.message : String(error)}`);
			process.exit(1);
		}
	});

// Add a subcommand to preprocess from stdin
program
	.command('stdin')
	.description('Preprocess markdown from stdin')
	.option('-o, --output <path>', 'Output file path (defaults to stdout)')
	.option('-w, --write-files', 'Extract and write files to disk')
	.option('-c, --cwd <path>', 'Working directory for relative paths', process.cwd())
	.action((options) => {
		let stdinData = '';
		
		process.stdin.on('data', (chunk) => {
			stdinData += chunk;
		});
		
		process.stdin.on('end', () => {
			try {
				const result = preprocessMarkdown(stdinData, {
					outputFiles: options.writeFiles,
					cwd: options.cwd,
				});

				if (options.output) {
					const outputPath = resolve(options.cwd, options.output);
					const outputDir = dirname(outputPath);
					
					// Create output directory if it doesn't exist
					mkdirSync(outputDir, { recursive: true });
					
					writeFile(outputPath, result.preprocessedMarkdown, 'utf-8', (err) => {
						if (err) {
							console.error(`Error writing output file: ${err.message}`);
							process.exit(1);
						}
						console.log(`Preprocessed markdown written to: ${outputPath}`);
						
						if (result.extractedFiles.length > 0) {
							console.log(`\nExtracted ${result.extractedFiles.length} file(s):`);
							result.extractedFiles.forEach(file => {
								console.log(`  - ${file.filePath} (${file.language})`);
							});
						}
					});
				} else {
					console.log(result.preprocessedMarkdown);
					
					if (result.extractedFiles.length > 0 && !options.writeFiles) {
						console.error('\nNote: Files were detected but not written. Use --write-files flag to extract them.');
						console.error(`Found ${result.extractedFiles.length} file(s):`);
						result.extractedFiles.forEach(file => {
							console.error(`  - ${file.filePath} (${file.language})`);
						});
					}
				}
			} catch (error) {
				console.error(`Error processing stdin: ${error instanceof Error ? error.message : String(error)}`);
				process.exit(1);
			}
		});
	});

program.parse(process.argv);