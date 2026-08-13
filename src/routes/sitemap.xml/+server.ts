import { ALL_PAGES } from '$lib/docs/structure';

const SITE = 'https://mankunkujazz.com';

// Docs pages outrank the app surfaces here on purpose: for a crawler (fresh
// profile, no local data) the practice routes render as near-empty shells,
// while /docs/** is real server-rendered prose — the site's indexable content.
const TOP_LEVEL_ROUTES: { path: string; priority: string; changefreq: string }[] = [
	{ path: '/', priority: '1.0', changefreq: 'weekly' },
	{ path: '/docs', priority: '0.9', changefreq: 'monthly' },
	{ path: '/ear-training', priority: '0.6', changefreq: 'monthly' },
	{ path: '/lick-practice', priority: '0.6', changefreq: 'monthly' },
	{ path: '/tricks', priority: '0.6', changefreq: 'monthly' },
	{ path: '/licks', priority: '0.5', changefreq: 'monthly' },
	{ path: '/tunes', priority: '0.5', changefreq: 'monthly' },
	{ path: '/scales', priority: '0.5', changefreq: 'monthly' },
	{ path: '/licks/community', priority: '0.5', changefreq: 'weekly' },
	{ path: '/tunes/community', priority: '0.5', changefreq: 'weekly' }
];

export const prerender = true;

function escapeXml(unsafe: string): string {
	return unsafe
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

export function GET(): Response {
	// No <lastmod>: this route is prerendered, so a build-time date would
	// claim every URL changed on every deploy — a signal crawlers learn to
	// distrust. Omitting it is valid; priorities/changefreq carry the hints.
	const urls = [
		...TOP_LEVEL_ROUTES.map(
			(r) =>
				`	<url>\n		<loc>${escapeXml(`${SITE}${r.path}`)}</loc>\n		<changefreq>${r.changefreq}</changefreq>\n		<priority>${r.priority}</priority>\n	</url>`
		),
		...ALL_PAGES.map(
			(p) =>
				`	<url>\n		<loc>${escapeXml(`${SITE}/docs/${p.slug}`)}</loc>\n		<changefreq>monthly</changefreq>\n		<priority>0.8</priority>\n	</url>`
		)
	].join('\n');

	const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

	return new Response(body, {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			'cache-control': 'public, max-age=3600'
		}
	});
}
