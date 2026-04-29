import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PageServerLoad } from './$types';
import { getPage, getBreadcrumbs } from '$lib/docs/structure';

/**
 * Read a single doc file from /documentation/{slug}.md and return its raw
 * markdown plus structural metadata. The renderer runs in the page component
 * so streaming and reactivity work the same on client and server.
 */
export const load: PageServerLoad = async ({ params }) => {
	const slug = params.slug;
	const meta = getPage(slug);
	if (!meta) {
		throw error(404, `No documentation page at /${slug}`);
	}

	// Project root is the working directory; documentation sits beside src/.
	const filePath = path.resolve(process.cwd(), 'documentation', `${slug}.md`);

	let markdown: string;
	try {
		markdown = await readFile(filePath, 'utf-8');
	} catch (err) {
		console.warn(`Failed to load doc at ${filePath}:`, err);
		throw error(404, `Documentation file missing: ${slug}.md`);
	}

	return {
		slug,
		page: meta,
		markdown,
		breadcrumbs: getBreadcrumbs(slug)
	};
};
