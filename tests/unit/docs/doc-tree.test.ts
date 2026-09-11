/**
 * The docs tree is one of the four surfaces documentation lives on (the
 * markdown files, `DOC_TREE`, the assistant's bundled context, and tour
 * copy). A slug listed here with no markdown file behind it renders a 404
 * from the docs route AND an empty page context for the assistant — and
 * neither failure is visible from the docs side, only from the code.
 *
 * `getDocContext` bundles the core docs at build time; when it read from
 * `process.cwd()` at runtime the deploy (which ships only build/) left it
 * EMPTY in production and the assistant answered everything as "not
 * documented" (Sentry MANKUNKU-N). The bundling is pinned here by checking
 * the context is non-empty in a plain module load.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALL_PAGES, DOC_TREE, getBreadcrumbs, getPage, getSectionFor } from '$lib/docs/structure';
import { getDocContext, getPageContext } from '$lib/docs/context';

const docFile = (slug: string): string =>
	fileURLToPath(new URL(`../../../documentation/${slug}.md`, import.meta.url));

describe('DOC_TREE', () => {
	it('lists every page slug exactly once', () => {
		const slugs = ALL_PAGES.map((p) => p.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
		expect(slugs.length).toBe(DOC_TREE.reduce((n, s) => n + s.pages.length, 0));
	});

	it.each(ALL_PAGES.map((p) => [p.slug] as const))('%s has a markdown file behind it', (slug) => {
		expect(existsSync(docFile(slug)), `documentation/${slug}.md`).toBe(true);
	});

	it('resolves a page and its section by slug, and nothing for an unknown slug', () => {
		expect(getPage('architecture/scoring-algorithm')?.title).toBe('How Scoring Works');
		expect(getSectionFor('architecture/scoring-algorithm')?.title).toBe('How It Works');
		expect(getPage('architecture/api-reference')).toBeUndefined();
		expect(getSectionFor('architecture/api-reference')).toBeUndefined();
	});

	it('builds Docs › Section › Page breadcrumbs with a section anchor', () => {
		expect(getBreadcrumbs('reference/glossary')).toEqual([
			{ label: 'Docs', href: '/docs' },
			{ label: 'Reference', href: '/docs#reference' },
			{ label: 'Glossary', href: '/docs/reference/glossary' }
		]);
		// A multi-word section title becomes a dashed anchor.
		expect(getBreadcrumbs('getting-started')[1]).toEqual({ label: 'First Steps', href: '/docs#first-steps' });
		// An unknown slug degrades to the root crumb rather than throwing.
		expect(getBreadcrumbs('nope')).toEqual([{ label: 'Docs', href: '/docs' }]);
	});
});

describe('assistant doc context', () => {
	it('bundles the core docs into the system context, each tagged with its slug and URL', async () => {
		const context = await getDocContext();
		expect(context.length).toBeGreaterThan(1000);
		// The docs whose vocabulary appears nowhere else in the core set — the
		// ones the module comment says earn their place.
		for (const slug of ['user-guide', 'tricks', 'tunes', 'tune-practice', 'reference/glossary']) {
			expect(context, slug).toContain(`<doc slug="${slug}" url="/docs/${slug}">`);
		}
		// Every bundled slug is a real page: an unlisted slug would be cited
		// by URL and 404.
		const bundled = [...context.matchAll(/<doc slug="([^"]+)"/g)].map((m) => m[1]);
		const pages = new Set(ALL_PAGES.map((p) => p.slug));
		for (const slug of bundled) expect(pages.has(slug), slug).toBe(true);
		// Memoised: the second call is the same string, not a rebuild.
		expect(await getDocContext()).toBe(context);
	});

	it('prefixes the page context with the page title and URL, and is empty off the tree', async () => {
		const context = await getPageContext('user-guide');
		expect(context.startsWith('The user is currently viewing /docs/user-guide ("How to Practice").\n\n')).toBe(true);
		expect(context.length).toBeGreaterThan(200);
		expect(await getPageContext(undefined)).toBe('');
		expect(await getPageContext('')).toBe('');
		expect(await getPageContext('architecture/api-reference')).toBe('');
	});
});
