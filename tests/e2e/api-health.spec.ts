import { test, expect } from './fixtures/test';

/**
 * /api/health — the unauthenticated liveness + identity endpoint release.sh
 * and the deploy job's public verification read. It must answer without
 * auth, without caching, and with the identity fields they compare.
 */

test.describe('/api/health', () => {
	test('answers 200 with the running process identity, uncached', async ({ page }) => {
		const response = await page.request.get('/api/health');
		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toContain('application/json');
		expect(response.headers()['cache-control']).toBe('no-store');

		const body = (await response.json()) as Record<string, unknown>;
		expect(body.status).toBe('ok');
		expect(typeof body.version).toBe('string');
		expect((body.version as string).length).toBeGreaterThan(0);
		expect(body.node).toMatch(/^v\d+\.\d+\.\d+$/);
		expect(typeof body.uptimeSeconds).toBe('number');
		expect(body.uptimeSeconds as number).toBeGreaterThanOrEqual(0);
		expect(Number.isInteger(body.uptimeSeconds)).toBe(true);
		// A dev/preview process runs from no release directory; a deployed one
		// reports the CI-shaped id. Either way the field is present.
		expect(body.releaseId === null || /^\d{8}-\d{6}-[0-9a-f]{7}$/.test(body.releaseId as string)).toBe(true);
		expect(Number.isNaN(Date.parse(body.startedAt as string))).toBe(false);
	});
});
