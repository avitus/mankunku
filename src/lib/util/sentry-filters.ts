/**
 * Shared Sentry `beforeSend` predicates, kept pure so they can be unit-tested
 * away from `Sentry.init`. Used by both the client hook (hooks.client.ts) and
 * the server instrumentation (instrumentation.server.ts) so the two stay in
 * sync.
 */

/** Minimal shape of the fields these predicates read on a Sentry event. */
interface SentryLikeEvent {
	message?: string;
	exception?: {
		values?: Array<{
			type?: string;
			value?: string;
			stacktrace?: { frames?: unknown[] };
		}>;
	};
}

interface SentryLikeHint {
	originalException?: unknown;
}

/**
 * True when an event has no usable content — no message, no exception value, no
 * stack frames, and no original exception. These render as "<unknown>" /
 * "undefined" in Sentry and aren't actionable. See MANKUNKU-K (an empty
 * `Error: undefined` captured from an SSR load during `npm run preview`).
 */
export function isEmptyErrorEvent(event: SentryLikeEvent, hint: SentryLikeHint | undefined): boolean {
	const ex = event.exception?.values?.[0];
	const hasMessage = typeof event.message === 'string' && event.message.trim().length > 0;
	const hasExceptionValue = typeof ex?.value === 'string' && ex.value.trim().length > 0;
	const hasFrames = (ex?.stacktrace?.frames?.length ?? 0) > 0;
	return !hasMessage && !hasExceptionValue && !hasFrames && hint?.originalException == null;
}

/**
 * True for transient "X is not defined" ReferenceErrors. During `npm run dev`,
 * Svelte's HMR re-runs an effect against a momentarily-stale scope right after
 * an identifier is renamed/removed, throwing a ReferenceError that the page
 * recovers from on the next tick. Callers should gate this on the development
 * environment. See MANKUNKU-W (and the Q/S/T/V family): `awaitHydration is not
 * defined` thrown from +layout.svelte moments after the symbol was renamed.
 */
export function isTransientDevReferenceError(event: SentryLikeEvent): boolean {
	const ex = event.exception?.values?.[0];
	const value = typeof ex?.value === 'string' ? ex.value : '';
	return ex?.type === 'ReferenceError' && /is not defined/i.test(value);
}
