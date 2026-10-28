// End-to-end tests: run the built CLI (dist/cli.js) on fixture Markdown files
// inside a fresh temporary directory, then inspect what was written.
// Run with `pnpm test` (builds first).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, existsSync, copyFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'dist', 'cli.js');
const fixtures = join(here, 'fixtures');

function runFixture(name, args = [], {timeout = 60_000} = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'ezx-test-'));
	copyFileSync(join(fixtures, name), join(dir, name));
	const started = Date.now();
	const result = spawnSync(process.execPath, [cli, name, ...args], {
		cwd: dir,
		encoding: 'utf8',
		timeout,
	});
	const elapsed = Date.now() - started;
	const read = (p) => readFileSync(join(dir, p), 'utf8');
	const exists = (p) => existsSync(join(dir, p));
	const cleanup = () => rmSync(dir, {recursive: true, force: true});
	return {dir, result, elapsed, read, exists, cleanup};
}

function assertOk(result) {
	assert.equal(result.status, 0, `ezx failed (status ${result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

// Extract the text between the fences of the code block that follows `marker`
// in a fixture, exactly as written in the Markdown.
function blockAfter(fixture, marker) {
	const md = readFileSync(join(fixtures, fixture), 'utf8');
	const start = md.indexOf(marker);
	assert.ok(start >= 0, `marker not found: ${marker}`);
	const open = md.indexOf('```', start);
	const bodyStart = md.indexOf('\n', open) + 1;
	const close = md.indexOf('\n```', bodyStart);
	return md.slice(bodyStart, close);
}

test('file extraction writes backticks, ${, backslashes and EZXEOF verbatim', (t) => {
	const run = runFixture('special-file.md');
	t.after(run.cleanup);
	assertOk(run.result);
	// byte-identical to the block content (plus the final newline ezx has always added)
	assert.equal(run.read('out/sample.ts'), blockAfter('special-file.md', 'file: `out/sample.ts`') + '\n');
});

test('bash blocks hand backticks, ${VAR} and backslashes to the shell unchanged', (t) => {
	const run = runFixture('special-bash.md');
	t.after(run.cleanup);
	assertOk(run.result);
	// backtick substitution, ${VAR} expansion and backslashes are interpreted by bash, not by JavaScript
	assert.equal(
		run.read('out/bash-out.txt'),
		'greeting world sub paren\n' + 'back\\slash \\n literal \\\\ double\n' + '3\n',
	);
	assert.equal(run.read('out/bash-heredoc.txt'), 'type Hex = `0x${string}`;\n' + 'a \\n b \\\\ c \\u0041\n');
});

test('async blocks hand backticks, ${VAR} and backslashes to the shell unchanged', (t) => {
	const run = runFixture('special-async.md');
	t.after(run.cleanup);
	assertOk(run.result);
	// NAME is unset in that shell; inside double quotes bash turns \\ into \ and keeps \s and \n
	assert.equal(run.read('out/async-out.txt'), 'async anon sub back\\slash \\ \\n\n');
});

test('directory context applies to file extraction and bash blocks with special characters', (t) => {
	const run = runFixture('special-directory-context.md');
	t.after(run.cleanup);
	assertOk(run.result);
	assert.equal(run.read('ctx/stripped.txt'), 'prefix `stripped` ${HOME} \\n\n');
	assert.equal(run.read('ctx/sub/relative.txt'), 'relative to `ctx` ${HOME} \\n\n');
	assert.equal(run.read('ctx/here.txt'), 'in ctx ctx ok\n');
	assert.equal(run.exists('stripped.txt'), false);
});

test('bash blocks do not depend on zx escaping (or not) its own bash fences', (t) => {
	// ezx emits bash blocks as js blocks with `await $`...``, so a zx release that
	// starts escaping bash fences itself cannot escape ezx's output a second time.
	const run = runFixture('special-bash.md', ['--preprocess-only']);
	t.after(run.cleanup);
	assertOk(run.result);
	assert.doesNotMatch(run.result.stdout, /^(`{3,}|~{3,})(sh|shell|bash)$/m);
	assert.match(run.result.stdout, /^await \$`$/m);
});

test('a backslash before ${ or a backtick produces a migration warning', (t) => {
	const run = runFixture('special-file.md');
	t.after(run.cleanup);
	assertOk(run.result);
	assert.match(run.result.stderr, /\[ezx\] warning: file: block \(out\/sample\.ts\) at line \d+/);

	const clean = runFixture('special-bash.md');
	t.after(clean.cleanup);
	assertOk(clean.result);
	assert.doesNotMatch(clean.result.stderr, /\[ezx\] warning/);

	const quiet = runFixture('special-file.md', ['--quiet']);
	t.after(quiet.cleanup);
	assertOk(quiet.result);
	assert.doesNotMatch(quiet.result.stderr, /\[ezx\] warning/);
});

test('file extraction fails when the parent directory does not exist', (t) => {
	const run = runFixture('missing-parent.md');
	t.after(run.cleanup);
	assert.notEqual(run.result.status, 0, 'expected ezx to fail');
	assert.equal(run.exists('nope/file.txt'), false);
});

test('labels, sleep:N, skip and directory context keep working', (t) => {
	const run = runFixture('behaviours.md');
	t.after(run.cleanup);
	assertOk(run.result);
	assert.equal(run.read('label.txt'), 'label\n');
	assert.equal(run.read('sleep.txt'), 'slept\n');
	assert.equal(run.exists('skipped.txt'), false);
	assert.equal(run.read('proj/where.txt'), 'proj\n');
	assert.equal(run.read('proj/data.json'), '{"name": "proj"}\n');
	assert.equal(run.read('proj/section-b.txt'), 'b\n');
});

test('--sections runs only the selected section', (t) => {
	const run = runFixture('behaviours.md', ['--sections', 'Section B']);
	t.after(run.cleanup);
	assertOk(run.result);
	assert.equal(run.read('section-b.txt'), 'b\n');
	assert.equal(run.exists('label.txt'), false);
	assert.equal(run.exists('proj'), false);
});

test('--kill-on-complete stops async processes at the end', (t) => {
	const run = runFixture('kill.md', ['--kill-on-complete'], {timeout: 25_000});
	t.after(run.cleanup);
	assertOk(run.result);
	assert.equal(run.read('done.txt'), 'done\n');
	assert.ok(run.elapsed < 20_000, `took ${run.elapsed}ms, async process was not killed`);
});
