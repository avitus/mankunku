/**
 * Wrong-method requests to /api/* never reach a handler: SvelteKit answers
 * 405 (with an `Allow` header) for any verb a `+server.ts` does not export.
 * So the export list IS the method contract — an accidental `export const
 * GET` on the account route would expose a destructive endpoint's module to
 * a verb nobody reviewed. This pins the exact verb set of every API route.
 */
import { describe, it, expect } from 'vitest';

const HTTP_VERBS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'fallback'];

const ROUTES: Array<[string, () => Promise<Record<string, unknown>>, string[]]> = [
	['account', () => import('../../../src/routes/api/account/+server'), ['DELETE']],
	['chat', () => import('../../../src/routes/api/chat/+server'), ['GET', 'POST']],
	['health', () => import('../../../src/routes/api/health/+server'), ['GET']],
	['lick-match', () => import('../../../src/routes/api/lick-match/+server'), ['POST']],
	['monitoring', () => import('../../../src/routes/api/monitoring/+server'), ['POST']],
	['tune-parse', () => import('../../../src/routes/api/tune-parse/+server'), ['GET', 'POST']]
];

describe('/api route method contracts', () => {
	it.each(ROUTES)('/api/%s exports exactly its documented verbs', async (_name, load, verbs) => {
		const mod = await load();
		const exported = HTTP_VERBS.filter((verb) => typeof mod[verb] === 'function').sort();
		expect(exported).toEqual([...verbs].sort());
	});
});
