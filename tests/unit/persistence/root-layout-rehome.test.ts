/**
 * The root layout load's re-home branch (src/routes/+layout.ts), for the
 * client-side RE-RUNS that hooks.client.ts `init` never sees — a login through
 * use:enhance (goto with invalidateAll) and `invalidate('supabase:auth')`.
 *
 * On a page load `init` has already reconciled, so this branch is a no-op
 * there. On a re-run that re-homes, the realm is about to be torn down, and
 * the load must PARK (a promise that never settles) rather than return data:
 * returning would let SvelteKit render the target page from the previous
 * user's in-memory state while storage already points at the new bucket, and
 * would let it await a sibling node whose import the reload aborts. A reload
 * the loop guard declined must NOT park (that would hang the navigation) —
 * it returns the data and skips hydration, as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'http://localhost:54321',
	PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key'
}));

const { browserClient, setHydrationPromise, reconcileActiveUser, runLocalTrickMigrations } = vi.hoisted(
	() => ({
		browserClient: { kind: 'browser-client' },
		setHydrationPromise: vi.fn(),
		reconcileActiveUser: vi.fn(),
		runLocalTrickMigrations: vi.fn()
	})
);

vi.mock('@supabase/ssr', () => ({
	isBrowser: () => true,
	createBrowserClient: vi.fn(() => browserClient),
	createServerClient: vi.fn()
}));
vi.mock('$lib/state/hydration', () => ({ setHydrationPromise }));
vi.mock('$lib/persistence/user-scope', () => ({ reconcileActiveUser }));
vi.mock('$lib/persistence/trick-practice-store', () => ({ runLocalTrickMigrations }));

import { load } from '../../../src/routes/+layout';

type LoadInput = Parameters<typeof load>[0];

const ALICE = { id: 'user-alice', email: 'alice@example.com' };

/** Invoke the load as SvelteKit does on a client-side re-run. */
function runLoad(data: { session: unknown; user: unknown; degraded: boolean; isAdmin?: boolean }) {
	const input = {
		data: { cookies: [], isAdmin: false, ...data },
		depends: vi.fn(),
		fetch: vi.fn()
	} as unknown as LoadInput;
	return Promise.resolve(load(input));
}

/** True when `p` settles (either way) within a few macrotasks. */
async function settles(p: Promise<unknown>): Promise<boolean> {
	const pending = Symbol('pending');
	const winner = await Promise.race([
		p.then(
			() => 'settled',
			() => 'settled'
		),
		new Promise<symbol>((resolve) => setTimeout(() => resolve(pending), 20))
	]);
	return winner !== pending;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('root layout load — re-home on a client-side re-run', () => {
	it('reconciles against the server-verified user and degraded flag', async () => {
		reconcileActiveUser.mockReturnValue({ action: 'none', reloading: false });

		await runLoad({ session: null, user: null, degraded: true });
		expect(reconcileActiveUser).toHaveBeenLastCalledWith(null, true);

		reconcileActiveUser.mockReturnValue({ action: 'reload', reloading: false });
		await runLoad({ session: { user: ALICE }, user: ALICE, degraded: false });
		expect(reconcileActiveUser).toHaveBeenLastCalledWith('user-alice', false);
	});

	it('PARKS while a reload is under way: no data, no hydration, never settles', async () => {
		reconcileActiveUser.mockReturnValue({ action: 'reload', reloading: true });

		const result = runLoad({ session: { user: ALICE }, user: ALICE, degraded: false });

		expect(await settles(result)).toBe(false);
		expect(setHydrationPromise).not.toHaveBeenCalled();
		expect(runLocalTrickMigrations).not.toHaveBeenCalled();
	});

	it('returns the data without hydrating when the loop guard declined the reload', async () => {
		reconcileActiveUser.mockReturnValue({ action: 'reload', reloading: false });
		const session = { user: ALICE };

		const result = await runLoad({ session, user: ALICE, degraded: false, isAdmin: true });

		expect(result).toEqual({ supabase: browserClient, session, user: ALICE, isAdmin: true });
		expect(setHydrationPromise).not.toHaveBeenCalled();
	});

	it('carries on as usual when there is nothing to re-home (anonymous branch shown)', async () => {
		reconcileActiveUser.mockReturnValue({ action: 'none', reloading: false });

		const result = await runLoad({ session: null, user: null, degraded: false });

		expect(result).toEqual({ supabase: browserClient, session: null, user: null, isAdmin: false });
		expect(runLocalTrickMigrations).toHaveBeenCalledTimes(1);
	});
});
