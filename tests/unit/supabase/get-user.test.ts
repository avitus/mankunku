import { describe, expect, it, vi } from 'vitest';
import type { UserResponse } from '@supabase/supabase-js';
import { getUserCoalesced } from '$lib/supabase/get-user';

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function answer(id: string): UserResponse {
	return { data: { user: { id } }, error: null } as unknown as UserResponse;
}

function client(getUser: () => Promise<UserResponse>) {
	return { auth: { getUser: vi.fn(getUser) } };
}

describe('getUserCoalesced (MANKUNKU-1Q)', () => {
	it('concurrent callers on one client share one auth request', async () => {
		const pending = deferred<UserResponse>();
		const supabase = client(() => pending.promise);

		const calls = [1, 2, 3, 4, 5].map(() => getUserCoalesced(supabase));
		expect(supabase.auth.getUser).toHaveBeenCalledOnce();

		pending.resolve(answer('user-1'));
		const results = await Promise.all(calls);
		expect(results.map((r) => r.data.user?.id)).toEqual(['user-1', 'user-1', 'user-1', 'user-1', 'user-1']);
	});

	it('a call after the request settles asks the auth server again', async () => {
		const supabase = client(async () => answer('user-1'));
		await getUserCoalesced(supabase);
		supabase.auth.getUser.mockImplementation(async () => answer('user-2'));

		const later = await getUserCoalesced(supabase);

		expect(supabase.auth.getUser).toHaveBeenCalledTimes(2);
		expect(later.data.user?.id).toBe('user-2');
	});

	it('two clients never share a request', async () => {
		const a = client(async () => answer('user-a'));
		const b = client(async () => answer('user-b'));

		const [fromA, fromB] = await Promise.all([getUserCoalesced(a), getUserCoalesced(b)]);

		expect(fromA.data.user?.id).toBe('user-a');
		expect(fromB.data.user?.id).toBe('user-b');
		expect(a.auth.getUser).toHaveBeenCalledOnce();
		expect(b.auth.getUser).toHaveBeenCalledOnce();
	});

	it('a failed request rejects every caller that joined it, and the next call retries', async () => {
		const pending = deferred<UserResponse>();
		const supabase = client(() => pending.promise);
		const first = getUserCoalesced(supabase);
		const second = getUserCoalesced(supabase);

		pending.reject(new Error('network down'));
		await expect(first).rejects.toThrow('network down');
		await expect(second).rejects.toThrow('network down');

		supabase.auth.getUser.mockImplementation(async () => answer('user-1'));
		await expect(getUserCoalesced(supabase)).resolves.toEqual(answer('user-1'));
		expect(supabase.auth.getUser).toHaveBeenCalledTimes(2);
	});
});
