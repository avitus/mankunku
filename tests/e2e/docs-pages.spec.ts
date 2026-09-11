import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { DOC_TREE } from '../../src/lib/docs/structure';

/**
 * /docs/[...slug] — every page in DOC_TREE renders: the markdown's own `# `
 * heading as the article's h1, the tree's title in the breadcrumb, the tab
 * title and the sidebar's active link. The list is read from the tree itself
 * so a page added there is covered without touching this spec. A slug absent
 * from the tree is a 404.
 */

const DOCS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../documentation');

/** The first `# ` line of the doc's markdown — what the renderer engraves as h1. */
function markdownH1(slug: string): string {
	const md = readFileSync(resolve(DOCS_DIR, `${slug}.md`), 'utf8');
	const line = md.split('\n').find((l) => l.startsWith('# '));
	if (!line) throw new Error(`documentation/${slug}.md has no top-level heading`);
	return line.slice(2).trim();
}

const PAGES = DOC_TREE.flatMap((section) =>
	section.pages.map((page) => ({ ...page, section: section.title }))
);

test.describe('docs pages', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	for (const doc of PAGES) {
		test(`/docs/${doc.slug} renders "${doc.title}"`, async ({
			page,
			consoleCollector: _consoleCollector
		}) => {
			await page.goto(`/docs/${doc.slug}`);

			// Matched by accessible name: the renderer prefixes every heading
			// with an aria-hidden "#" anchor link, so textContent reads "#Title".
			const article = page.locator('article');
			await expect(article.getByRole('heading', { level: 1 })).toHaveCount(1);
			await expect(
				article.getByRole('heading', { level: 1, name: markdownH1(doc.slug), exact: true })
			).toBeVisible();

			await expect(page).toHaveTitle(`${doc.title} — Mankunku Docs`);
			const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
			await expect(crumbs).toContainText(doc.section);
			await expect(crumbs).toContainText(doc.title);

			// The sidebar opens the page's section and lists the page.
			const sidebar = page.getByRole('navigation', { name: 'Documentation' });
			await expect(sidebar.getByRole('link', { name: doc.title, exact: true })).toHaveAttribute(
				'href',
				`/docs/${doc.slug}`
			);
		});
	}

	test('a slug outside the tree is a 404', async ({ page }) => {
		// request.get rather than goto — see smoke.spec.ts: rendering a 404
		// document emits a "Failed to load resource" console line, and the
		// server status is all this case is about.
		for (const path of ['/docs/no-such-page', '/docs/architecture/no-such-page', '/docs/getting-started/extra']) {
			const response = await page.request.get(path, { maxRedirects: 0 });
			expect(response.status(), `${path} should 404`).toBe(404);
		}
	});
});
