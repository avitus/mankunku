import { renderMarkdown } from '$lib/docs/markdown';
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getPage, getBreadcrumbs } from '$lib/docs/structure';

// Bundle every documentation/*.md into the build at compile time. Reading from
// process.cwd() at runtime fails in production because the deploy ships only
// build/ + package files (see .circleci/continue-config.yml), not the
// documentation/ tree. See Sentry MANKUNKU-N.
const DOC_FILES = import.meta.glob<string>('/documentation/**/*.md', {
	query: '?raw',
	import: 'default',
	eager: true
});

/**
 * Serves one documentation page: 404s when the slug is absent from the docs
 * tree (`DOC_TREE`) or its bundled markdown file is missing, forwards an entry
 * that lives on a page of its own (`href`) to that page, otherwise returns
 * the page metadata, the raw markdown, the rendered HTML and the breadcrumbs.
 */
export const load: PageServerLoad = async ({ params }) => {
	const slug = params.slug;
	const meta = getPage(slug);
	if (!meta) {
		error(404, `No documentation page at /${slug}`);
	}
	// An entry with its own page is a link in the tree, not an article here.
	// The musicality spec rendered as one crashed on hydration: it repeats its
	// section headings (Piano, Bass, Drums, Ensemble) and the contents list is
	// keyed by heading slug (main's first hosted e2e run, 2026-11-12).
	if (meta.href) {
		redirect(308, meta.href);
	}

	const markdown = DOC_FILES[`/documentation/${slug}.md`];
	if (markdown === undefined) {
		error(404, `Documentation file missing: ${slug}.md`);
	}

	return {
		slug,
		page: meta,
		markdown,
		rendered: renderMarkdown(markdown, slug),
		breadcrumbs: getBreadcrumbs(slug)
	};
};
