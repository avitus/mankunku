import { renderMarkdown } from '$lib/docs/markdown';
import { error } from '@sveltejs/kit';
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
 * tree (`DOC_TREE`) or its bundled markdown file is missing, otherwise returns
 * the page metadata, the raw markdown, the rendered HTML and the breadcrumbs.
 */
export const load: PageServerLoad = async ({ params }) => {
	const slug = params.slug;
	const meta = getPage(slug);
	if (!meta) {
		error(404, `No documentation page at /${slug}`);
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
