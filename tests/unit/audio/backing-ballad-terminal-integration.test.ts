import { expect, it } from 'vitest';
import { generateBacking, type BackingGenerationParams } from '$lib/audio/backing-generation';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import baseline from '../../fixtures/audio/ballad-terminal-before.json';

const { phrase } = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key: 'C', soloChoruses: 2 });
function params(tempo: number, hold = true): BackingGenerationParams {
	return { phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: .55,
		performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {},
		...(hold ? { terminalArrangement: { ending: 'hold-release' as const, melody: phrase.notes } } : {}) };
}
function rolling(tempo: number, hold = true, loopCount = 1) {
	const score = createRollingBacking(phrase.harmony, BACKING_STYLES.ballad, params(tempo, hold), { loopCount });
	let checkpoint: RollingBackingCheckpoint | undefined;
	const windows = [];
	for (let bar = 0; bar < score.totalBars; bar++) {
		const next = advanceRollingBacking(score, checkpoint);
		windows.push(next); checkpoint = next.checkpoint;
	}
	return { score, windows, bassEvents: windows.flatMap(w => w.bassEvents),
		compEvents: windows.flatMap(w => w.compEvents), drumEvents: windows.flatMap(w => w.drumEvents) };
}

it.each(baseline.witnesses)('Ballad $tempo $engine catches with its actual native downbeat kit and quiet current chord', ({ tempo, engine, finalEvents }) => {
	const take = engine === 'fixed' ? generateBacking(phrase.harmony, BACKING_STYLES.ballad, params(tempo)) : rolling(tempo);
	const bass = take.bassEvents.filter(event => event.absBeat >= 204);
	const piano = take.compEvents.filter(event => event.absBeat >= 204);
	const drums = take.drumEvents.filter(event => event.absBeat >= 204);
	expect(piano).toHaveLength(1);
	expect(bass).toHaveLength(1);
	const nativeDownbeat = finalEvents.drumEvents.filter(event => event.absBeat === 204 && ['ride', 'kick'].includes(event.drum));
	expect(drums.map(event => ({ drum: event.drum, velocity: event.velocity })))
		.toEqual(nativeDownbeat.map(event => ({ drum: event.drum, velocity: event.velocity })));
	expect(drums.map(event => event.drum)).toEqual(tempo === 80 ? ['ride', 'kick'] : ['ride']);
	expect([...bass, ...piano, ...drums].every(event => event.absBeat === 204 && event.time === '39168i')).toBe(true);
	expect(bass[0].velocity).toBe(finalEvents.bassEvents[0].velocity);
	expect(bass[0].midi % 12).toBe(0);
	expect(bass[0].duration).toBe(120 / tempo);
	expect(piano[0].duration).toBe(120 / tempo);
	expect(piano[0].velocity).toBeGreaterThanOrEqual(40);
	expect(piano[0].velocity).toBeLessThanOrEqual(56);
	const ordinary = engine === 'fixed' ? generateBacking(phrase.harmony, BACKING_STYLES.ballad, params(tempo, false)) : rolling(tempo, false);
	for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) {
		expect(take[field].filter(event => event.absBeat < 204)).toEqual(ordinary[field].filter(event => event.absBeat < 204));
	}
});

it.each([80, 140])('Ballad %i retains native scope and truthful joint-arrangement pitch memory', tempo => {
	const take = rolling(tempo);
	const final = take.windows.at(-1)!;
	const plan = final.ensemblePlan.bars[0];
	const reservation = plan.terminalArrangement!;
	expect(reservation).toMatchObject({ profile: 'ballad-v1', barIndex: 51, absBeat: 204, releaseBeat: 206 });
	expect(plan.energy).toBeLessThanOrEqual(.6);
	expect(plan.bass.keepPulse).toBe(false);
	expect(plan.drums.keepTime).toBe(false);
	expect(final.ensembleDevelopment.terminalArrangements).toEqual([{
		version: 1, reservationId: reservation.id, barIndex: 51, status: 'accepted',
		bass: final.bassEvents[0], piano: final.compEvents[0], drums: final.drumEvents
	}]);
	expect(final.ensembleDevelopment.pianoVoicings).toHaveLength(1);
	expect(final.ensembleDevelopment.pianoVoicings![0]).toMatchObject({
		time: final.compEvents[0].time, absBeat: 204, notes: final.compEvents[0].notes
	});
	expect(final.ensembleDevelopment.pianoVoicings![0].decision).not.toHaveProperty('topLine');
	expect(final.checkpoint.piano.voicing?.notes).toEqual(final.compEvents[0].notes);
	expect(final.checkpoint.bass.previousMidi).toBe(final.bassEvents[0].midi);
	expect(final.checkpoint.drums.previousCompOnsets).toEqual([0]);
	expect(final.checkpoint.drums.previousCompIsSharedArrival).toBe(true);
	for (const window of take.windows) {
		for (const key of ['contour', 'phraseRecall']) expect(window.checkpoint.piano).not.toHaveProperty(key);
		for (const key of ['pianoAnswer', 'pianoRecovery']) expect(window.checkpoint).not.toHaveProperty(key);
		for (const key of ['pianoAnswers', 'pianoRecoveries', 'bassContinuations']) expect(window.ensembleDevelopment).not.toHaveProperty(key);
		expect(window.checkpoint.drums).not.toHaveProperty('previousCompIsDrumReply');
	}
	expect(Object.isFrozen(final.ensembleDevelopment.terminalArrangements![0])).toBe(true);
	expect(advanceRollingBacking(take.score, JSON.parse(JSON.stringify(take.windows[50].checkpoint)))).toEqual(final);
	expect(() => advanceRollingBacking(take.score, JSON.parse(JSON.stringify(final.checkpoint)))).toThrow('complete');
});

it.each([80, 140])('Ballad %i keeps the first loop seam playing and binds the ending to the last declared loop', tempo => {
	const take = rolling(tempo, true, 2);
	const ordinary = rolling(tempo, false, 2);
	for (let bar = 0; bar < 103; bar++) {
		for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) {
			expect(take.windows[bar][field]).toEqual(ordinary.windows[bar][field]);
		}
		expect(take.windows[bar].ensembleDevelopment.terminalArrangements).toBeUndefined();
	}
	const final = take.windows[103];
	expect(final.compEvents).toHaveLength(1);
	expect(final.bassEvents).toHaveLength(1);
	expect([...final.bassEvents, ...final.compEvents, ...final.drumEvents].every(event => event.time === '79104i')).toBe(true);
	expect(final.ensemblePlan.bars[0].terminalArrangement).toMatchObject({ profile: 'ballad-v1', barIndex: 103, absBeat: 412 });
	for (const bar of [51, 52, 102, 103]) {
		expect(advanceRollingBacking(take.score, JSON.parse(JSON.stringify(take.windows[bar - 1].checkpoint)))).toEqual(take.windows[bar]);
	}
	expect(() => advanceRollingBacking(take.score, ordinary.windows[102].checkpoint)).toThrow();
	expect(() => advanceRollingBacking(ordinary.score, take.windows[102].checkpoint)).toThrow();
});

it('declines a later melody attack without partially changing any Ballad instrument', () => {
	const melody = [...phrase.notes, { pitch: 64, offset: [103, 2] as [number, number], duration: [1, 4] as [number, number] }];
	const input = { ...params(80), terminalArrangement: { ending: 'hold-release' as const, melody } };
	const rejected = generateBacking(phrase.harmony, BACKING_STYLES.ballad, input);
	const ordinary = generateBacking(phrase.harmony, BACKING_STYLES.ballad, params(80, false));
	for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) expect(rejected[field]).toEqual(ordinary[field]);
	expect(rejected.ensembleDevelopment!.terminalArrangements).toBeUndefined();
});
