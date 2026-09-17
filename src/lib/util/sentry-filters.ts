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
			// `type` (e.g. "Error") is intentionally NOT read — see isEmptyErrorEvent.
			type?: string;
			value?: string;
			stacktrace?: { frames?: unknown[] };
			mechanism?: { type?: string };
		}>;
	};
	request?: { url?: string };
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

/**
 * True for a hostname that only ever names this machine — where `vite dev`,
 * `vite preview` and Playwright's web server listen. `[::1]` is how both
 * `location.hostname` and `URL#hostname` spell the IPv6 loopback.
 */
export function isLocalHostname(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * True when the event describes a request a local server received. The server
 * can't tag its environment from `NODE_ENV` alone: `vite preview` runs the
 * production build with NODE_ENV=production, so a PDF import on a dev machine
 * filed its Anthropic errors under production (MANKUNKU-1V) — the server-side
 * twin of the client's hostname check (MANKUNKU-K).
 */
export function isLocalRequestEvent(event: SentryLikeEvent): boolean {
	const url = event.request?.url;
	if (typeof url !== 'string') return false;
	try {
		return isLocalHostname(new URL(url).hostname);
	} catch {
		return false;
	}
}

/**
 * True for the Anthropic API's "Output blocked by content filtering policy",
 * as Sentry's Anthropic integration captures it. The integration reports every
 * API error as unhandled before the app's own `catch` runs, but this one is a
 * model-policy outcome both callers already handle — /api/tune-parse retries
 * on the baseline model (Fable's filter blocks some well-known tunes) and
 * /api/chat shows the reader the error (MANKUNKU-1V). Every other API error
 * stays reported: a bad key or exhausted credit is an outage.
 */
export function isAnthropicContentFilterBlock(event: SentryLikeEvent): boolean {
	return (event.exception?.values ?? []).some(
		(ex) =>
			typeof ex.mechanism?.type === 'string' &&
			ex.mechanism.type.startsWith('auto.ai.anthropic') &&
			typeof ex.value === 'string' &&
			ex.value.includes('Output blocked by content filtering policy')
	);
}
