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
		breadcrumbs: getBreadcrumbs(slug)
	};
};
