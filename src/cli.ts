#!/usr/bin/env node

import {Command} from 'commander';
import {runMarkdownFile, type RunMarkdownOptions} from './index.js';

const program = new Command();

program
	.name('ezx')
	.description('Enhanced zx - A tool for writing better scripts with markdown support')
	.version('0.0.0')
	.argument('<script>', 'Path to markdown script')
	.option('-v, --verbose', 'enable verbose mode')
	.option('-q, --quiet', 'suppress any outputs')
	.option('--shell <path>', 'custom shell binary')
	.option('--prefix <command>', 'prefix all commands')
	.option('--postfix <command>', 'postfix all commands')
	.option('--cwd <path>', 'set current directory')
	.action(async (script: string, options: RunMarkdownOptions) => {
		try {
			await runMarkdownFile(script, options);
		} catch (error) {
			console.error('Error:', error instanceof Error ? error.message : error);
			process.exit(1);
		}
	});

program.parse();
