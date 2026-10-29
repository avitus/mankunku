import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { generateBacking, type BackingGenerationParams } from '$lib/audio/backing-generation';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession } from '../../helpers/musicality-tune-fixtures';
import baseline from '../../fixtures/audio/terminal-arrangement-before.json';

const { phrase } = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key: 'C', soloChoruses: 2 });
const fields = ['bassEvents', 'compEvents', 'drumEvents'] as const;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Style = keyof typeof BACKING_STYLES;
function params(style: Style): BackingGenerationParams {
	return { phraseId: phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4,
		swing: BACKING_STYLES[style].defaultSwing, performanceForm: phrase.performanceForm,
		sectionMap: phrase.sectionMap, ensemble: {} };
}
function ending(style: Style) {
	return { ...params(style), terminalArrangement: { ending: 'hold-release' as const, melody: phrase.notes } };
}
function rolling(style: Style, input = params(style), loops = 1) {
	const score = createRollingBacking(phrase.harmony, BACKING_STYLES[style], input, { loopCount: loops });
	let checkpoint: RollingBackingCheckpoint | undefined;
	const windows = [];
	for (let bar = 0; bar < score.totalBars; bar++) {
		const window = advanceRollingBacking(score, checkpoint);
		windows.push(window);
		checkpoint = window.checkpoint;
	}
	return { score, windows, bassEvents: windows.flatMap(w => w.bassEvents),
		compEvents: windows.flatMap(w => w.compEvents), drumEvents: windows.flatMap(w => w.drumEvents) };
}

it.each(baseline.controls)('$style $mode $engine preserves the complete continue-time baseline', ({ style: id, mode, engine, expected }) => {
	const style = id as Style;
	const { performanceForm, ensemble, ...common } = params(style);
	const input = { ...common, ...(mode !== 'coordinated-implicit' ? { performanceForm } : {}),
		...(mode !== 'original' ? { ensemble } : {}) };
	const choices = [input, { ...input, terminalArrangement: { ending: 'continue' as const, melody: phrase.notes } },
		...(mode !== 'coordinated-explicit'
			? [{ ...input, terminalArrangement: { ending: 'hold-release' as const, melody: phrase.notes } }] : [])];
	for (const selected of choices) {
		const actual = engine === 'fixed' ? generateBacking(phrase.harmony, BACKING_STYLES[style], selected) : rolling(style, selected);
		for (const field of fields) expect(hash(actual[field])).toBe(expected[field]);
	}
});

it.each(['swing', 'straight'] as const)('%s preserves the first repeat seam and restores the actual terminal reservation', style => {
	const actual = rolling(style, ending(style), 2);
	const control = rolling(style, params(style), 2);
	expect(actual.windows).toHaveLength(104);
	for (let bar = 0; bar < 103; bar++) {
		for (const field of fields) expect(actual.windows[bar][field]).toEqual(control.windows[bar][field]);
	}
	const final = actual.windows[103];
	const piano = final.compEvents;
	expect(piano).toHaveLength(1);
	expect(final.bassEvents).toHaveLength(1);
	expect([...piano, ...final.bassEvents, ...final.drumEvents].map(event => event.time))
		.toEqual(Array(4).fill('79104i'));
	expect(piano[0].duration).toBe(120 / 140);
	expect(final.bassEvents[0].midi % 12).toBe(0);
	for (const bar of [51, 52, 102, 103]) {
		const restored = JSON.parse(JSON.stringify(actual.windows[bar - 1].checkpoint));
		expect(advanceRollingBacking(actual.score, restored)).toEqual(actual.windows[bar]);
	}
	// Opting into a different declared ending must not resume an ordinary score's checkpoint.
	expect(() => advanceRollingBacking(actual.score, control.windows[102].checkpoint)).toThrow();
	expect(() => advanceRollingBacking(control.score, actual.windows[102].checkpoint)).toThrow();
});

it.each(['bossa-nova'] as const)('%s retains its exact native ending when the known melody makes a hold unavailable', style => {
	const before = baseline.finalBars.find(value => value.style === style)!;
	const melody = [...phrase.notes, { pitch: 64, offset: [103, 2] as [number, number], duration: [1, 4] as [number, number] }];
	const unavailable = { ...params(style), terminalArrangement: { ending: 'hold-release' as const, melody } };
	const fixed = generateBacking(phrase.harmony, BACKING_STYLES[style], unavailable);
	const causal = rolling(style, unavailable);
	expect(fixed.ensembleDevelopment!.terminalArrangements).toBeUndefined();
	expect(causal.windows.at(-1)!.ensembleDevelopment.terminalArrangements).toBeUndefined();
	for (const field of fields) {
		expect(fixed[field].filter(event => event.absBeat >= 204)).toEqual(before.fixed[field]);
		expect(causal[field].filter(event => event.absBeat >= 204)).toEqual(before.rolling[field]);
		expect(fixed[field]).toEqual(generateBacking(phrase.harmony, BACKING_STYLES[style], params(style))[field]);
		expect(causal[field]).toEqual(rolling(style)[field]);
	}
});

it.each(['swing', 'straight'] as const)('%s keeps accepted terminal evidence and actual pitch memories honest', style => {
	const take = rolling(style, ending(style));
	const final = take.windows.at(-1)!;
	const plan = final.ensemblePlan.bars[0];
	const reservation = plan.terminalArrangement!;
	expect(reservation).toMatchObject({ version: 1, barIndex: 51, absBeat: 204, releaseBeat: 206,
		holdBeats: 2, participants: ['bass', 'piano', 'drums'], chord: { root: 'C', quality: 'maj6' } });
	expect(plan.bass.keepPulse).toBe(false);
	expect(plan.drums.keepTime).toBe(false);
	expect(final.ensembleDevelopment.terminalArrangements).toEqual([{
		version: 1, reservationId: reservation.id, barIndex: 51, status: 'accepted',
		bass: final.bassEvents[0], piano: final.compEvents[0], drums: final.drumEvents
	}]);
	expect(final.checkpoint.bass.previousMidi).toBe(final.bassEvents[0].midi);
	expect(final.checkpoint.piano.voicing?.notes).toEqual(final.compEvents[0].notes);
	expect(final.ensembleDevelopment.pianoVoicings).toHaveLength(1);
	expect(final.ensembleDevelopment.pianoVoicings![0]).toMatchObject({
		time: final.compEvents[0].time, notes: final.compEvents[0].notes, absBeat: 204
	});
	expect(Object.isFrozen(final.ensembleDevelopment.terminalArrangements![0])).toBe(true);
	const fixed = generateBacking(phrase.harmony, BACKING_STYLES[style], ending(style));
	expect(fixed.ensemblePlan!.bars[51].terminalArrangement).toEqual(reservation);
	expect(fixed.ensembleDevelopment!.terminalArrangements![0]).toMatchObject({
		status: 'accepted', reservationId: reservation.id, barIndex: 51
	});
});

it.each(['swing', 'straight'] as const)('%s respects the actual sustained closing melody and declines a later new melody attack', style => {
	const melody = structuredClone(phrase.notes);
	melody.at(-1)!.duration = [3, 4]; // The already tied C4 now releases at beat207.
	const held = rolling(style, { ...ending(style), terminalArrangement: { ending: 'hold-release', melody } });
	const final = held.windows.at(-1)!;
	expect(final.ensemblePlan.bars[0].terminalArrangement?.releaseBeat).toBe(207);
	expect(final.bassEvents[0].duration).toBe(180 / 140);
	expect(final.compEvents[0].duration).toBe(180 / 140);
	const lateMelody = [...phrase.notes, { pitch: 64, offset: [103, 2] as [number, number], duration: [1, 4] as [number, number] }];
	const rejected = rolling(style, { ...ending(style), terminalArrangement: { ending: 'hold-release', melody: lateMelody } });
	const ordinary = rolling(style);
	for (const field of fields) expect(rejected[field]).toEqual(ordinary[field]);
	expect(rejected.windows.at(-1)!.ensembleDevelopment.terminalArrangements).toBeUndefined();
});
