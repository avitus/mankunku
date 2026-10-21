import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

/** Exercise the real runner against a fake Docker daemon in a throwaway Git checkout. */
function fixture(exitCode: number, { copyFailure = false, junit = false, missingEngine = false } = {}) {
	const root = mkdtempSync(path.join(tmpdir(), 'sandbox-lifecycle-'));
	directories.push(root);
	mkdirSync(path.join(root, 'scripts'), { recursive: true });
	mkdirSync(path.join(root, 'bin'));
	cpSync('scripts/test-sandbox.mjs', path.join(root, 'scripts/test-sandbox.mjs'));
	writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages: {
		'node_modules/@playwright/test': { version: '1.62.1' },
		'node_modules/playwright-core': { version: '1.62.1' }
	} }));
	writeFileSync(path.join(root, 'deleted.txt'), 'Deleted before the run');
	writeFileSync(path.join(root, '.env.test'), 'PRIVATE_TOKEN=never-copy');
	writeFileSync(path.join(root, '.npmrc'), '//registry.npmjs.org/:_authToken=never-copy');
	spawnSync('git', ['init', '-q'], { cwd: root });
	spawnSync('git', ['add', '.'], { cwd: root });
	rmSync(path.join(root, 'deleted.txt'));
	writeFileSync(path.join(root, 'uncommitted.txt'), 'Current worktree');
	mkdirSync(path.join(root, 'tests/unit/build'), { recursive: true });
	writeFileSync(path.join(root, 'tests/unit/build/source.test.ts'), 'Source, not generated output');
	writeFileSync(path.join(root, 'bin/docker'), `#!${process.execPath}
const fs = require('node:fs');
let args = process.argv.slice(2);
if (args[0] === '--context') args = args.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(args) + '\\n');
switch (args[0]) {
  case 'info': ${missingEngine ? 'process.exit(1);' : "console.log('linux');"} break;
  case 'build': {
    const snapshot = args.at(-1);
    if (!fs.existsSync(snapshot + '/uncommitted.txt') || !fs.existsSync(snapshot + '/tests/unit/build/source.test.ts') || fs.existsSync(snapshot + '/deleted.txt') ||
        fs.existsSync(snapshot + '/.env.test') || fs.readFileSync(snapshot + '/.npmrc', 'utf8').includes('never-copy')) process.exit(99);
    fs.writeFileSync(args[args.indexOf('--iidfile') + 1], 'sha256:fixture');
    break;
  }
  case 'start': process.exit(${exitCode});
  case 'cp': process.exit(${copyFailure ? 1 : 0});
}
`, { mode: 0o755 });
	const log = path.join(root, 'calls.jsonl');
	const result = spawnSync(process.execPath, [path.join(root, 'scripts/test-sandbox.mjs'), 'e2e',
		'--grep', 'Two words | $(never-execute)'], { cwd: root, encoding: 'utf8',
		env: { ...process.env, PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
			MANKUNKU_DOCKER_CONTEXT: 'fixture', CALL_LOG: log, CIRCLECI: '', MANKUNKU_TEST_SANDBOX: '',
			CIRCLECI_COVERAGE: '', PLAYWRIGHT_JUNIT_OUTPUT_FILE: junit ? path.join(root, 'results/junit.xml') : '' } });
	if (!existsSync(log)) throw new Error(`Runner did not invoke Docker: ${result.stderr}`);
	const calls: string[][] = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
	return { root, result, calls };
}

describe('Sandbox lifecycle', () => {
	it.each([0, 7])('returns test status %s, snapshots edits, and recovers artifacts before cleanup', (exitCode) => {
		const { result, calls } = fixture(exitCode);
		expect(result.stderr).toBe('');
		expect(result.status).toBe(exitCode);
		const create = calls.find((args) => args[0] === 'create')!;
		expect(create).toContain('--memory=4g');
		expect(create).toContain('--cpus=2');
		expect(create).toContain('--cap-drop=ALL');
		expect(create).toContain('--security-opt=no-new-privileges');
		expect(create).not.toContain('--volume');
		expect(create).not.toContain('--network=host');
		expect(create).not.toContain('--publish');
		expect(create.at(-1)).toBe('Two words | $(never-execute)');
		expect(calls.slice(-4).map((args) => args[0])).toEqual(['stop', 'cp', 'cp', 'rm']);
		const snapshot = calls.find((args) => args[0] === 'build')!.at(-1)!;
		expect(existsSync(snapshot)).toBe(false);
	});
	it('retains the stopped container if artifact recovery fails', () => {
		const { result, calls } = fixture(7, { copyFailure: true });
		expect(result.status).toBe(7);
		expect(result.stderr).toContain('Artifact recovery failed; container retained');
		expect(calls.some((args) => args[0] === 'rm')).toBe(false);
	});
	it('maps Smarter Testing output into the sandbox and copies it to the requested caller path', () => {
		const { result, calls, root } = fixture(0, { junit: true });
		expect(result.status).toBe(0);
		expect(calls.find((args) => args[0] === 'create')).toContain('PLAYWRIGHT_JUNIT_OUTPUT_FILE=/workspace/test-results/junit.xml');
		expect(calls.some((args) => args[0] === 'cp' && args[1].endsWith(':/workspace/test-results/junit.xml') &&
			args[2] === path.join(root, 'results/junit.xml'))).toBe(true);
	});
	it('fails before any build or browser launch when the engine is unavailable', () => {
		const { result, calls } = fixture(0, { missingEngine: true });
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('never fall back to the host');
		expect(calls.map((args) => args[0])).toEqual(['info']);
	});
});
