import { expect, it } from 'vitest';
import { generateBacking, type BackingGenerationParams } from '$lib/audio/backing-generation';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import baseline from '../../fixtures/audio/bossa-terminal-before.json';

const style = BACKING_STYLES['bossa-nova'];
const fields = ['bassEvents', 'compEvents', 'drumEvents'] as const;
function session(key: string) {
	return buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key: key === 'C' ? 'C' : 'F#', soloChoruses: 2 });
}
function params(key: string, hold = true): BackingGenerationParams {
	const { phrase } = session(key);
	return { phraseId: phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4, swing: style.defaultSwing,
		performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {},
		...(hold ? { terminalArrangement: { ending: 'hold-release' as const, melody: phrase.notes } } : {}) };
}
function rolling(key: string, hold = true, loopCount = 1) {
	const score = createRollingBacking(session(key).phrase.harmony, style, params(key, hold), { loopCount });
	let checkpoint: RollingBackingCheckpoint | undefined;
	const windows = [];
	for (let bar = 0; bar < score.totalBars; bar++) {
		const next = advanceRollingBacking(score, checkpoint);
		windows.push(next); checkpoint = next.checkpoint;
	}
	return { score, windows, bassEvents: windows.flatMap(w => w.bassEvents),
		compEvents: windows.flatMap(w => w.compEvents), drumEvents: windows.flatMap(w => w.drumEvents) };
}

it.each(baseline.witnesses)('Bossa $key $engine holds with its actually selected native clave-side downbeat', ({ key, engine, lastTwoBars }) => {
	const take = engine === 'fixed' ? generateBacking(session(key).phrase.harmony, style, params(key)) : rolling(key);
	const bass = take.bassEvents.filter(event => event.absBeat >= 204);
	const piano = take.compEvents.filter(event => event.absBeat >= 204);
	const drums = take.drumEvents.filter(event => event.absBeat >= 204);
	expect(piano).toHaveLength(1);
	expect(bass).toHaveLength(1);
	const nativeDownbeat = lastTwoBars.drumEvents.filter(event => event.absBeat === 204);
	expect(drums.map(event => ({ drum: event.drum, velocity: event.velocity })))
		.toEqual(nativeDownbeat.map(event => ({ drum: event.drum, velocity: event.velocity })));
	expect(drums.map(event => event.drum)).toEqual(key === 'C' ? ['kick', 'hihat', 'crossstick'] : ['kick', 'hihat']);
	expect([...bass, ...piano, ...drums].every(event => event.absBeat === 204 && event.time === '39168i')).toBe(true);
	expect(drums.every(event => event.role === 'accent')).toBe(true);
	expect(bass[0].velocity).toBe(lastTwoBars.bassEvents.find(event => event.absBeat === 204)!.velocity);
	expect(bass[0].midi % 12).toBe(key === 'C' ? 0 : 6);
	expect(bass[0].duration).toBe(120 / 140);
	expect(piano[0].duration).toBe(120 / 140);
	expect(piano[0].velocity).toBeGreaterThanOrEqual(50);
	expect(piano[0].velocity).toBeLessThanOrEqual(60);
	const ordinary = engine === 'fixed' ? generateBacking(session(key).phrase.harmony, style, params(key, false)) : rolling(key, false);
	for (const field of fields) {
		expect(take[field].filter(event => event.absBeat < 204)).toEqual(ordinary[field].filter(event => event.absBeat < 204));
		expect(take[field].filter(event => event.absBeat >= 200 && event.absBeat < 204)).toEqual(lastTwoBars[field].filter(event => event.absBeat < 204));
	}
});

it.each(['C', 'F#'])('Bossa %s commits the real final harmony and existing contour without Swing dialogue or false ride evidence', key => {
	const take = rolling(key);
	const final = take.windows.at(-1)!;
	const plan = final.ensemblePlan.bars[0];
	const reservation = plan.terminalArrangement!;
	expect(reservation).toMatchObject({ profile: 'bossa-v1', barIndex: 51, absBeat: 204, releaseBeat: 206 });
	expect(plan.bass.keepPulse).toBe(false);
	expect(plan.drums.keepTime).toBe(false);
	expect(final.ensembleDevelopment.terminalArrangements).toEqual([{
		version: 1, reservationId: reservation.id, barIndex: 51, status: 'accepted',
		bass: final.bassEvents[0], piano: final.compEvents[0], drums: final.drumEvents
	}]);
	expect(final.checkpoint.piano.voicing?.chord).toEqual(reservation.chord);
	expect(final.checkpoint.piano.voicing?.notes).toEqual(final.compEvents[0].notes);
	const priorContour = take.windows[50].checkpoint.piano.contour!;
	expect(plan.performanceEnergy!.phase).toBe('ending');
	const samePhrase = priorContour.phraseStartBar === plan.phraseStartBar &&
		priorContour.chorusIndex === plan.performanceEnergy!.chorusIndex;
	// F-sharp has no earlier accepted chord in this phrase: its first actual
	// closing attack latches the settling target from the prior emitted top.
	const expectedTarget = samePhrase ? priorContour.targetMidi : Math.max(48, priorContour.lastTopMidi - 2);
	expect(final.checkpoint.piano.contour).toMatchObject({ version: 1, lastBarIndex: 51,
		lastTopMidi: final.compEvents[0].notes.at(-1), targetMidi: expectedTarget });
	expect(final.ensembleDevelopment.pianoVoicings).toHaveLength(1);
	expect(final.ensembleDevelopment.pianoVoicings![0]).toMatchObject({
		time: final.compEvents[0].time, absBeat: 204, notes: final.compEvents[0].notes
	});
	expect(final.checkpoint.bass.previousMidi).toBe(final.bassEvents[0].midi);
	expect(final.checkpoint.drums.previousCompOnsets).toEqual([0]);
	expect(final.checkpoint.drums.previousCompIsSharedArrival).toBe(true);
	const drumTrace = final.ensembleDevelopment.drumPhrases[0];
	expect(drumTrace.style).toBe('bossa-nova');
	expect(drumTrace.ride).toMatchObject({ mode: 'none', onsets: [] });
	expect(drumTrace.ride).not.toHaveProperty('voice');
	expect(drumTrace.hits.map(hit => ({ drum: hit.drum, velocity: hit.velocity, beatOffset: hit.beatOffset })))
		.toEqual(final.drumEvents.map(event => ({ drum: event.drum, velocity: event.velocity, beatOffset: 0 })));
	for (const window of take.windows) {
		expect(window.checkpoint.piano).not.toHaveProperty('phraseRecall');
		for (const field of ['pianoAnswer', 'pianoRecovery']) expect(window.checkpoint).not.toHaveProperty(field);
		for (const field of ['pianoAnswers', 'pianoRecoveries', 'bassContinuations']) expect(window.ensembleDevelopment).not.toHaveProperty(field);
		expect(window.checkpoint.drums).not.toHaveProperty('previousCompIsDrumReply');
	}
	expect(Object.isFrozen(final.ensembleDevelopment.terminalArrangements![0])).toBe(true);
	expect(advanceRollingBacking(take.score, JSON.parse(JSON.stringify(take.windows[50].checkpoint)))).toEqual(final);
	expect(() => advanceRollingBacking(take.score, JSON.parse(JSON.stringify(final.checkpoint)))).toThrow('complete');
});

it.each(['C', 'F#'])('Bossa %s keeps its first clave seam intact and reserves only the last declared loop', key => {
	const take = rolling(key, true, 2);
	const ordinary = rolling(key, false, 2);
	for (let bar = 0; bar < 103; bar++) {
		for (const field of fields) expect(take.windows[bar][field]).toEqual(ordinary.windows[bar][field]);
		expect(take.windows[bar].ensembleDevelopment.terminalArrangements).toBeUndefined();
	}
	const final = take.windows[103];
	expect(final.compEvents).toHaveLength(1);
	expect(final.bassEvents).toHaveLength(1);
	expect([...final.bassEvents, ...final.compEvents, ...final.drumEvents].every(event => event.time === '79104i')).toBe(true);
	expect(final.ensemblePlan.bars[0].terminalArrangement).toMatchObject({ profile: 'bossa-v1', barIndex: 103, absBeat: 412 });
	const ordinaryDownbeat = ordinary.windows[103].drumEvents.filter(event => event.absBeat === 412);
	expect(final.drumEvents.map(event => ({ drum: event.drum, velocity: event.velocity })))
		.toEqual(ordinaryDownbeat.map(event => ({ drum: event.drum, velocity: event.velocity })));
	for (const bar of [51, 52, 102, 103]) {
		expect(advanceRollingBacking(take.score, JSON.parse(JSON.stringify(take.windows[bar - 1].checkpoint)))).toEqual(take.windows[bar]);
	}
	expect(() => advanceRollingBacking(take.score, ordinary.windows[102].checkpoint)).toThrow();
	expect(() => advanceRollingBacking(ordinary.score, take.windows[102].checkpoint)).toThrow();
});
