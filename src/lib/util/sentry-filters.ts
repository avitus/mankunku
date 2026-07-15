/**
 * Shared Sentry `beforeSend` predicates, kept pure so they can be unit-tested
 * away from `Sentry.init`. Used by both the client hook (hooks.client.ts) and
 * the server instrumentation (instrumentation.server.ts) so the two stay in
 * sync.
 */

/** Minimal shape of the fields this predicate reads on a Sentry event. */
interface SentryLikeEvent {
	message?: string;
	exception?: {
		values?: Array<{
			// `type` (e.g. "Error") is intentionally NOT read — see isEmptyErrorEvent.
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
 * True when an event has no usable content — no message, no exception value in
 * ANY `exception.values` entry, no stack frames, and no original exception.
 * These render as "<unknown>" / "undefined" in Sentry and aren't actionable.
 * See MANKUNKU-K (an empty `Error: undefined` captured from an SSR load during
 * `npm run preview`).
 *
 * Note: a bare exception `type` (e.g. "Error") does NOT count as content — the
 * MANKUNKU-K events carry a default `type` with an empty value, and since
 * essentially every exception event has a type, counting it would neuter this
 * filter entirely.
 */
export function isEmptyErrorEvent(event: SentryLikeEvent, hint: SentryLikeHint | undefined): boolean {
	const hasMessage = typeof event.message === 'string' && event.message.trim().length > 0;
	const hasExceptionContent = (event.exception?.values ?? []).some(
		(ex) =>
			(typeof ex.value === 'string' && ex.value.trim().length > 0) ||
			(ex.stacktrace?.frames?.length ?? 0) > 0
	);
	return !hasMessage && !hasExceptionContent && hint?.originalException == null;
}
