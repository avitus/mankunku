import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { generateBacking } from '$lib/audio/backing-generation';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildHistoricalListeningTuneSession as buildListeningTuneSession } from '../../helpers/musicality-tune-fixtures';
import baseline from '../../fixtures/audio/bass-approach-handoff-before.json';

const styles = ['swing', 'straight'] as const;
const { phrase } = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key: 'C', soloChoruses: 2 });
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function params(style: keyof typeof BACKING_STYLES) {
	return {
		phraseId: phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4,
		swing: BACKING_STYLES[style].defaultSwing, performanceForm: phrase.performanceForm,
		sectionMap: phrase.sectionMap, ensemble: {}
	};
}
function take(style: keyof typeof BACKING_STYLES, loops = 1) {
	const score = createRollingBacking(phrase.harmony, BACKING_STYLES[style], params(style), { loopCount: loops });
	let checkpoint: RollingBackingCheckpoint | undefined;
	const windows = [];
	for (let bar = 0; bar < score.totalBars; bar++) {
		const window = advanceRollingBacking(score, checkpoint);
		windows.push(window);
		checkpoint = window.checkpoint;
	}
	return {
		score, windows, bassEvents: windows.flatMap(w => w.bassEvents),
		compEvents: windows.flatMap(w => w.compEvents), drumEvents: windows.flatMap(w => w.drumEvents)
	};
}

it.each(styles)('%s reaches the actual Blues approach without the avoidable eighteen-semitone handoff', style => {
	const old = baseline.witnesses.find(w => w.style === style)!;
	const actual = take(style);
	const route = actual.bassEvents.filter(event => event.absBeat >= 104 && event.absBeat <= 108);
	const before = old.bassEvents.filter(event => event.absBeat >= 104 && event.absBeat <= 108);
	expect(before.map(event => event.midi)).toEqual([48, 52, 55, 37, 36]);
	expect(route.map(event => event.absBeat)).toEqual([104, 105, 106, 107, 108]);
	expect([route[0].midi, route[3].midi, route[4].midi]).toEqual([48, 37, 36]);
	// A legal bridge is required; the fixed renderer's exact route is not prescribed.
	for (let i = 1; i < route.length; i++) expect(Math.abs(route[i].midi - route[i - 1].midi)).toBeLessThanOrEqual(5);
	expect([0, 2, 3, 4, 7, 9]).toContain(route[1].midi % 12); // C major blues.
	expect([0, 4, 7, 10]).toContain(route[2].midi % 12); // Strong C7 quarter.
	for (const event of route) expect(event.midi).toBeGreaterThanOrEqual(28);
	for (const event of route) expect(event.midi).toBeLessThanOrEqual(55);
	expect(actual.bassEvents.map(({ midi: _midi, ...event }) => event))
		.toEqual(old.bassEvents.map(({ midi: _midi, ...event }) => event));
	expect(hash(actual.compEvents)).toBe(old.expected.compEvents);
	expect(hash(actual.drumEvents)).toBe(old.expected.drumEvents);
	expect(actual.windows[26].checkpoint.bass).toMatchObject({
		previousMidi: 37, previousPreviousMidi: route[2].midi,
		direction: Math.sign(37 - route[2].midi), segmentAnchor: 48, nextTarget: 36,
		approach: old.barBassMemory.approach, feel: 'four', pendingLaunch: null
	});
	expect(actual.windows[27].bassEvents[0].midi).toBe(36);
});

it.each(baseline.controls)('$style $mode $engine preserves the complete unscoped Blues performance', ({ style: id, mode, engine, expected }) => {
	const style = id as keyof typeof BACKING_STYLES;
	const { performanceForm, ensemble, ...common } = params(style);
	const input = {
		...common, ...(mode !== 'coordinated-implicit' ? { performanceForm } : {}),
		...(mode !== 'original' ? { ensemble } : {})
	};
	const score = engine === 'rolling' ? createRollingBacking(phrase.harmony, BACKING_STYLES[style], input) : undefined;
	let checkpoint: RollingBackingCheckpoint | undefined;
	const windows = [];
	for (let bar = 0; bar < (score?.totalBars ?? 0); bar++) {
		const window = advanceRollingBacking(score!, checkpoint);
		windows.push(window);
		checkpoint = window.checkpoint;
	}
	const actual = score ? {
		bassEvents: windows.flatMap(w => w.bassEvents), compEvents: windows.flatMap(w => w.compEvents),
		drumEvents: windows.flatMap(w => w.drumEvents)
	} : generateBacking(phrase.harmony, BACKING_STYLES[style], input);
	for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) expect(hash(actual[field])).toBe(expected[field]);
});

it.each(styles)('%s restores actual bass history through the handoff and complete form loops', style => {
	const actual = take(style, 2);
	expect(actual.windows).toHaveLength(104);
	let restored: RollingBackingCheckpoint | undefined;
	for (let bar = 0; bar < actual.windows.length; bar++) {
		const window = actual.windows[bar];
		if ([25, 26, 27, 51, 52, 77, 78, 79].includes(bar)) {
			restored = JSON.parse(JSON.stringify(actual.windows[bar - 1].checkpoint));
		}
		if (restored) {
			const replay = advanceRollingBacking(actual.score, restored);
			expect(replay).toEqual(window);
			restored = replay.checkpoint;
		}
		const pulses = window.bassEvents.filter(event => Number.isInteger(event.absBeat));
		if (pulses.length) expect(window.checkpoint.bass.previousMidi).toBe(pulses.at(-1)!.midi);
		if (pulses.length > 1) expect(window.checkpoint.bass.previousPreviousMidi).toBe(pulses.at(-2)!.midi);
	}
	const single = take(style);
	// Closing-phrase piano/drum choices may depend on the declared final loop;
	// the earlier bass handoff and source pulse prefix remain stable.
	for (let bar = 0; bar < 51; bar++) {
		expect(actual.windows[bar].bassEvents).toEqual(single.windows[bar].bassEvents);
	}
	const previous = single.windows[25].checkpoint;
	expect(advanceRollingBacking(single.score, previous, [{
		barIndex: 30, observedAtBar: 29, source: 'scripted', confidence: .95, noteDensity: .9, restBeats: 0
	}])).toEqual(single.windows[26]);
});

it.each(styles)('%s rejects the actual valid-checksum checkpoint from the older handoff policy', style => {
	const old = baseline.witnesses.find(w => w.style === style)!;
	const score = createRollingBacking(phrase.harmony, BACKING_STYLES[style], params(style));
	expect(() => advanceRollingBacking(score, JSON.parse(JSON.stringify(old.priorCheckpoint)))).toThrow();
});
