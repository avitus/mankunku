import { realpathSync } from 'node:fs';
import { version } from '$app/environment';
import { buildHealthSnapshot, resolveReleaseId } from '$lib/server/health';
import type { RequestHandler } from './$types';

/**
 * GET /api/health — what is actually running here?
 *
 * Deliberately unauthenticated and cheap: it is the first thing to reach for
 * when production looks wrong, including from CI. The deploy job asserts
 * `version` matches the commit it just shipped, which is what turns "the
 * pipeline went green" into "the new code is genuinely serving traffic".
 *
 * Everything reported is already public (`version` is the same commit SHA
 * served at /_app/version.json) or operational (`node`, uptime). No secrets,
 * no request data, no database access — so it stays answerable even when the
 * things it would query are the broken ones.
 *
 * `prerender = false` is explicit rather than inherited: a prerendered health
 * check would freeze the deploying build's values into a static file and
 * cheerfully report them forever.
 */
export const prerender = false;

// Resolved once at module load. The release cannot change under a running
// process — PM2 is restarted by every deploy — and this keeps the endpoint a
// pure in-memory read rather than a syscall per request.
const STARTED_AT = new Date().toISOString();
const RELEASE_ID = resolveReleaseId(process.cwd(), (path) => realpathSync(path));

export const GET: RequestHandler = () => {
	const snapshot = buildHealthSnapshot({
		version,
		releaseId: RELEASE_ID,
		nodeVersion: process.version,
		uptimeSeconds: process.uptime(),
		startedAt: STARTED_AT
	});

	return new Response(JSON.stringify(snapshot), {
		headers: {
			'content-type': 'application/json',
			// Never let nginx, a CDN, or a browser answer this from cache — a
			// cached health check is a lie about the current process.
			'cache-control': 'no-store'
		}
	});
};
