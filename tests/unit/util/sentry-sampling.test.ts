/**
 * The browser's Sentry init lives in `src/hooks.client.ts`, which runs SvelteKit
 * client wiring at module load and cannot be imported in Node, so its trace
 * rate is pinned here by source. 2026-11-05: both sides traced every request
 * (1.0), the organisation's span quota ran out on 2026-10-24, and ingest then
 * refused every trace while the tunnel logged 100–170 502s a day.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TRACES_SAMPLE_RATE } from '../../../src/lib/util/sentry-sampling';

describe('Sentry trace sampling', () => {
	it('samples a fraction of traces, not every one', () => {
		expect(TRACES_SAMPLE_RATE).toBeGreaterThan(0);
		expect(TRACES_SAMPLE_RATE).toBeLessThanOrEqual(0.1);
	});

	it('is the rate the browser init uses', () => {
		const source = readFileSync(resolve(__dirname, '../../../src/hooks.client.ts'), 'utf8');
		const rates = [...source.matchAll(/tracesSampleRate:\s*([^,\n]+)/g)].map((m) => m[1].trim());
		expect(rates).toEqual(['TRACES_SAMPLE_RATE']);
	});
});
