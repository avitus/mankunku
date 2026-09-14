/**
 * The server-verified auth verdict, handed from hooks.server.ts to the client's
 * `init` hook through the page head.
 *
 * Why it exists: `reconcileActiveUser` (user-scope.ts) may re-home the storage
 * namespace and reload, and that decision has to be made BEFORE SvelteKit starts
 * hydrating — a reload issued from a route node's `load` aborts the other node
 * imports hydration has in flight, and SvelteKit's error path then runs during
 * teardown (Firefox/WebKit page errors, a recovery probe, a Sentry event per
 * re-home). The client `init` hook runs before any node import, but it takes no
 * arguments, and the SSR data payload lives in the bootstrap script's closure,
 * out of its reach. So the server writes the verdict into one `<meta>`.
 *
 * The meta carries ONLY the user id and the degraded flag — the same two values
 * the root layout already serializes into the page (so it exposes nothing new),
 * and nothing else from the session. The uid is escaped as untrusted text on the
 * way in and type-checked on the way out; anything malformed reads as "no
 * verdict", which leaves the reconcile to the root layout's load.
 */

/** What `init` needs to reconcile: the same inputs `+layout.ts` passes to `reconcileActiveUser`. */
export interface AuthVerdict {
	/** The server-verified user id, or null when no user was verified. */
	uid: string | null;
	/** True when verification was UNAVAILABLE (auth outage) rather than negative. */
	degraded: boolean;
}

/** `name` of the `<meta>` element that carries the verdict. */
export const AUTH_VERDICT_META_NAME = 'mankunku-auth';

const ATTRIBUTE_ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'"': '&quot;',
	"'": '&#39;',
	'<': '&lt;',
	'>': '&gt;'
};

/** Escape text for a double-quoted HTML attribute value. */
function escapeAttribute(value: string): string {
	return value.replace(/[&"'<>]/g, (ch) => ATTRIBUTE_ESCAPES[ch]);
}

/**
 * The `<meta>` element for a verdict. Serializes exactly `uid` and `degraded`
 * (never the object as given, so a wider object can't leak fields into the page).
 *
 * @param verdict - the server-verified verdict for this request
 * @returns the element's HTML, with its content attribute-escaped
 */
export function authVerdictMetaTag(verdict: AuthVerdict): string {
	const content = JSON.stringify({ uid: verdict.uid, degraded: verdict.degraded });
	return `<meta name="${AUTH_VERDICT_META_NAME}" content="${escapeAttribute(content)}">`;
}

/**
 * Insert the verdict `<meta>` just before the first `</head>` of a rendered page
 * chunk. Chunks without a `</head>` (the streamed tail of a page) pass through
 * untouched, so the element is written once per page.
 *
 * @param html - one chunk of the rendered page
 * @param verdict - the server-verified verdict for this request
 * @returns the chunk with the element inserted, or unchanged
 */
export function injectAuthVerdict(html: string, verdict: AuthVerdict): string {
	const at = html.indexOf('</head>');
	if (at < 0) return html;
	return html.slice(0, at) + authVerdictMetaTag(verdict) + html.slice(at);
}

/**
 * Parse a verdict `<meta>`'s (already entity-decoded) content. Returns null for
 * anything that is not exactly the shape the server writes: a JSON object whose
 * `degraded` is a boolean and whose `uid` is null or a non-empty string.
 *
 * @param content - the element's `content` attribute, as the DOM returns it
 * @returns the verdict, or null when absent or malformed
 */
export function parseAuthVerdict(content: string | null | undefined): AuthVerdict | null {
	if (typeof content !== 'string') return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
	const { uid, degraded } = parsed as Record<string, unknown>;
	if (typeof degraded !== 'boolean') return null;
	if (uid === null) return { uid: null, degraded };
	if (typeof uid === 'string' && uid.length > 0) return { uid, degraded };
	return null;
}

/** The slice of `Document` the reader touches — structural, so tests can pass a stub. */
export interface AuthVerdictSource {
	head: {
		querySelector(selectors: string): { getAttribute(name: string): string | null } | null;
	} | null;
}

/**
 * Read the verdict the server wrote into this page's head. Looks in `<head>`
 * only — page content can never supply it.
 *
 * @param doc - the page's document
 * @returns the verdict, or null when the page carries none (or a malformed one)
 */
export function readAuthVerdict(doc: AuthVerdictSource): AuthVerdict | null {
	const meta = doc.head?.querySelector(`meta[name="${AUTH_VERDICT_META_NAME}"]`) ?? null;
	return parseAuthVerdict(meta?.getAttribute('content'));
}
