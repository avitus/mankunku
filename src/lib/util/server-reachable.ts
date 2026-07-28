/**
 * Reachability probe for the nav-error recovery in hooks.client.ts: a
 * full-page recovery navigation while the server is down (deploy restart
 * gap) or the device is offline would eject the user from the running
 * local-first app onto a browser error page — probe first, and when
 * unreachable leave the app in place (the error boundary offers a manual
 * Reload). Any HTTP response, even an error status, proves reachability.
 *
 * The probe is BOUNDED: handleError awaits it, so a server that accepts the
 * connection but stalls without answering (the exact deploy-gap scenario
 * this guards) must abort rather than hang the error hook indefinitely.
 */
export const REACHABILITY_PROBE_TIMEOUT_MS = 5000;

export async function serverReachable(
	href: string,
	fetchFn: typeof fetch = fetch
): Promise<boolean> {
	if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
	try {
		await fetchFn(href, {
			method: 'HEAD',
			cache: 'no-store',
			signal: AbortSignal.timeout(REACHABILITY_PROBE_TIMEOUT_MS)
		});
		return true;
	} catch {
		return false;
	}
}
