#!/usr/bin/env node

import {Command} from 'commander';
import {runMarkdownFile, type RunMarkdownOptions} from './index.js';
import pkg from '../package.json' with {type: 'json'};

const program = new Command();

program
	.name('ezx')
	.description('Enhanced zx - A tool for writing better scripts with markdown support')
	.version(pkg.version)
	.argument('<script>', 'Path to markdown script')
	.option('-v, --verbose', 'enable verbose mode')
	.option('-q, --quiet', 'suppress any outputs')
	.option('--shell <path>', 'custom shell binary')
	.option('--prefix <command>', 'prefix all commands')
	.option('--postfix <command>', 'postfix all commands')
	.option('--cwd <path>', 'set current directory')
	.option('-s, --sections <headings...>', 'execute only sections under these headings (e.g., "Create a new project")')
	.option('-p, --preprocess-only [file]', 'output preprocessed markdown without executing (optionally to a file)')
	.action(async (script: string, options: RunMarkdownOptions) => {
		try {
			await runMarkdownFile(script, options);
		} catch (error) {
			console.error('Error:', error instanceof Error ? error.message : error);
			process.exit(1);
		}
	});

program.parse();
