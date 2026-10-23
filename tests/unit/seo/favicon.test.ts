/**
 * Browsers and bots request /favicon.ico unconditionally, whatever the
 * document's `<link rel="icon">` says. Without the route that request 404s,
 * which is noise in the dev terminal and in Sentry. The route redirects to the
 * SVG icon shipped in /static, so the target must exist there too.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isRedirect } from '@sveltejs/kit';
import { GET } from '../../../src/routes/favicon.ico/+server';

describe('/favicon.ico', () => {
	it('redirects (307) to the shipped /favicon.svg', () => {
		let thrown: unknown;
		try {
			GET({} as Parameters<typeof GET>[0]);
		} catch (e) {
			thrown = e;
		}
		expect(isRedirect(thrown)).toBe(true);
		expect(thrown).toMatchObject({ status: 307, location: '/favicon.svg' });
		expect(existsSync(fileURLToPath(new URL('../../../static/favicon.svg', import.meta.url)))).toBe(
			true
		);
	});
});
