import { describe, expect, it } from 'vitest';
import { assertBrowserTestIsolation } from '../../../scripts/browser-test-boundary.js';
import { includeInSnapshot, playwrightVersion, testCommand } from '../../../scripts/test-sandbox.mjs';

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

describe('Test sandbox snapshot and invocation', () => {
	it.each(['.env', '.env.test', '.env.sentry-build-plugin', 'nested/.env.local', '.git/config',
		'.claude/worktrees/another/src/main.ts', '.chunk/config.json', 'node_modules/vitest/run.js',
		'tests/e2e/.auth/user.json', 'supabase/.temp/password', 'test-results/report.json',
		'build/index.js', '.svelte-kit/output/server.js', 'playwright-report/index.html', 'private.pem'])
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
	it('keeps headed tests in Xvfb and serves interactive UI without opening a desktop browser', () => {
		expect(testCommand('e2e', ['--headed'])).toContain('xvfb-run');
		expect(testCommand('ui', [])).toContain('--ui-host=0.0.0.0');
		expect(testCommand('ui', [])).not.toContain('--ui');
		expect(() => testCommand('e2e', ['--debug'])).toThrow('test:e2e:ui');
		expect(() => testCommand('e2e', ['--ui-host=0.0.0.0'])).toThrow();
	});
});
