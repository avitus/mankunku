/**
 * Every in-app link into the docs must land somewhere. A `/docs/<slug>` whose
 * slug is not in `DOC_TREE` renders the docs route's 404, and a `#<anchor>`
 * that no heading carries leaves the reader at the top of a long page — and
 * neither failure is visible from the docs side, only from the code that
 * links in (help icons, tooltip "learn more" links, the assistant's prompt).
 *
 * Anchors are checked against the ids the docs renderer itself puts on the
 * page's headings (`renderMarkdown` → `<hN id="…">`, which the docs route
 * scrolls to with `getElementById`), never a re-implementation of its slug
 * rule.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_PAGES } from '$lib/docs/structure';
import { renderMarkdown } from '$lib/docs/markdown';

const SRC = fileURLToPath(new URL('../../../src', import.meta.url));
const DOCS = fileURLToPath(new URL('../../../documentation', import.meta.url));

interface DocLink {
	slug: string;
	anchor?: string;
	/** 1-based line of the literal in its source. */
	line: number;
}

/**
 * `/docs/<slug>` and `/docs/<slug>#<anchor>` string literals. The path must
 * be a whole quoted literal (single, double or backtick quotes): a URL that
 * merely contains "/docs/" (https://svelte.dev/docs/…) is external, and an
 * interpolated path (`/docs/${slug}`, Svelte's "/docs/{doc.slug}") is built
 * from a value this scan cannot see. Placeholders in doc comments
 * (`/docs/<dir>/foo`, `/docs/...`, `/docs/[...slug]`) are skipped by their
 * markers; any other path is treated as a link and checked.
 */
function extractDocLinks(source: string): DocLink[] {
	const links: DocLink[] = [];
	for (const m of source.matchAll(/(["'`])\/docs\/([^"'`\s]*)\1/g)) {
		const path = m[2];
		if (path === '' || /[{$<[]|\.\.\./.test(path)) continue;
		const [slug, anchor] = path.split('#', 2);
		const line = source.slice(0, m.index).split('\n').length;
		links.push(anchor === undefined ? { slug, line } : { slug, anchor, line });
	}
	return links;
}

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) walk(path, out);
		else if (/\.(svelte|ts)$/.test(entry)) out.push(path);
	}
	return out;
}

const LINKS = walk(SRC).flatMap((file) =>
	extractDocLinks(readFileSync(file, 'utf8')).map((link) => ({
		...link,
		where: `src/${relative(SRC, file)}:${link.line}`
	}))
);

const PAGES = new Set(ALL_PAGES.map((p) => p.slug));

const headingIds = new Map<string, Set<string>>();
/** The ids the docs renderer gives the headings of `slug`'s page. */
function headingIdsFor(slug: string): Set<string> {
	let ids = headingIds.get(slug);
	if (!ids) {
		const { html } = renderMarkdown(readFileSync(join(DOCS, `${slug}.md`), 'utf8'), slug);
		ids = new Set([...html.matchAll(/<h[1-6][^>]*\sid="([^"]+)"/g)].map((m) => m[1]));
		headingIds.set(slug, ids);
	}
	return ids;
}

describe('doc link extraction', () => {
	it('takes whole quoted /docs/ literals and skips external, interpolated and placeholder paths', () => {
		const source = [
			`<HelpLink href="/docs/tunes" label="Tunes docs" />`,
			`learnMore: '/docs/user-guide#progress',`,
			'const a = `/docs/architecture/overview`;',
			'const b = `/docs/${slug}`;',
			`<a href="/docs/{doc.slug}">`,
			`// See https://svelte.dev/docs/kit/types#app.d.ts`,
			`const prefix = '/docs/';`,
			`- When pointing to a doc, format links as [page title](/docs/...).`,
			' * links like `./foo.md` to `/docs/<dir>/foo`, the route under `/docs/[...slug]`, `/docs/...`',
			`const stale = '/docs/user-guide.md';`
		].join('\n');
		expect(extractDocLinks(source)).toEqual([
			{ slug: 'tunes', line: 1 },
			{ slug: 'user-guide', anchor: 'progress', line: 2 },
			{ slug: 'architecture/overview', line: 3 },
			// Not a placeholder, so it is checked — and would fail: no such slug.
			{ slug: 'user-guide.md', line: 10 }
		]);
	});

	it('finds the app\'s doc links, anchored ones included', () => {
		// Guards the sweep below against passing vacuously on a broken scan.
		expect(LINKS.length).toBeGreaterThan(10);
		expect(LINKS.some((l) => l.anchor !== undefined)).toBe(true);
	});
});

describe('in-app doc links resolve', () => {
	it.each(LINKS.map((l) => [`${l.where} → /docs/${l.slug}${l.anchor ? `#${l.anchor}` : ''}`, l] as const))(
		'%s',
		(_name, link) => {
			expect(PAGES.has(link.slug), `${link.where}: /docs/${link.slug} is not in DOC_TREE`).toBe(true);
			if (link.anchor === undefined) return;
			const ids = headingIdsFor(link.slug);
			expect(
				ids.has(link.anchor),
				`${link.where}: no heading in documentation/${link.slug}.md renders id="${link.anchor}" ` +
					`(headings: ${[...ids].join(', ')})`
			).toBe(true);
		}
	);
});
