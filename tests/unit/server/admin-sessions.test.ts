import { describe, expect, it } from 'vitest';
import { earSession, lickSession } from '$lib/server/admin-sessions';
import type { Database } from '$lib/supabase/types';

describe('admin session review', () => {
	const note = { pitch: 72, duration: [1, 4], offset: [1, 8] };
	it('rebuilds scored targets in concert register and keeps missed notes while ignoring extras', () => {
		const row: Database['public']['Tables']['session_results']['Row'] = {
			id: 'take', user_id: 'player', phrase_id: 'removed-lick', phrase_name: 'Blue turn', category: 'blues',
			key: 'C', scale_type: null, tempo: 88, difficulty_level: 9, pitch_accuracy: 0, rhythm_accuracy: 0,
			overall: 0, grade: 'try-again', notes_hit: 0, notes_total: 1, timestamp: 123, source: null,
			note_results: [{ extra: true, expected: note }, { missed: true, expected: note }],
			timing: null, audio_check: { soundedFrames: 0 }
		};
		expect(earSession(row)).toMatchObject({ score: 0, noPitchedFrames: true, timing: null, phrase: { notes: [note] } });
		expect(earSession({ ...row, note_results: [], audio_check: null })).toMatchObject({ noPitchedFrames: false, phrase: null });
	});

	it('preserves real per-key recording IDs and gracefully handles reports without references', () => {
		const result = lickSession({
			id: 'workout', user_id: 'player', generation: 0, timestamp: 123, attempts: 2, minutes: 4,
			licks: [{ lickName: 'Minor turn', tempo: 92, keys: [
				{ key: 'F', sessionId: 'exact-take', score: 1, passed: true, reference: { notes: [note], timeSignature: [3,4], tempo: 87, swing: 0.62 } },
				{ key: 'C', score: 0, passed: false }
			] }]
		});
		expect(result.passed).toBe(1);
		expect(result.licks[0].keys).toMatchObject([
			{ key: 'F', id: 'exact-take', tempo: 87, phrase: { timeSignature: [3,4], notes: [note] } },
			{ key: 'C', id: null, score: 0, phrase: null }
		]);
	});
});
