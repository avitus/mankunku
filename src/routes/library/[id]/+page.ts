import { isBrowser } from '@supabase/ssr';
import { awaitHydration } from '$lib/state/hydration';
import type { PageLoad } from './$types';

/**
 * The lick detail page reads practice-tag / progression / category metadata
 * once at mount. For curated licks (stable identity, no async user-lick fetch
 * to self-heal on) that would show pre-cloud state under the root layout's
 * background hydration. Opt into a bounded wait so a cold load straight to a
 * lick page sees hydrated metadata.
 *
 * Warm navigation from the library list is unaffected: by then
 * `awaitHydration()` is already resolved, so this is a microtask.
 */
export const load: PageLoad = async ({ parent }) => {
	await parent();
	if (isBrowser()) await awaitHydration();
	return {};
};
