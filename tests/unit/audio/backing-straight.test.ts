import { describe, it, expect } from 'vitest';
import type { HarmonicSegment, PitchClass, ChordQuality } from '$lib/types/music';
import {
	generateBacking,
	resolveBackingSwing,
	type BackingGenerationParams
} from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';

/** One-bar-per-chord 4/4 harmony builder. */
function bars(...chords: Array<[PitchClass, ChordQuality]>): HarmonicSegment[] {
	return chords.map(([root, quality], i) => ({
		chord: { root, quality },
		scaleId: 'major.ionian',
		startOffset: [i, 1] as [number, number],
		duration: [1, 1] as [number, number]
	}));
}

const HARMONY = bars(['C', 'maj7'], ['A', 'min7'], ['D', 'min7'], ['G', '7']);

function params(overrides: Partial<BackingGenerationParams> = {}): BackingGenerationParams {
	return {
		phraseId: 'straight-probe',
		tempo: 140,
		ppq: 480,
		beatsPerBar: 4,
		swing: 0.5,
		...overrides
	};
}

describe('straight style', () => {
	it('always resolves to even eighths regardless of tempo', () => {
		for (const tempo of [60, 140, 240]) {
			expect(resolveBackingSwing(0.5, BACKING_STYLES.straight, tempo)).toBe(0.5);
		}
	});

	it('is deterministic', () => {
		const gen = () => generateBacking(HARMONY, BACKING_STYLES.straight, params());
		expect(gen()).toEqual(gen());
	});

	it('plays the full swing vocabulary: ride coverage, setups, dialogue', () => {
		const aaba = BACKING_LAB_PRESETS.find((p) => p.id === 'lab-aaba-c')!;
		const { drumEvents } = generateBacking(aaba.phrase.harmony, BACKING_STYLES.straight, {
			...params({ phraseId: 'straight-vocab' }),
			sectionMap: aaba.phrase.sectionMap
		});
		// The time never stops (the swing suite's own invariant, straight).
		const bars = Math.ceil(Math.max(...drumEvents.map((e) => e.absBeat)) / 4);
		for (let bar = 0; bar < bars; bar++) {
			for (let b = 0; b < 4; b++) {
				const abs = bar * 4 + b;
				expect(
					drumEvents.some(
						(e) => e.absBeat === abs && (e.drum === 'ride' || (b === 0 && e.drum === 'crash'))
					),
					`no timekeeping at beat ${abs}`
				).toBe(true);
			}
		}
		// The vocabulary speaks: snare dialogue and hats exist.
		expect(drumEvents.some((e) => e.drum === 'snare')).toBe(true);
		expect(drumEvents.some((e) => e.drum === 'hihat')).toBe(true);
	});

	it('colors beat 4 with the cross-stick, and only beat 4', () => {
		let sticks = 0;
		for (let seed = 0; seed < 6; seed++) {
			const { drumEvents } = generateBacking(
				HARMONY,
				BACKING_STYLES.straight,
				params({ phraseId: `straight-stick-${seed}` })
			);
			for (const e of drumEvents) {
				if (e.drum !== 'crossstick') continue;
				expect(e.absBeat % 4).toBe(3);
				sticks++;
			}
		}
		expect(sticks).toBeGreaterThan(3);
	});

	it('rests more than swing under the figure bias', () => {
		// Deterministic seeds: count zero-comp bars for both styles over the
		// same phrases. The 1.3× rest bias must show up in the totals.
		const aaba = BACKING_LAB_PRESETS.find((p) => p.id === 'lab-aaba-c')!;
		const restBars = (style: 'swing' | 'straight'): number => {
			let rests = 0;
			for (let seed = 0; seed < 4; seed++) {
				const { compEvents } = generateBacking(aaba.phrase.harmony, BACKING_STYLES[style], {
					...params({ phraseId: `straight-rest-${seed}` }),
					sectionMap: aaba.phrase.sectionMap
				});
				const sounding = new Set(compEvents.map((e) => Math.floor(e.absBeat / 4)));
				const total = Math.ceil(Math.max(...compEvents.map((e) => e.absBeat)) / 4);
				rests += total - sounding.size;
			}
			return rests;
		};
		expect(restBars('straight')).toBeGreaterThan(restBars('swing'));
	});
});
