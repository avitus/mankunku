import { afterEach, describe, expect, it } from 'vitest';
import { createListeningFeedback, readListeningFeedback, saveListeningFeedback, serializeListeningFeedback, restoreListeningFeedback, LISTENING_FEEDBACK_STORAGE_KEY, type ListeningFeedbackInput } from '$lib/musicality/listening-feedback';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession, HISTORICAL_LISTENING_TUNES as LISTENING_TUNES } from '../../helpers/musicality-tune-fixtures';
import { DEFAULT_BACKING_MIX } from '$lib/audio/backing-mix';
import { setActiveUid } from '$lib/persistence/namespace';

afterEach(() => setActiveUid(null));

function input(): ListeningFeedbackInput {
	const session = buildListeningTuneSession({ tuneId: LISTENING_TUNES[0].id, soloChoruses: 1 });
	const totalBars = session.bars.length;
	return { session, buildVersion: 'build-123', marks: [{ barIndex: 1, elapsedBeats: 4.5, note: 'Piano leaves room.' }], note: 'Good pulse', verdict: 'promising',
		playback: { status: 'stopped', generated: { bassEvents: [], compEvents: [], drumEvents: [] },
			params: { phrase: session.phrase, style: 'ballad', orchestration: 'coordinated', tempo: 80, instrument: 'piano', swing: 0.6, volume: 0.5, mix: { ...DEFAULT_BACKING_MIX } },
			ppq: 192, startAudioTime: 10, audioTime: 16, elapsedBeats: 8, durationBeats: totalBars * 4, barIndex: 2, ending: false, error: null,
			provenance: { engine: 'fixed', totalBars, committedBars: totalBars, committedThroughTick: totalBars * 4 * 192 } }
	};
}
const options = { id: 'take-1', createdAt: '2026-10-29T20:00:00.000Z' };
function memoryStorage() {
	const values = new Map<string, string>();
	return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

it('captures exact take settings and partial extent without retaining or mutating the score', () => {
	const source = input(); const before = JSON.stringify(source);
	const saved = createListeningFeedback(source, options);
	expect(saved).toMatchObject({ version: 1, id: 'take-1', buildVersion: 'build-123', verdict: 'promising', completion: 'partial', reachedBars: 3,
		tune: { id: source.session.tune.id, title: source.session.tune.title }, settings: { style: 'ballad', mode: 'coordinated', tempo: 80, key: source.session.tune.key, soloChoruses: 1 } });
	expect(saved).not.toHaveProperty('playback'); expect(saved).not.toHaveProperty('generated');
	expect(saved).not.toHaveProperty('musicalityRelease');
	expect(JSON.stringify(source)).toBe(before);
	source.marks[0].note = 'changed'; expect(saved.marks[0].note).toBe('Piano leaves room.');
	expect(Object.isFrozen(saved)).toBe(true); expect(Object.isFrozen(saved.marks[0])).toBe(true);
	expect(restoreListeningFeedback(serializeListeningFeedback(saved))).toEqual(saved);
});

it('retains release provenance exactly and keeps old unversioned feedback unversioned', () => {
	const source = input();
	(source.playback as unknown as Record<string, unknown>).musicalityRelease = { version: '0.1.0', engineRevision: '545c67b1a1e69c0c997d6232fdf897a8cd066978', status: 'listening-preview' };
	const saved = createListeningFeedback(source, options);
	expect(saved.musicalityRelease).toEqual((source.playback as unknown as Record<string, unknown>).musicalityRelease);
	expect(restoreListeningFeedback(JSON.stringify({ ...saved, musicalityRelease: undefined }))).not.toHaveProperty('musicalityRelease');
	expect(restoreListeningFeedback(JSON.stringify({ ...saved, musicalityRelease: { version: 'current' } }))).toBeNull();
});

it('captures the actual sound, ending and deterministic phrase identity without using later controls', () => {
	const source = input();
	Object.assign(source.playback.params!, { swing: 0.42, volume: 0.37, ending: 'hold-release', instrument: 'piano' });
	source.playback.params!.mix = { ...DEFAULT_BACKING_MIX, bass: 0.7, comp: 1.2, room: 0.2 };
	const saved = createListeningFeedback(source, options);
	expect(saved.settings).toMatchObject({ phraseId: source.session.phrase.id, swing: 0.42, volume: 0.37, ending: 'hold-release', instrument: 'piano', mix: { ...DEFAULT_BACKING_MIX, bass: 0.7, comp: 1.2, room: 0.2 } });
	source.playback.params!.mix.comp = 2.5; source.playback.params!.swing = 0.8;
	expect(saved.settings.mix?.comp).toBe(1.2); expect(saved.settings.swing).toBe(0.42);
	expect(Object.isFrozen(saved.settings.mix)).toBe(true);
	expect(restoreListeningFeedback(serializeListeningFeedback(saved))).toEqual(saved);
	expect(createListeningFeedback(input(), options).settings.ending).toBe('continue');
});

it('keeps old v1 feedback settings valid without inventing previously uncaptured sound settings', () => {
	const saved = createListeningFeedback(input(), options);
	const oldSettings = { style: saved.settings.style, mode: saved.settings.mode, tempo: saved.settings.tempo, key: saved.settings.key, soloChoruses: saved.settings.soloChoruses };
	const legacy = restoreListeningFeedback(JSON.stringify({ ...saved, settings: oldSettings }));
	expect(legacy?.settings).toEqual(oldSettings);
	for (const patch of [{ mix: { ...DEFAULT_BACKING_MIX, room: null } }, { volume: Infinity }, { swing: -1 }, { ending: 'made-up' }, { phraseId: '' }, { mix: undefined }, { instrument: 'made-up' }]) {
		expect(restoreListeningFeedback(JSON.stringify({ ...saved, settings: { ...saved.settings, ...patch } }))).toBeNull();
	}
});

it('marks complete only after a complete take reaches its final bar', () => {
	const source = input(); const totalBars = source.session.bars.length;
	Object.assign(source.playback, { status: 'completed', elapsedBeats: totalBars * 4, durationBeats: totalBars * 4, barIndex: totalBars - 1, audioTime: 10 + totalBars * 4 * 60 / 80 });
	source.marks = [{ barIndex: totalBars - 1, elapsedBeats: totalBars * 4, note: 'Final decay' }];
	expect(createListeningFeedback(source, options)).toMatchObject({ completion: 'complete', reachedBars: totalBars, totalBars });
	source.playback.elapsedBeats = 8; source.playback.barIndex = 2;
	expect(() => createListeningFeedback(source, options)).toThrow();
});

it('rejects busy, unsounded, mismatched and future-marked takes', () => {
	for (const patch of [{ status: 'playing' }, { status: 'loading' }, { status: 'idle' }, { generated: null }, { startAudioTime: null }, { barIndex: null }]) {
		const source = input(); Object.assign(source.playback, patch); expect(() => createListeningFeedback(source, options)).toThrow();
	}
	const mismatch = input(); mismatch.session = { ...mismatch.session, phrase: { ...mismatch.session.phrase, id: 'different' } };
	expect(() => createListeningFeedback(mismatch, options)).toThrow();
	for (const mark of [{ barIndex: 3, elapsedBeats: 12, note: 'future' }, { barIndex: 1, elapsedBeats: 9, note: 'future clock' }, { barIndex: 1.5, elapsedBeats: 4, note: 'fraction' }, { barIndex: 1, elapsedBeats: 8, note: 'Next bar' }]) {
		const source = input(); source.marks = [mark]; expect(() => createListeningFeedback(source, options)).toThrow();
	}
});

it('accepts reactive proxy inputs by copying only summary fields', () => {
	const source = input();
	source.marks = new Proxy(source.marks, {});
	source.playback = new Proxy(source.playback, {});
	const saved = createListeningFeedback(source, options);
	expect(saved.marks).toEqual([{ barIndex: 1, elapsedBeats: 4.5, note: 'Piano leaves room.' }]);
});

describe('bounded browser summaries', () => {
	it('isolates anonymous and signed-in users without copying anyone else\'s notes', () => {
		const storage = memoryStorage();
		setActiveUid(null); saveListeningFeedback(storage, createListeningFeedback({ ...input(), note: 'anonymous' }, options));
		setActiveUid('alice'); expect(readListeningFeedback(storage)).toEqual([]);
		saveListeningFeedback(storage, createListeningFeedback({ ...input(), note: 'alice private chart' }, options));
		setActiveUid('bob'); expect(readListeningFeedback(storage)).toEqual([]);
		setActiveUid('alice'); expect(readListeningFeedback(storage).map(item => item.note)).toEqual(['alice private chart']);
		setActiveUid(null); expect(readListeningFeedback(storage).map(item => item.note)).toEqual(['anonymous']);
	});
	it('keeps newest 20, replaces the same id and rejects malformed entries without upgrading them', () => {
		const storage = memoryStorage();
		for (let i = 0; i < 22; i++) saveListeningFeedback(storage, createListeningFeedback(input(), { ...options, id: `take-${i}` }));
		expect(readListeningFeedback(storage)).toHaveLength(20); expect(readListeningFeedback(storage)[0].id).toBe('take-21');
		saveListeningFeedback(storage, createListeningFeedback({ ...input(), note: 'updated' }, { ...options, id: 'take-21' }));
		expect(readListeningFeedback(storage)).toHaveLength(20); expect(readListeningFeedback(storage)[0].note).toBe('updated');
		const valid = readListeningFeedback(storage)[0];
		storage.setItem(LISTENING_FEEDBACK_STORAGE_KEY, JSON.stringify([null, { ...valid, verdict: 'accepted' }, valid, valid]));
		expect(readListeningFeedback(storage)).toEqual([valid]);
	});
	it('surfaces unavailable/corrupted storage instead of pretending feedback was saved', () => {
		const storage = memoryStorage(); storage.setItem(LISTENING_FEEDBACK_STORAGE_KEY, '{');
		expect(() => readListeningFeedback(storage)).toThrow();
		const record = createListeningFeedback(input(), options);
		expect(() => saveListeningFeedback({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, record)).toThrow('quota');
	});
	it('rejects invalid summary bounds and values on export and restoration', () => {
		const valid = createListeningFeedback(input(), options);
		for (const patch of [{ version: 2 }, { note: 'x'.repeat(2001) }, { createdAt: 'bad' }, { reachedBars: valid.totalBars + 1 }, { marks: Array(51).fill(valid.marks[0]) }, { settings: { ...valid.settings, tempo: NaN } }]) {
			expect(restoreListeningFeedback(JSON.stringify({ ...valid, ...patch }))).toBeNull();
			expect(() => serializeListeningFeedback({ ...valid, ...patch })).toThrow();
		}
	});
});


it('explicitly captures a playing take as partial without stopping, mutating or overstating its reached extent', () => {
 const source = input(); source.playback.status = 'playing';
 source.playback.provenance = { engine: 'causal-rolling', sessionId: 'take', fingerprint: 'policy', sessionStatus: 'running', dispatches: [], totalBars: source.session.bars.length, committedBars: 5, committedThroughTick: 5 * 4 * 192 };
 const before = JSON.stringify(source);
 const saved = createListeningFeedback(source, { ...options, allowPlaying: true });
 expect(saved).toMatchObject({ completion: 'partial', reachedBars: 3, note: 'Good pulse' });
 expect(JSON.stringify(source)).toBe(before);
 expect(restoreListeningFeedback(serializeListeningFeedback(saved))).toEqual(saved);
 // The opt-in never changes the stricter historical stopped-take API.
 expect(() => createListeningFeedback(source, options)).toThrow();
});

it('live capture still rejects count-in, missing evidence, mismatched tunes and future marks', () => {
 for (const patch of [{ status: 'loading' }, { status: 'idle' }, { elapsedBeats: 0 }, { startAudioTime: null }, { provenance: undefined }, { generated: null }]) {
  const source = input(); Object.assign(source.playback, { status: 'playing', ...patch });
  expect(() => createListeningFeedback(source, { ...options, allowPlaying: true })).toThrow();
 }
 const future = input(); future.playback.status = 'playing'; future.marks.push({ barIndex: 3, elapsedBeats: 12, note: 'Not reached' });
 expect(() => createListeningFeedback(future, { ...options, allowPlaying: true })).toThrow();
 const mismatch = input(); mismatch.playback.status = 'playing'; mismatch.session = { ...mismatch.session, phrase: { ...mismatch.session.phrase, id: 'other' } };
 expect(() => createListeningFeedback(mismatch, { ...options, allowPlaying: true })).toThrow();
});


it('never calls a live final-bar snapshot complete before the player completes', () => {
 const source = input(); const totalBars = source.session.bars.length;
 Object.assign(source.playback, { status: 'playing', elapsedBeats: totalBars * 4, barIndex: totalBars - 1, audioTime: 10 + totalBars * 4 * 60 / 80 });
 expect(createListeningFeedback(source, { ...options, allowPlaying: true })).toMatchObject({ completion: 'partial', reachedBars: totalBars });
});
