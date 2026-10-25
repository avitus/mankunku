import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { generateBacking } from '$lib/audio/backing-generation';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { resolveCoordinatedVoicing } from '$lib/audio/coordinated-voicing';
import { seedFrom } from '$lib/audio/generation-rng';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import baseline from '../../fixtures/audio/piano-phrase-recall-before.json';

const styles = ['swing', 'straight'] as const;
const { phrase } = buildListeningTuneSession({ tuneId: 'ls-when-the-saints', key: 'Eb', soloChoruses: 2 });
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function params(style: keyof typeof BACKING_STYLES) {
	return { phraseId: phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4,
		swing: BACKING_STYLES[style].defaultSwing, performanceForm: phrase.performanceForm,
		sectionMap: phrase.sectionMap, ensemble: {} };
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
	return { score, windows, bassEvents: windows.flatMap(w => w.bassEvents),
		compEvents: windows.flatMap(w => w.compEvents), drumEvents: windows.flatMap(w => w.drumEvents) };
}

it.each(styles)('%s recalls the actually played Saints cell into the next solo phrase using its current harmony', style => {
	const old = baseline.witnesses.find(w => w.style === style)!;
	const actual = take(style);
	for (let bar = 20; bar < 24; bar++) expect(actual.windows[bar].compEvents).toEqual(old.bars[bar - 20].compEvents);
	expect(actual.windows[24].compEvents).toHaveLength(1);
	expect(old.bars[4].compEvents[0].absBeat).toBe(99.5);
	// A real rhythmic change proves recall; a new label alone cannot satisfy this.
	expect(actual.windows[24].compEvents[0].absBeat).toBe(97.5);
	expect(actual.windows[24].checkpoint.piano.voicing!.chord).toEqual({ root: 'Eb', quality: 'maj6' });
	expect(actual.windows[24].checkpoint.piano.voicing!.notes).toEqual(actual.windows[24].compEvents[0].notes);
	expect(actual.windows[24].compEvents[0].velocity).toBe(old.bars[4].compEvents[0].velocity);
	const recalled = actual.windows[24];
	const voicing = recalled.ensembleDevelopment.pianoVoicings![0];
	const planned = recalled.ensemblePlan.bars[0];
	const resolved = resolveCoordinatedVoicing({ chord: { root: 'Eb', quality: 'maj6' },
		family: voicing.decision.requestedFamily, previous: actual.windows[23].checkpoint.piano.voicing,
		registerMidi: voicing.decision.requestedFamily === 'guide' ? 62 : Math.round(58 + 8 * planned.energy),
		rootlessTexture: planned.piano.rootlessTexture?.request,
		...(voicing.decision.topLine ? { targetTopMidi: voicing.decision.topLine.targetMidi } : {}) });
	expect(recalled.compEvents[0].notes).toEqual(resolved.notes);
	expect(voicing.decision).toEqual(resolved.decision);
	expect(recalled.ensembleDevelopment.pianoMotifs![0].recall).toMatchObject({
		source: { barIndex: 20, phraseStartBar: 20, figureId: 'and2-only', attacks: actual.windows[20].compEvents },
		attacks: recalled.compEvents
	});
	expect(actual.windows[25].compEvents).toEqual([]);
	expect(hash(actual.bassEvents)).toBe(old.expected.bassEvents);
	expect(hash(actual.drumEvents.filter(event => event.role === 'timekeeping'))).toBe(old.expected.timekeeping);
});

it.each(baseline.controls)('$style $mode $engine preserves the complete unscoped performance', ({ style: id, mode, engine, expected }) => {
	const style = id as keyof typeof BACKING_STYLES;
	const { performanceForm, ensemble, ...common } = params(style);
	const input = { ...common, ...(mode !== 'coordinated-implicit' ? { performanceForm } : {}),
		...(mode !== 'original' ? { ensemble } : {}) };
	const score = engine === 'rolling' ? createRollingBacking(phrase.harmony, BACKING_STYLES[style], input) : undefined;
	let checkpoint: RollingBackingCheckpoint | undefined;
	const windows = [];
	for (let bar = 0; bar < (score?.totalBars ?? 0); bar++) {
		const window = advanceRollingBacking(score!, checkpoint);
		windows.push(window); checkpoint = window.checkpoint;
	}
	const actual = score ? { bassEvents: windows.flatMap(w => w.bassEvents), compEvents: windows.flatMap(w => w.compEvents),
		drumEvents: windows.flatMap(w => w.drumEvents) } : generateBacking(phrase.harmony, BACKING_STYLES[style], input);
	for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) expect(hash(actual[field])).toBe(expected[field]);
});

it.each(styles)('%s restores actual source and recalled history across both complete tune loops', style => {
	const actual = take(style, 2);
	let restored: RollingBackingCheckpoint | undefined;
	let recalled = 0;
	for (let bar = 0; bar < actual.windows.length; bar++) {
		const window = actual.windows[bar];
		if ([19, 20, 23, 24, 63, 64].includes(bar)) restored = JSON.parse(JSON.stringify(bar ? actual.windows[bar - 1].checkpoint : undefined));
		if (restored) {
			const replay = advanceRollingBacking(actual.score, restored);
			expect(replay).toEqual(window);
			restored = replay.checkpoint;
		}
		if (window.compEvents.length) expect(window.checkpoint.piano.voicing!.notes).toEqual(window.compEvents.at(-1)!.notes);
		else if (bar) expect(window.checkpoint.piano.voicing).toEqual(actual.windows[bar - 1].checkpoint.piano.voicing);
		for (const motif of window.ensembleDevelopment.pianoMotifs ?? []) {
			if (!motif.recall) continue;
			recalled++;
			expect(motif.recall.attacks).toEqual(window.compEvents);
			expect(motif.recall.source.phraseStartBar).toBe(motif.phraseStartBar - 4);
			expect(motif.recall.source.loopIndex).toBe(window.loopIndex);
			expect(actual.windows[motif.recall.source.barIndex].compEvents).toEqual(motif.recall.source.attacks);
			expect(actual.windows[motif.recall.source.barIndex].ensembleDevelopment.pianoMotifs![0].recall).toBeUndefined();
		}
		if ([0, 16, 32, 48, 64, 80, 96, 112].includes(bar)) expect(window.ensembleDevelopment.pianoMotifs![0].recall).toBeUndefined();
	}
	expect(recalled).toBeGreaterThanOrEqual(1);
	expect(actual.windows.at(-1)!.checkpoint.nextBar).toBe(128);
});

it.each(styles)('%s needs the actually retained source and cannot import future evidence into a recall', style => {
	const actual = take(style);
	const previous = actual.windows[23].checkpoint;
	const recalled = advanceRollingBacking(actual.score, previous);
	const future = [{ barIndex: 30, observedAtBar: 29, source: 'scripted' as const, confidence: .95, noteDensity: .9, restBeats: 0 }];
	expect(advanceRollingBacking(actual.score, previous, future)).toEqual(recalled);
	const copied: RollingBackingCheckpoint = JSON.parse(JSON.stringify(previous));
	const { checkpointId: _id, ...state } = copied;
	const withoutSource = { ...state, piano: { ...state.piano,
		phraseRecall: { version: 1 as const, source: null, recalledAt: null } } };
	const blank = { ...withoutSource, checkpointId: `${withoutSource.sessionId}:${withoutSource.nextBar}:${seedFrom(JSON.stringify(withoutSource)).toString(16)}` };
	const ordinary = advanceRollingBacking(actual.score, blank);
	const old = baseline.witnesses.find(w => w.style === style)!;
	expect(ordinary.compEvents).toEqual(old.bars[4].compEvents);
	expect(ordinary.ensembleDevelopment.pianoMotifs![0].recall).toBeUndefined();
	expect(ordinary.bassEvents).toEqual(recalled.bassEvents);
	expect(ordinary.drumEvents.filter(event => event.role === 'timekeeping'))
		.toEqual(recalled.drumEvents.filter(event => event.role === 'timekeeping'));
	const dense = advanceRollingBacking(actual.score, previous,
		[{ barIndex: 24, observedAtBar: 23, source: 'scripted', confidence: .95, noteDensity: .9, restBeats: 0 }]);
	expect(dense.ensembleDevelopment.pianoMotifs![0].recall).toBeUndefined();
	expect(dense.compEvents.length).toBeLessThanOrEqual(dense.ensemblePlan.bars[0].piano.maxAttacks);
	expect(dense.checkpoint.piano.phraseRecall?.recalledAt).not.toBe(24);
});
