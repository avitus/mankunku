import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';

/**
 * The shared reset flow exists because the Settings page once ran its own
 * variant that omitted `clearLickPracticeSessions` — the surviving lick log
 * re-derived daily summaries on the next hydration and re-populated the
 * just-emptied cloud, and cloud recordings were left orphaned. These tests
 * pin the parts of that incident that are expressible here: every source log
 * is cleared, the clears run before anything else, cloud audio is deleted
 * exactly when a client is available, and a local-storage failure cannot
 * abort the cloud deletion.
 */

// vi.mock factories are hoisted above module initialization, so anything a
// factory touches at factory-run time must be hoisted with them.
const { calls, settings } = vi.hoisted(() => ({
	calls: [] as string[],
	settings: { tonalityOverride: { keyCenter: 'F' } as unknown }
}));

vi.mock('$lib/state/progress.svelte', () => ({
	resetProgress: vi.fn(() => {
		calls.push('resetProgress');
	})
}));

vi.mock('$lib/state/settings.svelte', () => ({
	settings,
	saveSettings: vi.fn(() => {
		calls.push('saveSettings');
	})
}));

vi.mock('$lib/persistence/lick-practice-sessions', () => ({
	clearLickPracticeSessions: vi.fn(() => {
		calls.push('clearLickPracticeSessions');
	})
}));

let failLocalClear = false;
vi.mock('$lib/persistence/audio-store', () => ({
	clearAllRecordings: vi.fn(async () => {
		calls.push('clearAllRecordings');
		if (failLocalClear) throw new Error('IndexedDB unavailable');
	})
}));

let failCloudDelete = false;
vi.mock('$lib/persistence/sync', () => ({
	deleteAllRecordingsFromCloud: vi.fn(async () => {
		calls.push('deleteAllRecordingsFromCloud');
		if (failCloudDelete) throw new Error('storage remove failed');
	})
}));

import { resetAllPracticeData } from '$lib/state/reset';
import { resetProgress } from '$lib/state/progress.svelte';
import { saveSettings } from '$lib/state/settings.svelte';
import { deleteAllRecordingsFromCloud } from '$lib/persistence/sync';

const supabase = { fake: true } as unknown as SupabaseClient<Database>;

beforeEach(() => {
	calls.length = 0;
	failLocalClear = false;
	failCloudDelete = false;
	settings.tonalityOverride = { keyCenter: 'F' };
	vi.clearAllMocks();
});

describe('resetAllPracticeData', () => {
	it('clears every source log, sources first', async () => {
		await resetAllPracticeData(supabase);
		expect(calls).toEqual([
			'resetProgress',
			'clearLickPracticeSessions',
			'saveSettings',
			'clearAllRecordings',
			'deleteAllRecordingsFromCloud'
		]);
	});

	it('clears the tonality override and persists it', async () => {
		await resetAllPracticeData(supabase);
		expect(settings.tonalityOverride).toBeNull();
		expect(saveSettings).toHaveBeenCalledWith(supabase);
	});

	it('forwards the supabase client to the progress reset', async () => {
		await resetAllPracticeData(supabase);
		expect(resetProgress).toHaveBeenCalledWith(supabase);
	});

	it('skips cloud audio deletion when no client is available', async () => {
		await resetAllPracticeData();
		expect(deleteAllRecordingsFromCloud).not.toHaveBeenCalled();
		expect(calls).toEqual([
			'resetProgress',
			'clearLickPracticeSessions',
			'saveSettings',
			'clearAllRecordings'
		]);
	});

	it('still deletes cloud audio when clearing local recordings throws', async () => {
		failLocalClear = true;
		await expect(resetAllPracticeData(supabase)).resolves.toBeUndefined();
		expect(deleteAllRecordingsFromCloud).toHaveBeenCalledWith(supabase);
	});

	it('swallows a cloud deletion failure rather than failing the reset', async () => {
		failCloudDelete = true;
		await expect(resetAllPracticeData(supabase)).resolves.toBeUndefined();
	});
});
