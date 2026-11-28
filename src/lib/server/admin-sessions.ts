import { validateAdoptedPhrase } from '$lib/phrases/adopted-phrase-validator';
import type { Database, Json } from '$lib/supabase/types';
import type { Phrase } from '$lib/types/music';

type SessionRow = Database['public']['Tables']['session_results']['Row'];
const object = (v: Json | undefined) => v && typeof v === 'object' && !Array.isArray(v) ? v : null;
const score = (v: Json | undefined) => typeof v === 'number' && v >= 0 && v <= 1 ? v : null;

function reference(id: string, name: string, key: string, notes: Json | undefined, meter: Json | undefined) {
	const phrase: unknown = { id, name, key, notes, timeSignature: meter, harmony: [], tags: [], source: 'session',
		category: 'user', difficulty: { level: 1, lengthBars: 1, pitchComplexity: 1, rhythmComplexity: 1 } };
	return validateAdoptedPhrase(phrase).valid ? phrase as Phrase : null;
}

export function earSession(row: SessionRow) {
	const expected = Array.isArray(row.note_results) ? row.note_results.map(object)
		.filter(r => r && !r.extra).map(r => r!.expected ?? null) : [];
	const timing = object(row.timing)?.medianOffsetMs;
	const frames = object(row.audio_check)?.soundedFrames;
	return { id: row.id, name: row.phrase_name, timestamp: row.timestamp, key: row.key, tempo: row.tempo,
		noPitchedFrames: frames === 0, score: row.overall, pitch: row.pitch_accuracy, rhythm: row.rhythm_accuracy, level: row.difficulty_level,
		hit: row.notes_hit, total: row.notes_total, timing: typeof timing === 'number' ? Math.round(timing) : null,
		phrase: reference(row.id, row.phrase_name, row.key, expected, [4, 4]) };
}

/** Reports can come from older clients. A malformed lick must not hide the other sessions. */
export function lickSession(row: Database['public']['Tables']['lick_session_reports']['Row']) {
	const licks = (Array.isArray(row.licks) ? row.licks : []).flatMap((item, i) => {
		const lick = object(item);
		if (!lick || typeof lick.lickName !== 'string' || !Array.isArray(lick.keys)) return [];
		const name = lick.lickName;
		const keys = lick.keys.flatMap((item, j) => {
			const k = object(item);
			if (!k || typeof k.key !== 'string') return [];
			const id = typeof k.sessionId === 'string' ? k.sessionId : null;
			const ref = object(k.reference);
			return [{ key: k.key, score: score(k.score), pitch: score(k.pitchAccuracy), rhythm: score(k.rhythmAccuracy),
				passed: k.passed === true, id, swing: score(ref?.swing), tempo: typeof ref?.tempo === 'number' ? ref.tempo : null,
				phrase: ref ? reference(id ?? row.id + '-' + i + '-' + j, name, k.key, ref.notes, ref.timeSignature) : null }];
		});
		return [{ name, tempo: typeof lick.tempo === 'number' ? lick.tempo : null, keys }];
	});
	const keys = licks.flatMap(l => l.keys);
	return { id: row.id, timestamp: row.timestamp, minutes: row.minutes, attempts: row.attempts,
		passed: keys.filter(k => k.passed).length, licks };
}
