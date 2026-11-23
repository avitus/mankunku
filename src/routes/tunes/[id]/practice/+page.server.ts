import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Open bookmarked practice sessions on the unified tune page. */
export const load: PageServerLoad = ({ params, url }) => {
	const search = new URLSearchParams(url.searchParams);
	search.set('licks', '1');
	redirect(307, `/tunes/${encodeURIComponent(params.id)}?${search}`);
};
