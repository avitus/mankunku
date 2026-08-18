/**
 * Unit tests for the shared account-deletion helper.
 *
 * The route-level behavior (auth gate, HTTP statuses) is pinned by
 * tests/integration/account-deletion.test.ts; these tests pin the helper's
 * own contract: both user buckets cleaned, storage failures never block the
 * auth-user deletion, and the deleteUser error propagates.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	USER_STORAGE_BUCKETS,
	clearUserStorage,
	deleteUserAccount
} from '../../../src/lib/server/account-deletion';

type BucketMock = {
	list: ReturnType<typeof vi.fn>;
	remove: ReturnType<typeof vi.fn>;
};

function makeBucket(pages: { name: string }[][]): BucketMock {
	let call = 0;
	return {
		list: vi.fn().mockImplementation(async () => ({
			data: pages[call++] ?? [],
			error: null
		})),
		remove: vi.fn().mockResolvedValue({ error: null })
	};
}

function makeAdmin(buckets: Record<string, BucketMock>) {
	const from = vi.fn().mockImplementation((bucket: string) => buckets[bucket]);
	const deleteUser = vi.fn().mockResolvedValue({ error: null });
	return {
		admin: { storage: { from }, auth: { admin: { deleteUser } } } as never,
		from,
		deleteUser
	};
}

beforeEach(() => {
	vi.restoreAllMocks();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('USER_STORAGE_BUCKETS', () => {
	it('covers both per-user buckets', () => {
		expect(USER_STORAGE_BUCKETS).toEqual(['recordings', 'tunes']);
	});
});

describe('clearUserStorage', () => {
	it('deletes listed files under the user prefix, always listing offset 0', async () => {
		const bucket = makeBucket([[{ name: 'a.webm' }, { name: 'b.webm' }]]);
		const { admin, from } = makeAdmin({ recordings: bucket });

		await clearUserStorage(admin, 'recordings', 'user-1');

		expect(from).toHaveBeenCalledWith('recordings');
		expect(bucket.list).toHaveBeenCalledTimes(2); // one page + empty terminator
		for (const call of bucket.list.mock.calls) {
			expect(call).toEqual(['user-1', { limit: 100, offset: 0 }]);
		}
		expect(bucket.remove).toHaveBeenCalledWith(['user-1/a.webm', 'user-1/b.webm']);
	});

	it('stops on a list error without throwing', async () => {
		const bucket = makeBucket([]);
		bucket.list.mockResolvedValue({ data: null, error: { message: 'boom' } });
		const { admin } = makeAdmin({ recordings: bucket });

		await expect(clearUserStorage(admin, 'recordings', 'user-1')).resolves.toBeUndefined();
		expect(bucket.remove).not.toHaveBeenCalled();
	});

	it('stops on a remove error without throwing', async () => {
		const bucket = makeBucket([[{ name: 'a.webm' }], [{ name: 'a.webm' }]]);
		bucket.remove.mockResolvedValue({ error: { message: 'undeletable' } });
		const { admin } = makeAdmin({ recordings: bucket });

		await clearUserStorage(admin, 'recordings', 'user-1');

		// break-on-error: no infinite re-list of the undeletable page
		expect(bucket.list).toHaveBeenCalledTimes(1);
		expect(bucket.remove).toHaveBeenCalledTimes(1);
	});
});

describe('deleteUserAccount', () => {
	it('cleans every user bucket, then deletes the auth user', async () => {
		const recordings = makeBucket([[{ name: 'take.webm' }]]);
		const tunes = makeBucket([[{ name: 'tune-1.pdf' }]]);
		const { admin, deleteUser } = makeAdmin({ recordings, tunes });

		const { error } = await deleteUserAccount(admin, 'user-1');

		expect(error).toBeNull();
		expect(recordings.remove).toHaveBeenCalledWith(['user-1/take.webm']);
		expect(tunes.remove).toHaveBeenCalledWith(['user-1/tune-1.pdf']);
		expect(deleteUser).toHaveBeenCalledWith('user-1');
		// storage first, deleteUser last
		expect(deleteUser.mock.invocationCallOrder[0]).toBeGreaterThan(
			tunes.remove.mock.invocationCallOrder[0]
		);
	});

	it('still deletes the auth user when storage cleanup fails', async () => {
		const recordings = makeBucket([]);
		recordings.list.mockRejectedValue(new Error('storage down'));
		const tunes = makeBucket([]);
		tunes.list.mockResolvedValue({ data: null, error: { message: 'nope' } });
		const { admin, deleteUser } = makeAdmin({ recordings, tunes });

		const { error } = await deleteUserAccount(admin, 'user-1');

		expect(error).toBeNull();
		expect(deleteUser).toHaveBeenCalledWith('user-1');
	});

	it('propagates the deleteUser error', async () => {
		const { admin, deleteUser } = makeAdmin({
			recordings: makeBucket([]),
			tunes: makeBucket([])
		});
		deleteUser.mockResolvedValue({ error: { message: 'Deletion failed' } });

		const { error } = await deleteUserAccount(admin, 'user-1');

		expect(error).toEqual({ message: 'Deletion failed' });
	});
});
