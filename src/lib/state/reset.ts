/**
 * Shared "reset everything" flow used by BOTH the Settings page and the Progress
 * page, so they can't drift. Clears the SOURCE logs (ear-training sessions, the
 * lick session log, history) BEFORE any recompute, so nothing re-derives and
 * re-pushes into the just-emptied cloud, then deletes cloud audio.
 *
 * The previous Settings-page reset omitted `clearLickPracticeSessions`, so the
 * surviving lick log re-derived daily summaries on the next hydration and
 * re-populated the cloud; it also left cloud recordings orphaned.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';
import { resetProgress } from '$lib/state/progress.svelte';
import { settings, saveSettings } from '$lib/state/settings.svelte';
import { clearLickPracticeSessions } from '$lib/persistence/lick-practice-sessions';
import { clearAllRecordings } from '$lib/persistence/audio-store';
import { deleteAllRecordingsFromCloud } from '$lib/persistence/sync';

export async function resetAllPracticeData(supabase?: SupabaseClient<Database>): Promise<void> {
	// 1. Ear-training progress + history + cloud detail rows + daily summaries.
	resetProgress(supabase);
	// 2. The lick session log — the piece the Settings reset used to miss. Clear
	//    it BEFORE anything can recompute summaries from it.
	clearLickPracticeSessions();
	// 3. Tonality override lives in settings, not progress.
	settings.tonalityOverride = null;
	saveSettings(supabase);
	// 4. Local recordings (IndexedDB) + cloud audio (was orphaned before).
	try {
		await clearAllRecordings();
	} catch (err) {
		console.warn('Failed to clear local recordings during reset:', err);
	}
	if (supabase) {
		try {
			await deleteAllRecordingsFromCloud(supabase);
		} catch (err) {
			console.warn('Failed to delete cloud recordings during reset:', err);
		}
	}
}
