import { expect, it } from 'vitest';
import { preparePianoContour, commitPianoContour, validatePianoContourMemory, type PianoContourContext } from '$lib/audio/backing-piano-contour';
import { resolveCoordinatedVoicing, type CoordinatedVoicingFamily } from '$lib/audio/coordinated-voicing';
import { PITCH_CLASSES, type ChordQuality } from '$lib/types/music';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { realizeRollingPiano } from '$lib/audio/backing-rolling-piano';
import { buildPerformanceForm } from '$lib/audio/performance-form';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { seedFrom } from '$lib/audio/generation-rng';

const initial: PianoContourContext = { barIndex: 0, phraseStartBar: 0, chorusIndex: 0, phase: 'head_in' };
it('anchors the first accepted top without speculative notes and locks one intention through a phrase', () => {
	const first = preparePianoContour(initial);
	expect(first).toEqual({ direction: 'hold' });
	const a = commitPianoContour(initial, first, [55, 60, 70]);
	expect(a.targetMidi).toBe(70);
	const build: PianoContourContext = { barIndex: 5, phraseStartBar: 4, chorusIndex: 1, phase: 'solo_build' };
	const next = preparePianoContour(build, a);
	expect(next).toEqual({ targetMidi: 72, direction: 'rise' });
	// Preparing a silent/rejected phrase does not mutate or latch the input memory.
	expect(a.lastBarIndex).toBe(0);
	expect(preparePianoContour({ ...build, phase: 'solo_peak' }, a)).toEqual({ targetMidi: 70, direction: 'hold' });
	const guide = commitPianoContour(build, next, [55, 60]);
	expect(guide.lastTopMidi).toBe(60);
	expect(preparePianoContour({ ...build, barIndex: 6, phase: 'solo_release' }, guide)).toEqual(next);
	const returning = { ...build, barIndex: 8, phraseStartBar: 8, chorusIndex: 2, phase: 'head_return' as const };
	expect(preparePianoContour(returning, guide)).toEqual({ targetMidi: 58, direction: 'settle' });
	expect(Object.isFrozen(guide)).toBe(true);
	expect(preparePianoContour(returning, JSON.parse(JSON.stringify(guide)))).toEqual(preparePianoContour(returning, guide));
});

it('bounds structural directions to legal piano range and treats chorus changes as a new latch', () => {
	for (const [phase, direction, offset] of [
		['head_in', 'hold', 0], ['solo_build', 'rise', 2], ['solo_peak', 'hold', 0],
		['solo_release', 'settle', -2], ['head_return', 'settle', -2], ['ending', 'settle', -2]
	] as const) {
		for (const top of [48, 60, 84]) {
			const memory = commitPianoContour(initial, preparePianoContour(initial), [top - 1, top]);
			expect(preparePianoContour({ ...initial, barIndex: 1, chorusIndex: 1, phase }, memory))
				.toEqual({ targetMidi: Math.max(48, Math.min(84, top + offset)), direction });
		}
	}
});

it('never trades away guide movement, common-note count, minimum movement or selected harmonic identity for a top target', () => {
	const previous = { version: 1 as const, chord: { root: 'D' as const, quality: 'min7' as const }, notes: [53, 60, 64, 69] };
	const families: CoordinatedVoicingFamily[] = ['rootless-a', 'rootless-b', 'shell', 'drop2', 'guide', 'quartal'];
	for (const root of PITCH_CLASSES) for (const quality of ['maj7', 'min7', '7', '7b9', '7#9', 'dim7'] as ChordQuality[]) for (const family of families) {
		const input = { chord: { root, quality }, family, registerMidi: 63, previous };
		const baseline = resolveCoordinatedVoicing(input);
		for (const targetTopMidi of [48, 60, 72, 84]) {
			const actual = resolveCoordinatedVoicing({ ...input, targetTopMidi });
			expect(actual.decision.guideMotion).toBe(baseline.decision.guideMotion);
			expect(actual.decision.commonTones).toHaveLength(baseline.decision.commonTones.length);
			expect(actual.decision.totalMovement).toBe(baseline.decision.totalMovement);
			expect(actual.decision.resolvedFamily).toBe(baseline.decision.resolvedFamily);
			expect(actual.notes.map(note => note % 12).sort((a, b) => a - b))
				.toEqual(baseline.notes.map(note => note % 12).sort((a, b) => a - b));
			expect(actual.notes.length).toBe(baseline.notes.length);
			if (family === 'guide' || family === 'quartal') {
				expect(actual.notes).toEqual(baseline.notes);
				expect(actual.decision.topLine!.eligible).toBe(false);
			}
			expect(Object.isFrozen(actual.decision.topLine)).toBe(true);
		}
	}
});

it('preserves a repeated defining-tone chord when no equally ranked moving top is available', () => {
	const input = { chord: { root: 'F#' as const, quality: 'maj6' as const }, family: 'rootless-b' as const, registerMidi: 63 };
	const previous = resolveCoordinatedVoicing(input);
	const current = resolveCoordinatedVoicing({ ...input, previous: previous.memory, targetTopMidi: 84 });
	expect(current.notes).toEqual(previous.notes);
	expect(current.decision.topLine!.actualMidi).toBe(previous.notes.at(-1));
	expect(current.decision.topLine!.distance).toBeGreaterThan(0);
	for (const targetTopMidi of [47, 85, 60.5, NaN, Infinity]) {
		expect(() => resolveCoordinatedVoicing({ ...input, targetTopMidi })).toThrow(/voicing input/);
	}
});

const { phrase } = buildListeningTuneSession({ tuneId: 'ls-when-the-saints', key: 'Eb', soloChoruses: 2 });
const score = createRollingBacking(phrase.harmony, BACKING_STYLES.swing, {
	phraseId: phrase.id, tempo: 140, ppq: 192, swing: 0.67, beatsPerBar: 4,
	performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {}
});

function rebind(checkpoint: RollingBackingCheckpoint): RollingBackingCheckpoint {
	const { checkpointId: _, ...contents } = checkpoint;
	return { ...contents, checkpointId: `${contents.sessionId}:${contents.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}` };
}

it('does not advance or latch a phrase for rejected rolling attacks', () => {
	const first = advanceRollingBacking(score);
	const info = { ...score.bars[0], ensemble: first.ensemblePlan.bars[0], intensity: first.ensemblePlan.bars[0].energy };
	const rejected = realizeRollingPiano(score, 0, info, { place: () => 4 * 192, arrivalTick: () => 4 * 192, trace: [] });
	expect(rejected.events).toEqual([]);
	expect(rejected.memory.contour).toBeUndefined();
	expect(rejected.memory.voicing).toBeUndefined();
});

it('validates scoped actual-top memory and rejects old policy even with a correct checksum', () => {
	let checkpoint: RollingBackingCheckpoint | undefined;
	for (let bar = 0; bar < 4; bar++) checkpoint = advanceRollingBacking(score, checkpoint).checkpoint;
	const memory = checkpoint!.piano.contour!;
	expect(memory.lastTopMidi).toBe(checkpoint!.piano.lastVoicing.at(-1));
	expect(() => validatePianoContourMemory(memory, checkpoint!.nextBar, checkpoint!.piano.lastVoicing)).not.toThrow();
	for (const bad of [undefined, { ...memory, version: 2 }, { ...memory, targetMidi: 85 }, { ...memory, lastTopMidi: memory.lastTopMidi + 1 },
		{ ...memory, direction: 'random' }, { ...memory, lastBarIndex: checkpoint!.nextBar }, { ...memory, chorusIndex: 999 },
		{ ...memory, chorusIndex: 1 }, { ...memory, phraseStartBar: 1 }, { ...memory, phraseStartBar: 999 }]) {
		expect(() => advanceRollingBacking(score, rebind({ ...checkpoint!, piano: { ...checkpoint!.piano, contour: bad } } as RollingBackingCheckpoint))).toThrow(/checkpoint/);
	}
	const binding = JSON.parse(score.fingerprint);
	const policy = binding.find((entry: unknown) => entry && typeof entry === 'object' && 'pianoContourVersion' in entry);
	expect(policy.pianoContourVersion).toBe(1);
	delete policy.pianoContourVersion;
	expect(() => advanceRollingBacking(score, rebind({ ...checkpoint!, fingerprint: JSON.stringify(binding) }))).toThrow(/checkpoint/);
});


it('keeps actual phrase identity valid through short, off-grid sections and declared loop seams', () => {
	const form = buildPerformanceForm({ totalBars: 10,
		sectionMap: [{ sourceSection: 0, barOffset: 0 }, { sourceSection: 1, barOffset: 3 }, { sourceSection: 2, barOffset: 7 }],
		choruses: [{ role: 'solo', startBar: 0, endBarExclusive: 10 }] });
	const shortScore = createRollingBacking([{ chord: { root: 'C', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [0, 1], duration: [10, 1] }], BACKING_STYLES.swing,
		{ phraseId: 'contour-short-sections', tempo: 140, ppq: 192, swing: 0.67, beatsPerBar: 4, performanceForm: form, ensemble: {} }, { loopCount: 2 });
	let checkpoint: RollingBackingCheckpoint | undefined;
	let accepted = 0;
	for (let bar = 0; bar < shortScore.totalBars; bar++) {
		const result = advanceRollingBacking(shortScore, checkpoint);
		if (checkpoint) expect(advanceRollingBacking(shortScore, JSON.parse(JSON.stringify(checkpoint)))).toEqual(result);
		if (result.compEvents.length) {
			accepted++;
			expect(result.checkpoint.piano.contour!.phraseStartBar).toBe(result.ensemblePlan.bars[0].phraseStartBar);
			expect(result.checkpoint.piano.contour!.chorusIndex).toBe(shortScore.bars[bar].chorusIndex);
		}
		checkpoint = result.checkpoint;
	}
	expect(accepted).toBeGreaterThan(0);
});
