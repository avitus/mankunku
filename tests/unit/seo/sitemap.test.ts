/**
 * The sitemap is the crawler's map of the site, and its priorities encode a
 * deliberate choice: /docs/** is the real indexable content (server-rendered
 * prose), while the practice routes render as near-empty shells for a fresh
 * profile. These tests pin that ordering and the absence of <lastmod> — a
 * prerendered build-time date would falsely claim every URL changed on every
 * deploy.
 */
import { describe, it, expect } from 'vitest';
import { GET, _escapeXml as escapeXml } from '../../../src/routes/sitemap.xml/+server';
import { ALL_PAGES } from '$lib/docs/structure';

async function sitemapBody(): Promise<string> {
	return await GET().text();
}

function urlBlock(body: string, loc: string): string {
	const blocks = body.split('<url>');
	const match = blocks.find((b) => b.includes(`<loc>${loc}</loc>`));
	if (!match) throw new Error(`No sitemap entry for ${loc}`);
	return match;
}

describe('sitemap.xml', () => {
	it('lists every docs page at priority 0.8', async () => {
		const body = await sitemapBody();
		for (const page of ALL_PAGES) {
			const block = urlBlock(body, `https://mankunkujazz.com/docs/${page.slug}`);
			expect(block, page.slug).toContain('<priority>0.8</priority>');
		}
	});

	it('keeps the home page at 1.0 and /docs above every app surface', async () => {
		const body = await sitemapBody();
		expect(urlBlock(body, 'https://mankunkujazz.com/')).toContain('<priority>1.0</priority>');
		expect(urlBlock(body, 'https://mankunkujazz.com/docs')).toContain('<priority>0.9</priority>');
		for (const shell of ['/ear-training', '/lick-practice', '/licks', '/scales']) {
			const block = urlBlock(body, `https://mankunkujazz.com${shell}`);
			const priority = Number(block.match(/<priority>([\d.]+)<\/priority>/)?.[1]);
			expect(priority, shell).toBeLessThan(0.8);
		}
	});

	it('includes the routes added for discovery', async () => {
		const body = await sitemapBody();
		for (const path of ['/tricks', '/tunes']) {
			expect(body).toContain(`<loc>https://mankunkujazz.com${path}</loc>`);
		}
	});

	it('excludes the session-gated community routes', async () => {
		// Anonymous renders of these are a sign-in prompt (and emit noindex);
		// pointing crawlers at them would advertise soft-404s.
		const body = await sitemapBody();
		expect(body).not.toContain('/licks/community');
		expect(body).not.toContain('/tunes/community');
	});

	it('emits no lastmod', async () => {
		const body = await sitemapBody();
		expect(body).not.toContain('<lastmod>');
	});

	it('escapeXml covers the five XML metacharacters', () => {
		// No current slug needs escaping, so the sitemap body can't exercise
		// this — a future docs slug with an ampersand would otherwise emit
		// invalid XML undetected.
		expect(escapeXml(`bebop & "blues" <all> of 'em`)).toBe(
			'bebop &amp; &quot;blues&quot; &lt;all&gt; of &apos;em'
		);
	});
});
