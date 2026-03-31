/**
 * Supabase Storage Integration Tests
 *
 * Unit tests for the `uploadRecording` and `downloadRecording` functions
 * exported from `src/lib/persistence/sync.ts`.  These functions wrap the
 * Supabase Storage API for uploading and downloading audio recording blobs
 * in the `recordings` bucket.
 *
 * All Supabase client interactions are fully mocked with `vi.fn()` stubs —
 * no live Supabase instance is required (AAP §0.7.4).
 *
 * Test coverage:
 *  - Correct bucket and path construction (`{userId}/{sessionId}.webm`)
 *  - Auth check (early return when user is unauthenticated)
 *  - Upload options (`contentType: 'audio/webm'`, `upsert: true`)
 *  - Graceful error handling (console.warn, no thrown exceptions)
 *  - Successful upload and download round-trip
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadRecording, downloadRecording } from '$lib/persistence/sync';

// ── Mock Supabase Client Factory ─────────────────────────────────────

/**
 * Creates a mock Supabase client with configurable auth and storage
 * behaviour.  Exposes `_uploadFn` and `_downloadFn` references so tests
 * can inspect call arguments directly.
 */
function createMockSupabase(
	overrides: {
		user?: { id: string } | null;
		uploadResult?: { data: unknown; error: unknown };
		downloadResult?: { data: Blob | null; error: unknown };
	} = {}
) {
	const user = overrides.user !== undefined ? overrides.user : { id: 'test-user-id' };

	const uploadFn = vi.fn().mockResolvedValue(
		overrides.uploadResult ?? { data: { path: 'test-path' }, error: null }
	);

	const downloadFn = vi.fn().mockResolvedValue(
		overrides.downloadResult ?? {
			data: new Blob(['audio-data'], { type: 'audio/webm' }),
			error: null
		}
	);

	return {
		auth: {
			getUser: vi.fn().mockResolvedValue({
				data: { user }
			})
		},
		storage: {
			from: vi.fn().mockReturnValue({
				upload: uploadFn,
				download: downloadFn
			})
		},
		_uploadFn: uploadFn,
		_downloadFn: downloadFn
	};
}

// ═════════════════════════════════════════════════════════════════════
//  uploadRecording
// ═════════════════════════════════════════════════════════════════════

describe('uploadRecording', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('uploads recording to correct path with correct options', async () => {
		const mock = createMockSupabase();
		const blob = new Blob(['test-audio'], { type: 'audio/webm' });

		await uploadRecording(mock as any, 'session-123', blob);

		// Verify storage.from called with 'recordings' bucket
		expect(mock.storage.from).toHaveBeenCalledWith('recordings');

		// Verify upload called with correct path: {userId}/{sessionId}.webm
		expect(mock._uploadFn).toHaveBeenCalledWith(
			'test-user-id/session-123.webm',
			blob,
			{ contentType: 'audio/webm', upsert: true }
		);
	});

	it('constructs path as {userId}/{sessionId}.webm', async () => {
		const mock = createMockSupabase({ user: { id: 'user-abc-123' } });
		const blob = new Blob(['data']);

		await uploadRecording(mock as any, 'my-session', blob);

		expect(mock._uploadFn).toHaveBeenCalledWith(
			'user-abc-123/my-session.webm',
			expect.any(Blob),
			expect.objectContaining({ contentType: 'audio/webm', upsert: true })
		);
	});

	it('returns early when not authenticated', async () => {
		const mock = createMockSupabase({ user: null });
		const blob = new Blob(['test']);

		await uploadRecording(mock as any, 'session-1', blob);

		// storage.from should NOT have been called
		expect(mock.storage.from).not.toHaveBeenCalled();
	});

	it('logs warning on upload failure and does not throw', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mock = createMockSupabase({
			uploadResult: { data: null, error: { message: 'Storage quota exceeded' } }
		});
		const blob = new Blob(['test']);

		// Should NOT throw
		await expect(
			uploadRecording(mock as any, 'session-1', blob)
		).resolves.toBeUndefined();

		// Should log warning
		expect(warnSpy).toHaveBeenCalled();
	});

	it('uses contentType audio/webm and upsert true', async () => {
		const mock = createMockSupabase();
		const blob = new Blob(['audio']);

		await uploadRecording(mock as any, 'session-1', blob);

		expect(mock._uploadFn).toHaveBeenCalledWith(
			expect.any(String),
			blob,
			{ contentType: 'audio/webm', upsert: true }
		);
	});

	it('catches thrown exceptions and does not propagate', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mock = createMockSupabase();
		mock._uploadFn.mockRejectedValue(new Error('Network error'));

		await expect(
			uploadRecording(mock as any, 'session-1', new Blob(['test']))
		).resolves.toBeUndefined();

		expect(warnSpy).toHaveBeenCalled();
	});
});

// ═════════════════════════════════════════════════════════════════════
//  downloadRecording
// ═════════════════════════════════════════════════════════════════════

describe('downloadRecording', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('downloads and returns blob from correct path', async () => {
		const expectedBlob = new Blob(['audio-content'], { type: 'audio/webm' });
		const mock = createMockSupabase({
			downloadResult: { data: expectedBlob, error: null }
		});

		const result = await downloadRecording(mock as any, 'session-456');

		// Verify correct bucket
		expect(mock.storage.from).toHaveBeenCalledWith('recordings');

		// Verify correct path
		expect(mock._downloadFn).toHaveBeenCalledWith('test-user-id/session-456.webm');

		// Verify returned blob
		expect(result).toBe(expectedBlob);
	});

	it('returns null when not authenticated', async () => {
		const mock = createMockSupabase({ user: null });

		const result = await downloadRecording(mock as any, 'session-1');

		expect(result).toBeNull();
		expect(mock.storage.from).not.toHaveBeenCalled();
	});

	it('returns null on download error and does not throw', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mock = createMockSupabase({
			downloadResult: { data: null, error: { message: 'File not found' } }
		});

		const result = await downloadRecording(mock as any, 'session-missing');

		expect(result).toBeNull();
		expect(warnSpy).toHaveBeenCalled();
	});

	it('catches thrown exceptions and returns null', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mock = createMockSupabase();
		mock._downloadFn.mockRejectedValue(new Error('Network error'));

		const result = await downloadRecording(mock as any, 'session-1');

		expect(result).toBeNull();
		expect(warnSpy).toHaveBeenCalled();
	});

	it('constructs download path as {userId}/{sessionId}.webm', async () => {
		const mock = createMockSupabase({ user: { id: 'user-xyz' } });

		await downloadRecording(mock as any, 'sess-789');

		expect(mock._downloadFn).toHaveBeenCalledWith('user-xyz/sess-789.webm');
	});
});
