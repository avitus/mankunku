/**
 * Which routes may auto-trigger the onboarding overlay.
 *
 * Onboarding belongs only on the mic-driven practice surfaces, where the
 * instrument choice and mic permission actually matter. Everywhere else
 * (/, /docs, /licks, /tunes, /scales, community pages) must render clean for
 * a fresh profile: Googlebot both reads the SSR HTML and renders the page
 * with empty localStorage, so an unconditional overlay used to be the entire
 * visible content of every URL on the site.
 *
 * The prefix boundaries are load-bearing — `/licks/record` must trigger
 * while the browsable `/licks` must not — which is why this is a plain
 * module with a table-driven test rather than logic inline in the layout.
 */
export const ONBOARDING_ROUTE_PREFIXES = [
	'/ear-training',
	'/lick-practice',
	'/tricks',
	'/licks/record'
] as const;

/** Whole-segment prefix match: `/licks/record` matches `/licks/record/x`, never `/licks/recording`. */
function matchesRoutePrefix(pathname: string, prefix: string): boolean {
	return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isOnboardingRoute(pathname: string): boolean {
	return (
		ONBOARDING_ROUTE_PREFIXES.some((prefix: string): boolean =>
			matchesRoutePrefix(pathname, prefix)
		) ||
		// Tune practice is a scored mic surface too, but lives under the
		// otherwise-browsable /tunes tree, so it can't ride a prefix.
		/^\/tunes\/[^/]+\/practice(?:\/|$)/.test(pathname)
	);
}
