/**
 * Persistence helper for lick-practice diagnostic recordings.
 *
 * Each per-key recording window in a lick-practice session is captured as
 * its own entry in the shared recordings IndexedDB store, with
 * `source: 'lick-practice'` so the /diagnostics page can surface and filter
 * on them alongside ear-training captures.
 *
 * The ear-training path composes this metadata inline in the practice page.
 * Lick practice has one more opportunity to get it wrong (multiple windows
 * per session, each with its own phrase/key), so we funnel through this
 * helper to keep the metadata shape consistent.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';
import type { Phrase } from '$lib/types/music';
import type { DetectedNote } from '$lib/types/audio';
import type { Score, BleedFilterLog } from '$lib/types/scoring';
import type { BackingTrackLog } from '$lib/audio/backing-track';
import { saveRecording, type RecordingMetadata } from './audio-store';

export interface SaveLickPracticeRecordingInput {
	/** Unique session/window ID — one per recording window within a session. */
	sessionId: string;
	/** Captured audio for this window (empty blob is tolerated by saveRecording). */
	blob: Blob;
	/** The per-key phrase used to score this window. */
	phrase: Phrase;
	tempo: number;
	swing: number;
	score: Score | null;
	detectedNotes: DetectedNote[];
	backingTrackLog: BackingTrackLog | null;
	bleedFilterLog: BleedFilterLog | null;
	/** Optional Supabase client for cloud sync. */
	supabase?: SupabaseClient<Database>;
	/** Authenticated user ID, paired with `supabase`. */
	userId?: string;
}

/**
 * Persist a lick-practice key-recording window to IndexedDB (and cloud if
 * authenticated). Always tags the metadata with `source: 'lick-practice'`.
 */
export async function saveLickPracticeRecording(
	input: SaveLickPracticeRecordingInput
): Promise<void> {
	const metadata: RecordingMetadata = {
		phraseId: input.phrase.id,
		phraseName: input.phrase.name ?? input.phrase.id,
		source: 'lick-practice',
		tempo: input.tempo,
		key: input.phrase.key,
		swing: input.swing,
		score: input.score,
		detectedNotes: input.detectedNotes,
		backingTrackLog: input.backingTrackLog,
		bleedFilterLog: input.bleedFilterLog
	};
	await saveRecording(input.sessionId, input.blob, {
		metadata,
		supabase: input.supabase,
		userId: input.userId
	});
}
