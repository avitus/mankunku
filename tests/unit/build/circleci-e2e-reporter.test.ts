import { afterEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

// This invokes Playwright's Node test runner only: the fixture requests no
// browser, page, or context, and never launches a browser on the host.
it('keeps progress output while writing impact data (2026-10-29 analysis idle timeout)', () => {
	const dir = mkdtempSync(join(tmpdir(), 'circleci-reporter-'));
	directories.push(dir);
	const coverage = join(dir, 'coverage.json');
	const config = join(dir, 'playwright.config.cjs');
	writeFileSync(config, `module.exports = ${JSON.stringify({
		testDir: dir,
		workers: 1,
		outputDir: join(dir, 'results'),
		reporter: [
			['html', { open: 'never', outputFolder: join(dir, 'report') }],
			['github'],
			[resolve('tests/e2e/reporters/circleci-coverage.ts')]
		]
	})};`);
	writeFileSync(join(dir, 'coverage.spec.cjs'), `
const { test } = require(${JSON.stringify(require.resolve('@playwright/test'))});
test('records coverage', async ({}, info) => {
  await info.attach('circleci-coverage', {
    body: JSON.stringify(['src/example.ts']), contentType: 'application/json'
  });
});
`);
	const cli = join(dirname(require.resolve('playwright/package.json')), 'cli.js');
	const result = spawnSync(process.execPath, [cli, 'test', '--config', config], {
		encoding: 'utf8', timeout: 15_000,
		env: { ...process.env, CIRCLECI_COVERAGE: coverage, FORCE_COLOR: '0' }
	});
	expect(result.status, result.stderr).toBe(0);
	// The file-only reporter used to suppress Playwright's fallback reporter:
	// successful tests emitted nothing, so CircleCI killed a healthy long run.
	expect(result.stdout).toContain('Running 1 test');
	expect(JSON.parse(readFileSync(coverage, 'utf8'))).toEqual({
		'src/example.ts': { 'coverage.spec.cjs!!records coverage|run': true }
	});
}, 20_000);
