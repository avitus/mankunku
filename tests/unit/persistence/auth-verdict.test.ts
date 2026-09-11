/**
 * The auth-verdict markup contract (src/lib/persistence/auth-verdict.ts): the
 * server writes the verified uid + degraded flag into one `<meta>` in the page
 * head, and hooks.client.ts `init` reads it back to re-home the storage
 * namespace before hydration starts.
 *
 * What is load-bearing here: the uid is untrusted text on the way in (escaped
 * so it can never break out of the attribute), nothing but uid + degraded is
 * ever written, the element lands in the head exactly once per page, and the
 * reader turns anything malformed into "no verdict" (which leaves the reconcile
 * to the root layout load) rather than a wrong one.
 */
import { describe, it, expect } from 'vitest';
import {
	AUTH_VERDICT_META_NAME,
	authVerdictMetaTag,
	injectAuthVerdict,
	parseAuthVerdict,
	readAuthVerdict,
	type AuthVerdict,
	type AuthVerdictSource
} from '$lib/persistence/auth-verdict';

/**
 * What an HTML parser does to the attribute value for the character references
 * the writer emits — `&amp;` last, so an escaped ampersand can't be re-read as
 * the start of another reference.
 */
function decodeAttribute(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

/** The content attribute of the (single) verdict meta in `html`, entity-decoded. */
function contentOf(html: string): string | null {
	const tags = html.match(new RegExp(`<meta name="${AUTH_VERDICT_META_NAME}" content="[^"]*">`, 'g')) ?? [];
	expect(tags).toHaveLength(1);
	const raw = tags[0]?.match(/content="([^"]*)"/)?.[1] ?? '';
	return decodeAttribute(raw);
}

/** A Document stand-in whose head holds one verdict meta with `content` (or none). */
function docWith(content: string | null | undefined): AuthVerdictSource & { selectors: string[] } {
	const selectors: string[] = [];
	return {
		selectors,
		head: {
			querySelector(selector: string) {
				selectors.push(selector);
				if (content === undefined) return null;
				return { getAttribute: (name: string) => (name === 'content' ? content : null) };
			}
		}
	};
}

const PAGE =
	'<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body><p>x</p></body></html>';

describe('authVerdictMetaTag', () => {
	it('writes the uid and the degraded flag as attribute-escaped JSON', () => {
		expect(authVerdictMetaTag({ uid: 'u-1', degraded: false })).toBe(
			'<meta name="mankunku-auth" content="{&quot;uid&quot;:&quot;u-1&quot;,&quot;degraded&quot;:false}">'
		);
		expect(authVerdictMetaTag({ uid: null, degraded: true })).toBe(
			'<meta name="mankunku-auth" content="{&quot;uid&quot;:null,&quot;degraded&quot;:true}">'
		);
	});

	it('serializes ONLY uid and degraded, even from a wider object', () => {
		const wide = {
			uid: 'u-1',
			degraded: false,
			email: 'alice@example.com',
			access_token: 'secret-token'
		} as AuthVerdict;
		const tag = authVerdictMetaTag(wide);
		expect(tag).not.toContain('alice');
		expect(tag).not.toContain('secret');
		expect(JSON.parse(decodeAttribute(tag.match(/content="([^"]*)"/)![1]))).toEqual({
			uid: 'u-1',
			degraded: false
		});
	});

	it('keeps a hostile uid inside the attribute and round-trips it exactly', () => {
		const hostile = `"><script>alert(1)</script><meta name='x' content='&amp;`;
		const tag = authVerdictMetaTag({ uid: hostile, degraded: false });

		// Nothing can close the attribute or open a tag: the only raw quotes are
		// the attribute delimiters, and no raw angle bracket survives past the
		// element's own.
		const value = tag.slice(tag.indexOf('content="') + 'content="'.length, -2);
		expect(value).not.toMatch(/["'<>]/);
		expect(tag.match(/</g)).toHaveLength(1);
		expect(tag.match(/>/g)).toHaveLength(1);

		expect(parseAuthVerdict(decodeAttribute(value))).toEqual({ uid: hostile, degraded: false });
	});
});

describe('injectAuthVerdict', () => {
	it('inserts one verdict meta just before </head>', () => {
		const html = injectAuthVerdict(PAGE, { uid: 'u-1', degraded: false });
		expect(html).toBe(
			PAGE.replace('</head>', `${authVerdictMetaTag({ uid: 'u-1', degraded: false })}</head>`)
		);
		expect(parseAuthVerdict(contentOf(html))).toEqual({ uid: 'u-1', degraded: false });
	});

	it('passes a chunk without </head> (a streamed tail) through untouched', () => {
		const tail = '<script>__sveltekit_x.resolve(1, () => [{}])</script></body></html>';
		expect(injectAuthVerdict(tail, { uid: 'u-1', degraded: false })).toBe(tail);
	});

	it('writes only at the FIRST </head>', () => {
		const html = injectAuthVerdict(`${PAGE}<pre>&lt;/head&gt; </head></pre>`, {
			uid: null,
			degraded: false
		});
		expect(html.indexOf(AUTH_VERDICT_META_NAME)).toBeLessThan(html.indexOf('</head>'));
		expect(html.split(AUTH_VERDICT_META_NAME)).toHaveLength(2);
	});

	it('round-trips every verdict the server can produce', () => {
		const verdicts: AuthVerdict[] = [
			{ uid: '00000000-0000-0000-0000-000000000001', degraded: false },
			{ uid: null, degraded: false }, // signed out
			{ uid: null, degraded: true } // auth outage — reconcile must do nothing
		];
		for (const verdict of verdicts) {
			expect(parseAuthVerdict(contentOf(injectAuthVerdict(PAGE, verdict)))).toEqual(verdict);
		}
	});
});

describe('parseAuthVerdict', () => {
	it('accepts exactly the shapes the server writes', () => {
		expect(parseAuthVerdict('{"uid":"u-1","degraded":false}')).toEqual({ uid: 'u-1', degraded: false });
		expect(parseAuthVerdict('{"uid":null,"degraded":false}')).toEqual({ uid: null, degraded: false });
		expect(parseAuthVerdict('{"uid":null,"degraded":true}')).toEqual({ uid: null, degraded: true });
	});

	it('drops any extra field rather than passing it on', () => {
		expect(parseAuthVerdict('{"uid":"u-1","degraded":false,"isAdmin":true}')).toEqual({
			uid: 'u-1',
			degraded: false
		});
	});

	it.each([
		['absent', null],
		['undefined', undefined],
		['empty', ''],
		['not JSON', 'uid=u-1'],
		['an unsubstituted placeholder', '%mankunku.auth%'],
		['JSON null', 'null'],
		['an array', '["u-1",false]'],
		['a string', '"u-1"'],
		['missing degraded', '{"uid":"u-1"}'],
		['non-boolean degraded', '{"uid":"u-1","degraded":"false"}'],
		['missing uid', '{"degraded":false}'],
		['empty uid', '{"uid":"","degraded":false}'],
		['numeric uid', '{"uid":1,"degraded":false}'],
		['object uid', '{"uid":{"id":"u-1"},"degraded":false}']
	])('reads %s as no verdict', (_label, content) => {
		expect(parseAuthVerdict(content)).toBeNull();
	});
});

describe('readAuthVerdict', () => {
	it('reads the verdict meta from the head', () => {
		const doc = docWith('{"uid":"u-1","degraded":false}');
		expect(readAuthVerdict(doc)).toEqual({ uid: 'u-1', degraded: false });
		expect(doc.selectors).toEqual([`meta[name="${AUTH_VERDICT_META_NAME}"]`]);
	});

	it('is null when the page carries no verdict (the root layout reconciles instead)', () => {
		expect(readAuthVerdict(docWith(undefined))).toBeNull();
		expect(readAuthVerdict({ head: null })).toBeNull();
	});

	it('is null for a malformed or content-less element', () => {
		expect(readAuthVerdict(docWith(null))).toBeNull();
		expect(readAuthVerdict(docWith('{"uid":"u-1"}'))).toBeNull();
	});
});
