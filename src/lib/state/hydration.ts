/**
 * Shared handle to the root layout's background cloud-hydration promise.
 *
 * `src/routes/+layout.ts` kicks off cloud hydration FIRE-AND-FORGET so the page
 * mounts immediately on local-first state and cloud data overlays reactively as
 * each init resolves. Most routes read that state reactively and need nothing
 * here. But a few routes snapshot hydrated state ONCE at mount — e.g.
 * /ear-training pins the daily key, tempo, and lick roster for the session —
 * and would otherwise capture pre-cloud localStorage on a cold load straight to
 * that route. Those opt back into a bounded wait via `awaitHydration()` from
 * their own `+layout.ts` / `+page.ts` load.
 *
 * The promise defaults to already-resolved, so anonymous / offline / SSR loads
 * (which never call `setHydrationPromise`) never block.
 */

let hydrationPromise: Promise<void> = Promise.resolve();

/**
 * Register the background hydration promise. Called once per authed browser
 * load from `+layout.ts`. Rejections are swallowed here so awaiters never throw
 * and no unhandled rejection escapes — hydration is best-effort and local state
 * is always the fallback.
 */
export function setHydrationPromise(p: Promise<void>): void {
	hydrationPromise = p.catch(() => {});
}

/** The current hydration promise (resolved by default; never rejects). */
export function whenHydrated(): Promise<void> {
	return hydrationPromise;
}

/**
 * Wait for cloud hydration, but no longer than `timeoutMs`. Slow / offline
 * connections degrade to acting on local state instead of hanging the route —
 * this preserves the 2s ceiling the root layout used before it went
 * fire-and-forget.
 */
export function awaitHydration(timeoutMs = 2000): Promise<void> {
	return Promise.race([
		hydrationPromise,
		new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
	]);
}
