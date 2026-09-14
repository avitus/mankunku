import { test, expect, setE2EAuthCookie, type E2ETestUser } from './fixtures/auth';
import type { Page, Request } from '@playwright/test';

/**
 * A re-home reload must be decided BEFORE SvelteKit imports a single route node.
 *
 * Storage is per-user namespaced, and a page whose server-verified user disagrees
 * with the local `__active` pointer (a first signed-in load, an account switch, a
 * sign-out) re-homes the namespace and reloads. That decision used to live in the
 * root +layout.ts load — a route node, run while SvelteKit had every other node
 * import for hydration in flight. The reload aborted them, and SvelteKit's error
 * path ran during teardown: Firefox reported `error loading dynamically imported
 * module: …/nodes/1.<hash>.js` (the root error node SvelteKit imports eagerly the
 * moment its `init` hook settles), WebKit a rejected module import plus aborted
 * `__data.json` / `version.json` fetches from the error page's recovery, and
 * Sentry received an event per re-home. It now runs in hooks.client.ts `init`,
 * which SvelteKit awaits before any node import, from a verdict the server
 * writes into the page head.
 *
 * The pin is request-level so it holds on every engine, Chromium included (which
 * logged nothing for the old race): every route-node chunk the re-homing document
 * requested must be one its response told the browser to preload. SvelteKit's
 * own imports of those dedupe against the preload in the module map, so the only
 * way a node request escapes the set is an import SvelteKit started itself — the
 * eager error-node import first among them. The console guard (auto fixture)
 * covers the rest: no pageerror, no console.error, on all three engines.
 *
 * Each scenario re-homes on the FIRST document of a fresh context, so no chunk
 * can be served from a memory cache without a request event.
 */

const ALICE: E2ETestUser = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'alice@e2e.dev' };
const BOB: E2ETestUser = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'bob@e2e.dev' };
const NODE_CHUNK = '/_app/immutable/nodes/';

/** Keep the browser Supabase client off the network (no real project behind the e2e cookie). */
async function stubSupabase(page: Page): Promise<void> {
	await page.route('**/rest/v1/**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'content-range': '0-0/0' },
			body: '[]'
		})
	);
	await page.route('**/auth/v1/**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
	);
}

/** Point this device's namespace at `uid` before any page script runs (a device last homed there). */
async function homeDeviceTo(page: Page, uid: string): Promise<void> {
	await page.addInitScript((active) => {
		if (localStorage.getItem('mankunku:__schema') === null) {
			localStorage.setItem('mankunku:__schema', '3');
		}
		if (localStorage.getItem('mankunku:__active') === null) {
			localStorage.setItem('mankunku:__active', JSON.stringify(active));
		}
	}, uid);
}

/**
 * Route-node chunk paths the server tells the browser to modulepreload for `path`
 * — the `Link` response header SvelteKit sends on SSR'd pages, plus any
 * `<link rel="modulepreload">` tags, should a future SvelteKit move them into
 * the markup.
 */
async function preloadedNodeChunks(page: Page, path: string, baseURL: string): Promise<Set<string>> {
	const response = await page.request.get(path);
	const base = new URL(path, baseURL).href;
	const hrefs: string[] = [];
	for (const part of (response.headers()['link'] ?? '').split(/,\s*(?=<)/)) {
		const match = part.match(/^<([^>]+)>(.*)$/);
		if (match && /rel="?modulepreload"?/.test(match[2])) hrefs.push(match[1]);
	}
	for (const tag of (await response.text()).match(/<link\b[^>]*>/g) ?? []) {
		const href = tag.match(/\bhref="([^"]+)"/)?.[1];
		if (href && /\brel="modulepreload"/.test(tag)) hrefs.push(href);
	}
	const chunks = new Set<string>();
	for (const href of hrefs) {
		const chunk = new URL(href, base).pathname;
		if (chunk.includes(NODE_CHUNK)) chunks.add(chunk);
	}
	return chunks;
}

interface TimelineEntry {
	kind: 'document' | 'node';
	path: string;
}

/** Record main-frame document requests and route-node chunk requests, in issue order. */
function recordTimeline(page: Page): TimelineEntry[] {
	const timeline: TimelineEntry[] = [];
	page.on('request', (request: Request) => {
		const path = new URL(request.url()).pathname;
		if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
			timeline.push({ kind: 'document', path });
		} else if (path.includes(NODE_CHUNK)) {
			timeline.push({ kind: 'node', path });
		}
	});
	return timeline;
}

/**
 * Load `path` and assert the whole re-home: exactly one reload, no route-node
 * import started by the document that reloaded, the reloaded realm homed on
 * `expectedActive`, and the server's verdict in the head.
 */
async function expectRehomeBeforeHydration(
	page: Page,
	path: string,
	baseURL: string,
	expectedActive: string,
	expectedVerdict: { uid: string | null; degraded: boolean }
): Promise<void> {
	const preloaded = await preloadedNodeChunks(page, path, baseURL);
	const timeline = recordTimeline(page);

	// The fixture's goto also waits for data-hydrated, which only the reloaded
	// (correctly homed) document ever sets.
	await page.goto(path);

	const documents = timeline.flatMap((entry, i) => (entry.kind === 'document' ? [i] : []));
	expect(documents, 'expected the load plus exactly one re-home reload').toHaveLength(2);

	const imported = timeline
		.slice(documents[0], documents[1])
		.filter((entry) => entry.kind === 'node' && !preloaded.has(entry.path));
	expect(imported, 'route-node imports started by the document that re-homed').toEqual([]);

	// The reloaded realm is homed where the server said and reconciled as a
	// no-op: pointer on the expected bucket, reload guard cleared.
	expect(await page.evaluate(() => localStorage.getItem('mankunku:__active'))).toBe(
		JSON.stringify(expectedActive)
	);
	expect(await page.evaluate(() => sessionStorage.getItem('mankunku:reload-target'))).toBeNull();

	// The verdict rides exactly one <meta> in the head, carrying nothing but
	// the uid and the degraded flag.
	const verdicts = await page.evaluate(() =>
		Array.from(document.querySelectorAll('meta[name="mankunku-auth"]'), (meta) => ({
			inHead: meta.parentElement === document.head,
			content: meta.getAttribute('content')
		}))
	);
	expect(verdicts).toEqual([{ inHead: true, content: JSON.stringify(expectedVerdict) }]);
}

test.describe('a re-home reload starts no route-node import', () => {
	test('first signed-in load on a fresh profile (anon pointer → the user)', async ({
		page,
		baseURL
	}) => {
		await stubSupabase(page);
		await setE2EAuthCookie(page, ALICE, baseURL as string);

		await expectRehomeBeforeHydration(page, '/licks', baseURL as string, ALICE.id, {
			uid: ALICE.id,
			degraded: false
		});
	});

	test('account switch on one browser (Alice’s pointer, Bob’s session)', async ({
		page,
		baseURL
	}) => {
		await stubSupabase(page);
		await homeDeviceTo(page, ALICE.id);
		await setE2EAuthCookie(page, BOB, baseURL as string);

		await expectRehomeBeforeHydration(page, '/licks', baseURL as string, BOB.id, {
			uid: BOB.id,
			degraded: false
		});
	});

	test('sign-out (Alice’s pointer, no session) re-homes to the anonymous bucket', async ({
		page,
		baseURL
	}) => {
		await stubSupabase(page);
		await homeDeviceTo(page, ALICE.id);

		await expectRehomeBeforeHydration(page, '/licks', baseURL as string, 'anon', {
			uid: null,
			degraded: false
		});
	});
});
