import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertBrowserTestIsolation } from '../../../scripts/browser-test-boundary.js';
import { diagnosticEnvironment, includeInSnapshot, playwrightVersion, testCommand } from '../../../scripts/test-sandbox.mjs';

describe('Browser isolation boundary', () => {
	it.each(['darwin', 'win32', 'linux'])('refuses host browsers on %s, including CI=1 and forged sandbox flags', (platform) => {
		expect(() => assertBrowserTestIsolation({ platform, container: false,
			env: { CI: '1', MANKUNKU_TEST_SANDBOX: '1' } })).toThrow('Linux sandbox');
	});
	it('admits Linux containers and CircleCI Linux executors', () => {
		expect(() => assertBrowserTestIsolation({ platform: 'linux', container: true, env: {} })).not.toThrow();
		expect(() => assertBrowserTestIsolation({ platform: 'linux', container: false,
			env: { CIRCLECI: 'true' } })).not.toThrow();
		expect(() => assertBrowserTestIsolation({ platform: 'darwin', container: false,
			env: { CIRCLECI: 'true' } })).toThrow();
	});
});

describe('Diagnostic input directories', () => {
	let worktree: string;
	let snapshot: string;
	beforeEach(async () => {
		worktree = await mkdtemp(path.join(tmpdir(), 'diagnostic-inputs-'));
		snapshot = path.join(worktree, 'snapshot');
		await mkdir(snapshot);
	});
	afterEach(async () => {
		await rm(worktree, { recursive: true, force: true });
	});

	it('preserves both configured directories, including spaces, when copied into the snapshot', async () => {
		await mkdir(path.join(snapshot, 'fixtures/calibration'), { recursive: true });
		await mkdir(path.join(snapshot, 'fixtures/render inputs'));
		await expect(diagnosticEnvironment(snapshot, {
			CALIB_DIR: 'fixtures/calibration', RENDER_DIR: 'fixtures/render inputs'
		})).resolves.toEqual([
			'--env', 'CALIB_DIR=fixtures/calibration', '--env', 'RENDER_DIR=fixtures/render inputs'
		]);
	});

	it('rejects a host directory that was omitted from the snapshot', async () => {
		await mkdir(path.join(worktree, 'ignored-fixtures'));
		await expect(diagnosticEnvironment(snapshot, { CALIB_DIR: 'ignored-fixtures' }))
			.rejects.toThrow('CALIB_DIR must be a repository-relative directory included in the snapshot.');
	});

	it('rejects files and paths whose parent is a file', async () => {
		await writeFile(path.join(snapshot, 'fixture.json'), '{}');
		for (const value of ['fixture.json', 'fixture.json/child']) {
			await expect(diagnosticEnvironment(snapshot, { RENDER_DIR: value }))
				.rejects.toThrow('RENDER_DIR must be a repository-relative directory included in the snapshot.');
		}
	});

	it.each(['/tmp', '../outside', '..\\outside'])('rejects non-relative input %s', async (value) => {
		await expect(diagnosticEnvironment(snapshot, { CALIB_DIR: value }))
			.rejects.toThrow('repository-relative directory');
	});

	it('preserves unexpected filesystem errors', async () => {
		await symlink('loop', path.join(snapshot, 'loop'));
		await expect(diagnosticEnvironment(snapshot, { RENDER_DIR: 'loop/child' }))
			.rejects.toMatchObject({ code: 'ELOOP' });
	});
});

describe('Test sandbox snapshot and invocation', () => {
	it.each(['.env', '.env.test', '.env.sentry-build-plugin', 'nested/.env.local', '.git/config',
		'.claude/worktrees/another/src/main.ts', '.chunk/config.json', 'node_modules/vitest/run.js',
		'tests/e2e/.auth/user.json', 'supabase/.temp/password', 'test-results/report.json',
		'build/index.js', '.svelte-kit/output/server.js', 'playwright-report/index.html', 'private.pem',
		'PRIVATE.PEM', 'nested/private.Key', 'IDENTITY.P12', 'nested/Identity.PfX'])
	('excludes host state even if Git tracks %s', (file) => {
		expect(includeInSnapshot(file)).toBe(false);
	});
	it.each(['.env.example', 'src/app.html', 'tests/e2e/smoke.spec.ts', '.circleci/test-suites.yml',
		'tests/unit/build/browser-test-sandbox.test.ts'])
	('copies source %s', (file) => {
		expect(includeInSnapshot(file)).toBe(true);
	});
	it('uses the locked browser version and refuses mismatched browser packages', () => {
		expect(playwrightVersion({ packages: {
			'node_modules/@playwright/test': { version: '1.62.1' },
			'node_modules/playwright-core': { version: '1.62.1' }
		} })).toBe('1.62.1');
		expect(() => playwrightVersion({ packages: {
			'node_modules/@playwright/test': { version: '1.62.1' },
			'node_modules/playwright-core': { version: '1.61.0' }
		} })).toThrow('matching Playwright');
	});
	it('preserves spaces and shell syntax in grep arguments', () => {
		const pattern = 'Two words | $(touch /tmp/never-run)';
		expect(testCommand('e2e', ['--grep', pattern])).toEqual([
			'xvfb-run', '-a', 'npx', 'playwright', 'test', '--workers=2', '--grep', pattern
		]);
	});
	it('selects artifact producers only through the isolated diagnostics config', () => {
		expect(testCommand('diagnostics', ['record-omr-fixtures'])).toEqual([
			'xvfb-run', '-a', 'npx', 'playwright', 'test', '--config=playwright.diagnostics.config.ts', 'record-omr-fixtures'
		]);
		expect(testCommand('e2e', [])).not.toContain('--config=playwright.diagnostics.config.ts');
	});

	it('keeps headed tests in Xvfb and serves interactive UI without opening a desktop browser', () => {
		expect(testCommand('e2e', ['--headed'])).toContain('xvfb-run');
		expect(testCommand('ui', [])).toContain('--ui-host=0.0.0.0');
		expect(testCommand('ui', [])).not.toContain('--ui');
		expect(() => testCommand('e2e', ['--debug'])).toThrow('test:e2e:ui');
		expect(() => testCommand('e2e', ['--ui-host=0.0.0.0'])).toThrow();
	});
});
