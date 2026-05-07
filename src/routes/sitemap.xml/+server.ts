import { ALL_PAGES } from '$lib/docs/structure';

const SITE = 'https://mankunkujazz.com';

const TOP_LEVEL_ROUTES: { path: string; priority: string; changefreq: string }[] = [
	{ path: '/', priority: '1.0', changefreq: 'weekly' },
	{ path: '/ear-training', priority: '0.9', changefreq: 'weekly' },
	{ path: '/lick-practice', priority: '0.9', changefreq: 'weekly' },
	{ path: '/library', priority: '0.8', changefreq: 'weekly' },
	{ path: '/docs', priority: '0.8', changefreq: 'monthly' },
	{ path: '/scales', priority: '0.7', changefreq: 'monthly' },
	{ path: '/community', priority: '0.6', changefreq: 'weekly' }
];

export const prerender = true;

export function GET() {
	const lastmod = new Date().toISOString().slice(0, 10);

	const urls = [
		...TOP_LEVEL_ROUTES.map(
			(r) =>
				`	<url>\n		<loc>${SITE}${r.path}</loc>\n		<lastmod>${lastmod}</lastmod>\n		<changefreq>${r.changefreq}</changefreq>\n		<priority>${r.priority}</priority>\n	</url>`
		),
		...ALL_PAGES.map(
			(p) =>
				`	<url>\n		<loc>${SITE}/docs/${p.slug}</loc>\n		<lastmod>${lastmod}</lastmod>\n		<changefreq>monthly</changefreq>\n		<priority>0.5</priority>\n	</url>`
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
