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
import { describe, it, expect } from 'vitest';
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
