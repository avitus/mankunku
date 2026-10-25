import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import baseline from '../../fixtures/audio/listening-curated-before.json';
import { ALL_CURATED_TUNES, MANKUNKU_BLUES } from '$lib/data/tunes';
import type { Tune } from '$lib/types/tune';
import { assessListeningTune, buildListeningTuneSession, buildListeningTuneSessionFromTune } from '$lib/musicality/listening-tunes';

function chart(): Tune {
	return { id: 'local-original-aaba', title: 'Original AABA test chart', key: 'C', timeSignature: [4, 4],
		source: 'user', tags: ['test'], sections: ['A', 'A', 'B', 'A'].map((label, index) => ({ label, bars: 8, notes: [],
			harmony: [{ chord: { root: index === 2 ? 'F' : 'C', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [0, 1], duration: [8, 1] }] })) };
}

it('admits an existing harmony-only AABA chart with exact finite form and source identity', () => {
	for (const [soloChoruses, bars] of [[1, 96], [2, 128]]) {
		const input = chart();
		const before = structuredClone(input);
		const result = assessListeningTune(input, { soloChoruses });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.reason);
		expect(result.session.bars).toHaveLength(bars);
		expect(result.session.phrase.notes).toEqual([]);
		expect(result.session.phrase.performanceForm.choruses.map(c => c.role))
			.toEqual(['head', ...Array(soloChoruses).fill('solo'), 'head']);
		expect(result.session.phrase.performanceForm.sections.map(s => s.sourceSection))
			.toEqual(Array.from({ length: soloChoruses + 2 }, () => [0, 1, 2, 3]).flat());
		expect(result.session.tune.source).toBe('user');
		expect(input).toEqual(before);
		result.session.tune.sections[0].label = 'changed';
		expect(input).toEqual(before);
	}
});

it('rejects the actual expanded overlong arrangement without truncating choruses', () => {
	for (const soloChoruses of [3, 4]) {
		const result = assessListeningTune(chart(), { soloChoruses });
		expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/128/) });
		expect(() => buildListeningTuneSessionFromTune(chart(), { soloChoruses })).toThrow(/128/);
	}
});

it('preserves curated results, intro once, alternate ending and transpose semantics exactly', () => {
	for (const tune of ALL_CURATED_TUNES.filter(t => t.timeSignature[0] === 4)) {
		for (const soloChoruses of [1, 2, 3, 4]) {
			const options = { key: 'Bb' as const, soloChoruses };
			expect(buildListeningTuneSessionFromTune(tune, options)).toEqual(buildListeningTuneSession({ tuneId: tune.id, ...options }));
		}
	}
	const source = structuredClone(MANKUNKU_BLUES);
	source.id = 'existing-import'; source.source = 'imported-ireal';
	const result = buildListeningTuneSessionFromTune(source, { key: 'Bb', soloChoruses: 2 });
	expect(result.headBars).toBe(16);
	expect(result.chorusBars).toBe(12);
	expect(result.bars).toHaveLength(52);
	expect(result.phrase.sectionMap!.filter(s => s.sourceSection === 0)).toHaveLength(1);
	expect(result.phrase.harmony.at(-1)!.chord.root).toBe('Bb');
	expect(result.phrase.sectionMap!.slice(-2).map(s => s.sourceSection)).toEqual([1, 3]);
});

it('keeps quarter-aligned intra-bar changes and slash-bass transposition', () => {
	const tune = chart();
	tune.sections[0].harmony = [
		{ chord: { root: 'C', quality: '7', bass: 'E' }, scaleId: 'major.mixolydian', startOffset: [0, 1], duration: [1, 4], symbol: 'C7/E' },
		{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [1, 4], duration: [31, 4] }
	];
	const built = buildListeningTuneSessionFromTune(tune, { key: 'D', soloChoruses: 1 });
	expect(built.bars[0].changes.map(c => c.durationBeats)).toEqual([1, 3]);
	expect(built.bars[0].chordSymbols[0]).toBe('D7/F#');
	expect(built.phrase.harmony[0].chord.bass).toBe('F#');
	expect(tune.sections[0].harmony[0].chord.bass).toBe('E');
});

it('reports unsupported meter, key, chorus count and malformed local payloads without throwing', () => {
	for (const input of [null, [], {}, { ...chart(), sections: [null] }, { ...chart(), timeSignature: [3, 4] },
		{ ...chart(), key: 'H' }, { ...chart(), sections: [] }, { ...chart(), title: '<script>' }]) {
		expect(() => assessListeningTune(input)).not.toThrow();
		expect(assessListeningTune(input).ok).toBe(false);
	}
	for (const soloChoruses of [0, 5, 1.5, NaN]) expect(assessListeningTune(chart(), { soloChoruses }).ok).toBe(false);
});

it('rejects unknown harmony and incomplete or non-quarter-aligned time rather than repairing the chart', () => {
	const changes: ((tune: Tune) => void)[] = [
		t => { t.sections[0].harmony = []; },
		t => { t.sections[0].harmony[0].scaleId = 'missing.scale'; },
		t => { t.sections[0].harmony[0].chord.quality = 'missing' as '7'; },
		t => { t.sections[0].harmony[0].chord.quality = 'toString' as '7'; },
		t => { t.sections[0].harmony[0].chord.quality = '__proto__' as '7'; },
		t => { t.sections[0].harmony[0].duration = [8e300, 1e300]; },
		t => { t.sections[0].harmony[0].chord.root = 'H' as 'C'; },
		t => { t.sections[0].harmony[0].startOffset = [1, 4]; },
		t => { t.sections[0].harmony[0].duration = [7, 1]; },
		t => { t.sections[0].harmony[0].duration = [9, 1]; },
		t => { t.sections[0].harmony.push(structuredClone(t.sections[0].harmony[0])); },
		t => { t.sections[0].harmony = [
			{ ...t.sections[0].harmony[0], duration: [1, 8] },
			{ ...t.sections[0].harmony[0], startOffset: [1, 8], duration: [63, 8] }
		]; },
		t => { t.sections[0].harmony[0].duration = [1, 0]; }
	];
	for (const change of changes) {
		const input = chart(); change(input);
		const before = structuredClone(input);
		expect(assessListeningTune(input).ok).toBe(false);
		expect(input).toEqual(before);
	}
});

it('rejects ambiguous repeat markers and out-of-section melody instead of inventing a form', () => {
	for (const change of [
		(t: Tune) => { t.sections[0].repeatStart = true; },
		(t: Tune) => { t.sections[1].repeatEnd = true; },
		(t: Tune) => { t.sections[0].ending = 2; },
		(t: Tune) => { t.sections[0].repeatStart = true; t.sections[1].repeatStart = true; t.sections[2].repeatEnd = true; },
		(t: Tune) => { t.sections[0].notes = [{ pitch: 60, offset: [8, 1], duration: [1, 4] }]; }
	]) {
		const input = chart(); change(input);
		expect(assessListeningTune(input).ok).toBe(false);
	}
});


it('retains all 24 independently captured pre-refactor curated sessions exactly', () => {
	for (const { options, sha256 } of baseline) {
		const session = buildListeningTuneSession({ ...options, key: options.key as 'C' });
		expect(createHash('sha256').update(JSON.stringify(session)).digest('hex')).toBe(sha256);
		const tune = ALL_CURATED_TUNES.find(t => t.id === options.tuneId)!;
		const direct = buildListeningTuneSessionFromTune(tune, { ...options, key: options.key as 'C' });
		expect(createHash('sha256').update(JSON.stringify(direct)).digest('hex')).toBe(sha256);
	}
});

it('rejects transposition that moves an otherwise valid melody outside MIDI range without clamping it', () => {
	const input = chart();
	input.sections[0].notes = [
		{ pitch: 0, offset: [0, 1], duration: [1, 4] },
		{ pitch: 127, offset: [1, 4], duration: [1, 4] }
	];
	const before = structuredClone(input);
	expect(assessListeningTune(input, { key: 'C', soloChoruses: 1 }).ok).toBe(true);
	expect(assessListeningTune(input, { key: 'D', soloChoruses: 1 }))
		.toMatchObject({ ok: false, reason: expect.stringMatching(/MIDI|pitch/i) });
	expect(() => buildListeningTuneSessionFromTune(input, { key: 'D', soloChoruses: 1 })).toThrow(/MIDI|pitch/i);
	expect(input).toEqual(before);
});
