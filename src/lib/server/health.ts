/**
 * Health/identity snapshot for /api/health.
 *
 * Answers "what is actually running in production?" over HTTP. During the
 * 2026-08-07/08 deploy-OOM incident production served a two-day-old build with
 * a green pipeline, and confirming that required SSH plus `dmesg`. This makes
 * it a curl.
 *
 * Kept pure and dependency-injected so it runs in plain Node tests: the route
 * handler supplies `process.cwd()`, `fs.realpathSync`, `process.uptime()` and
 * `process.version`, and every fallible bit is funnelled through here.
 */

/**
 * CI generates release ids as `YYYYMMDD-HHMMSS-<7-hex>`; `release.sh` validates
 * the same shape before letting one near a filesystem path. Matching it here
 * means a hand-made directory under `releases/` (the `pre-migration-*` dir on
 * the server is real, and prune deliberately spares it) is never mistaken for
 * a deployed release.
 */
const RELEASE_ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{7}$/;

export interface HealthSnapshot {
	status: 'ok';
	/** Deployed commit SHA — SvelteKit's app version, pinned to CIRCLE_SHA1. */
	version: string;
	/** Live release directory name, or null when not running from a release. */
	releaseId: string | null;
	/** Node version actually executing — two 2026 incidents were version skew. */
	node: string;
	uptimeSeconds: number;
	startedAt: string;
}

/**
 * Recover the live release id from the process's working directory.
 *
 * PM2 runs the app with `cwd: <root>/current`, a symlink into
 * `<root>/releases/<id>`, so resolving it needs no env plumbing and cannot
 * drift from what is actually being served.
 */
export function resolveReleaseId(
	cwd: string,
	realpath: (path: string) => string
): string | null {
	let resolved: string;
	try {
		resolved = realpath(cwd);
	} catch {
		// A dangling `current` symlink must not turn the endpoint you reach for
		// when production is sick into a 500.
		return null;
	}

	const name = resolved.split('/').filter(Boolean).pop() ?? '';
	return RELEASE_ID_PATTERN.test(name) ? name : null;
}

export function buildHealthSnapshot(input: {
	version: string;
	releaseId: string | null;
	nodeVersion: string;
	uptimeSeconds: number;
	startedAt: string;
}): HealthSnapshot {
	return {
		status: 'ok',
		version: input.version,
		releaseId: input.releaseId,
		node: input.nodeVersion,
		uptimeSeconds: Math.round(input.uptimeSeconds),
		startedAt: input.startedAt
	};
}
