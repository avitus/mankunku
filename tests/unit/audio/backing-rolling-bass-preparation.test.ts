import { describe, expect, it, vi } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint, type RollingBackingDefinition } from '$lib/audio/backing-rolling';
import { prepareRollingBass } from '$lib/audio/backing-rolling-bass';
import * as bassGeneration from '$lib/audio/backing-bass';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import type { SoloFeature } from '$lib/audio/ensemble-plan';
import { buildNativeBluesFixture } from '../../fixtures/musicality-native-blues';

const styles = ['swing', 'straight', 'bossa-nova', 'ballad'] as const;
function make(style: typeof styles[number], loopCount = 1) {
	const phrase = buildNativeBluesFixture(), tempo = style === 'ballad' ? 80 : 140;
	return createRollingBacking(phrase.harmony, BACKING_STYLES[style], {
		phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: resolveBackingSwing(.67, BACKING_STYLES[style], tempo),
		sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {}
	}, { returningMelodySpace: true, performanceEnergySeed: 42, pianoPresence: 'accompaniment', keyboardVariety: 'developed',
		chorusBoundaryPriority: true, keyboardTexture: true, keyboardPhrasing: 'piano', bassDelayedRoot: true,
		keyboardContraryMotion: true, drumPhraseCushioning: true, loopCount });
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const features = (bar: number, mode: 'dense' | 'rest'): SoloFeature[] => bar % 7 === 2
	? [{ barIndex: bar, observedAtBar: bar - 1, source: 'microphone', confidence: .95,
		noteDensity: mode === 'dense' ? 1 : 0, restBeats: mode === 'dense' ? 0 : 4, phraseEnded: mode === 'rest' }]
	: [];

describe('immutable static bass preparation', () => {
	it('prepares the full bass score once per owned definition, including alternate candidates', () => {
		const prepareArc = vi.spyOn(bassGeneration, 'planBassRegisterArc');
		try {
			const score = make('swing');
			expect(prepareArc).toHaveBeenCalledTimes(1);
			let checkpoint: RollingBackingCheckpoint | undefined;
			let acceptedAlternates = 0;
			for (let bar = 0; bar < score.totalBars; bar++) {
				const result = advanceRollingBacking(score, checkpoint);
				checkpoint = result.checkpoint;
				acceptedAlternates += result.ensembleDevelopment.bassDelayedRoots?.length ?? 0;
			}
			// Delayed-root receipts prove this take exercised alternate candidates,
			// not just the inexpensive ordinary path. Neither may rebuild the arc.
			expect(acceptedAlternates).toBeGreaterThan(0);
			expect(prepareArc).toHaveBeenCalledTimes(1);
			make('swing');
			expect(prepareArc).toHaveBeenCalledTimes(2);
		} finally {
			prepareArc.mockRestore();
		}
	});

	it('owns frozen score-only descriptors and does not prepare Bossa through the walking path', () => {
		const score = make('swing');
		const prepared = prepareRollingBass(score)!;
		expect(Object.isFrozen(prepared)).toBe(true);
		expect(Object.isFrozen(prepared.centers)).toBe(true);
		expect(Object.isFrozen(prepared.segments)).toBe(true);
		for (const segment of prepared.segments) {
			expect(Object.isFrozen(segment)).toBe(true);
			expect(Object.isFrozen(segment.chordPcs)).toBe(true);
			expect(Object.isFrozen(segment.scalePcs)).toBe(true);
		}
		expect(prepareRollingBass(make('bossa-nova'))).toBeUndefined();
	});

	for (const style of styles) it(`${style} keeps owned and uncached JSON definitions exact across loops and changing observations`, () => {
		const score = make(style, 2), external = clone(score);
		let ownedCheckpoint: RollingBackingCheckpoint | undefined, externalCheckpoint: RollingBackingCheckpoint | undefined;
		for (let bar = 0; bar < score.totalBars; bar++) {
			const observations = features(bar, bar % 3 ? 'dense' : 'rest');
			const owned = advanceRollingBacking(score, ownedCheckpoint, observations);
			const uncached = advanceRollingBacking(external, externalCheckpoint, observations);
			expect(owned).toEqual(uncached);
			ownedCheckpoint = owned.checkpoint; externalCheckpoint = clone(uncached.checkpoint);
		}
	});

	for (const shallowFrozen of [false, true]) it(`does not cache stale nested data in an external ${shallowFrozen ? 'shallow-frozen' : 'mutable'} definition`, () => {
		// Deliberately keep the same outer identity. Object.isFrozen alone is
		// insufficient to establish ownership of the nested chart/form data.
		const external = JSON.parse(JSON.stringify(make('swing')));
		if (shallowFrozen) Object.freeze(external);
		const before = advanceRollingBacking(external);
		external.harmony[0].chord.root = 'C';
		external.harmony[0].scaleId = 'major.ionian';
		external.bars[0].performanceEnergy.targetEnergy = .35;
		const fresh = clone(external) as RollingBackingDefinition;
		const actual = advanceRollingBacking(external);
		expect(actual).toEqual(advanceRollingBacking(fresh));
		expect(actual.bassEvents).not.toEqual(before.bassEvents);
	});

	it('shares static preparation without sharing musical history between interleaved performances', () => {
		const score = make('swing');
		let dense: RollingBackingCheckpoint | undefined, resting: RollingBackingCheckpoint | undefined;
		let denseReference: RollingBackingCheckpoint | undefined, restReference: RollingBackingCheckpoint | undefined;
		const referenceDense = clone(score), referenceRest = clone(score);
		for (let bar = 0; bar < score.totalBars; bar++) {
			const a = advanceRollingBacking(score, dense, features(bar, 'dense'));
			const b = advanceRollingBacking(score, resting, features(bar, 'rest'));
			const ar = advanceRollingBacking(referenceDense, denseReference, features(bar, 'dense'));
			const br = advanceRollingBacking(referenceRest, restReference, features(bar, 'rest'));
			expect(a).toEqual(ar); expect(b).toEqual(br);
			dense = a.checkpoint; resting = b.checkpoint; denseReference = ar.checkpoint; restReference = br.checkpoint;
		}
	});
});
