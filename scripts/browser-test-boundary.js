import { existsSync } from 'node:fs';

/**
 * Refuse accidental browser automation on a developer's desktop, even headless.
 * @param {{platform?: string, env?: NodeJS.ProcessEnv, container?: boolean}} [options]
 */
export function assertBrowserTestIsolation({ platform = process.platform, env = process.env,
	container = existsSync('/.dockerenv') } = {}) {
	if (platform === 'linux' && (container || env.CIRCLECI === 'true')) return;
	throw new Error('Browser tests must run in a Linux sandbox. Use npm run test:e2e (or test:e2e:ui). Direct host Playwright execution is disabled.');
}
