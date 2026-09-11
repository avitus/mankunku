/**
 * Tests for the /api/health payload builder.
 *
 * The endpoint exists to answer "what is actually running in production?"
 * without SSHing to the box — a question that cost two days during the
 * 2026-08-07/08 deploy-OOM incident, when production silently served a
 * two-day-old build while every check on the PR was green.
 *
 * The logic worth testing is release-id resolution: the app runs with cwd
 * `<root>/current`, a symlink into `<root>/releases/<id>`, so the live release
 * is recoverable from the filesystem with no env plumbing. Everything else is
 * passthrough. `realpath` is injected so these run in Node with no fixture
 * tree, and so the failure paths (dangling symlink, local dev) are reachable.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveReleaseId, buildHealthSnapshot } from '../../../src/lib/server/health';

const RELEASE_ROOT = '/home/deploy/mankunku';

describe('resolveReleaseId', () => {
	it('reads the live release id through the current symlink', () => {
		const realpath = (p: string) => {
			if (p === `${RELEASE_ROOT}/current`) {
				return `${RELEASE_ROOT}/releases/20260808-175425-d40ed25`;
			}
			throw new Error(`unexpected path: ${p}`);
		};

		expect(resolveReleaseId(`${RELEASE_ROOT}/current`, realpath)).toBe(
			'20260808-175425-d40ed25'
		);
	});

	it('returns null off the release layout, so local dev reports no release', () => {
		expect(resolveReleaseId('/Users/dev/mankunku', (p) => p)).toBeNull();
	});

	it('returns null when the directory name is not a CI-generated release id', () => {
		// `pre-migration-20260422-211746` really is on the server — release.sh's
		// prune pass deliberately refuses to touch it. It must not be reported
		// as the live release just because it sits under releases/.
		const realpath = () => `${RELEASE_ROOT}/releases/pre-migration-20260422-211746`;
		expect(resolveReleaseId(`${RELEASE_ROOT}/current`, realpath)).toBeNull();
	});

	it('returns null instead of throwing when the path cannot be resolved', () => {
		// A dangling `current` symlink must not turn the health endpoint — the
		// thing you reach for when production is sick — into a 500.
		const realpath = () => {
			throw new Error('ENOENT: no such file or directory');
		};
		expect(resolveReleaseId(`${RELEASE_ROOT}/current`, realpath)).toBeNull();
	});
});

describe('buildHealthSnapshot', () => {
	it('reports the deployed commit, release, and runtime', () => {
		expect(
			buildHealthSnapshot({
				version: 'd40ed2540e194e07befbf324837b52c7c2807528',
				releaseId: '20260808-175425-d40ed25',
				nodeVersion: 'v26.5.1',
				uptimeSeconds: 12.7,
				startedAt: '2026-08-08T18:00:00.000Z'
			})
		).toEqual({
			status: 'ok',
			version: 'd40ed2540e194e07befbf324837b52c7c2807528',
			releaseId: '20260808-175425-d40ed25',
			node: 'v26.5.1',
			uptimeSeconds: 13,
			startedAt: '2026-08-08T18:00:00.000Z'
		});
	});

	it('still reports ok when no release id is resolvable', () => {
		// Running from a dev box or an unexpected layout is not an unhealthy
		// process. Degrade the field, not the status.
		const snapshot = buildHealthSnapshot({
			version: 'dev',
			releaseId: null,
			nodeVersion: 'v26.5.1',
			uptimeSeconds: 0.4,
			startedAt: '2026-08-08T18:00:00.000Z'
		});

		expect(snapshot.status).toBe('ok');
		expect(snapshot.releaseId).toBeNull();
		expect(snapshot.uptimeSeconds).toBe(0);
	});
});

describe('GET /api/health — the route wiring', () => {
	// The builder and resolver above are pure; this pins what the ROUTE feeds
	// them: the release id comes from realpath(process.cwd()) through a real
	// `current` symlink (PM2's cwd), and the answer must never be cached — a
	// cached health check is a lie about the current process.
	const tmpRoots: string[] = [];

	afterEach(() => {
		vi.restoreAllMocks();
		vi.doUnmock('$app/environment');
		for (const dir of tmpRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	async function loadRouteWithCwd(cwd: string) {
		vi.resetModules();
		vi.doMock('$app/environment', () => ({ version: 'd40ed2540e194e07befbf324837b52c7c2807528' }));
		vi.spyOn(process, 'cwd').mockReturnValue(cwd);
		return await import('../../../src/routes/api/health/+server');
	}

	it('reports the release that `current` resolves to, uncached, and is never prerendered', async () => {
		const root = mkdtempSync(join(tmpdir(), 'mankunku-health-'));
		tmpRoots.push(root);
		mkdirSync(join(root, 'releases', '20260910-120000-abcdef0'), { recursive: true });
		symlinkSync(join('releases', '20260910-120000-abcdef0'), join(root, 'current'));

		const route = await loadRouteWithCwd(join(root, 'current'));
		expect(route.prerender).toBe(false);
		const res = await route.GET({} as Parameters<typeof route.GET>[0]);
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(res.headers.get('content-type')).toBe('application/json');
		const body = await res.json();
		expect(body).toMatchObject({
			status: 'ok',
			version: 'd40ed2540e194e07befbf324837b52c7c2807528',
			releaseId: '20260910-120000-abcdef0',
			node: process.version
		});
	});

	it('answers ok with a null release id when the cwd is not a release (a dangling symlink included)', async () => {
		const root = mkdtempSync(join(tmpdir(), 'mankunku-health-'));
		tmpRoots.push(root);
		// `current` points at a release that was pruned away.
		symlinkSync(join('releases', '20260910-120000-abcdef0'), join(root, 'current'));

		const route = await loadRouteWithCwd(join(root, 'current'));
		const body = await (await route.GET({} as Parameters<typeof route.GET>[0])).json();
		expect(body.status).toBe('ok');
		expect(body.releaseId).toBeNull();
	});
});
