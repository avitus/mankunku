import { describe, it, expect } from 'vitest';
import type { HarmonicSegment, PitchClass, ChordQuality } from '$lib/types/music';
import { generateBacking, type BackingGenerationParams } from '$lib/audio/backing-generation';
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

const HARMONY = bars(
	['F', 'maj7'],
	['D', 'min7'],
	['G', 'min7'],
	['C', '7'],
	['F', 'maj7'],
	['Bb', 'maj7'],
	['G', 'min7'],
	['C', '7']
);

function params(overrides: Partial<BackingGenerationParams> = {}): BackingGenerationParams {
	return {
		phraseId: 'ballad-probe',
		tempo: 72,
		ppq: 480,
		beatsPerBar: 4,
		swing: 0.5,
		...overrides
	};
}

function gen(overrides: Partial<BackingGenerationParams> = {}) {
	return generateBacking(HARMONY, BACKING_STYLES.ballad, params(overrides));
}

describe('ballad bass: permanent two-feel', () => {
	it('never walks: no bar carries the four-feel integer grid', () => {
		for (let seed = 0; seed < 10; seed++) {
			const { bassEvents } = gen({ phraseId: `ballad-two-${seed}` });
			for (let bar = 0; bar < 8; bar++) {
				const onsets = bassEvents
					.filter((e) => Math.floor(e.absBeat / 4) === bar)
					.map((e) => e.absBeat % 4);
				// A walking bar states all four quarters; a two-feel bar never
				// sounds both 1 and 3 (beats 2 and 4 in musician terms).
				expect(
					onsets.includes(1) && onsets.includes(3),
					`bar ${bar} walks (onsets ${onsets}) with seed ${seed}`
				).toBe(false);
				// The anchor halves are there.
				expect(onsets).toContain(0);
			}
		}
	});

	it('holds two-feel even on section-final bars (no walk escapes)', () => {
		// The AABA lab preset has a section map — the escape rules the
		// override disables would otherwise walk every section-final bar.
		const aaba = BACKING_LAB_PRESETS.find((p) => p.id === 'lab-aaba-c')!;
		const { bassEvents } = generateBacking(aaba.phrase.harmony, BACKING_STYLES.ballad, {
			...params({ phraseId: 'ballad-aaba' }),
			sectionMap: aaba.phrase.sectionMap
		});
		const barCount = Math.ceil(Math.max(...bassEvents.map((e) => e.absBeat)) / 4);
		let walkingBars = 0;
		for (let bar = 0; bar < barCount; bar++) {
			const onsets = bassEvents
				.filter((e) => Math.floor(e.absBeat / 4) === bar)
				.map((e) => e.absBeat % 4);
			if (onsets.includes(1) && onsets.includes(3)) walkingBars++;
		}
		expect(walkingBars).toBe(0);
	});
});

describe('ballad comp: pads and space', () => {
	it('sustains long, plays little, and always states section arrivals', () => {
		for (let seed = 0; seed < 8; seed++) {
			const { compEvents } = gen({ phraseId: `ballad-comp-${seed}` });
			for (let bar = 0; bar < 8; bar++) {
				const inBar = compEvents.filter((e) => Math.floor(e.absBeat / 4) === bar);
				expect(inBar.length).toBeLessThanOrEqual(3);
				for (const e of inBar) {
					// Pads sustain; only the cadence push is shorter.
					if (e.absBeat % 4 !== 3.5) expect(e.duration).toBeGreaterThan(1.2 * (60 / 72) * 0.8);
				}
			}
			// The phrase downbeat always sounds.
			expect(compEvents.some((e) => e.absBeat === 0)).toBe(true);
		}
	});
});

describe('ballad ceiling', () => {
	it('caps the ensemble arc: late choruses stay as quiet as early ones', () => {
		// 3-chorus AABA: under the swing arc, chorus 2 bars run intensity
		// ~0.75+; the ballad cap pins everything ≤ 0.6, so the comp-velocity
		// intensity lean must never exceed lerp(-2, 4, 0.6) = +1.6 over base.
		const aaba = BACKING_LAB_PRESETS.find((p) => p.id === 'lab-aaba-c')!;
		const { compEvents } = generateBacking(aaba.phrase.harmony, BACKING_STYLES.ballad, {
			...params({ phraseId: 'ballad-cap' }),
			sectionMap: aaba.phrase.sectionMap
		});
		// Base velocity range is rng.int(42, 54) + lean; with the cap the
		// ceiling is 54 + round(lerp(-2, 4, 0.6)) + cadence(+3) = 59.
		for (const e of compEvents) {
			expect(e.velocity).toBeLessThanOrEqual(59);
		}
	});
});

describe('ballad determinism', () => {
	it('is deterministic', () => {
		expect(gen()).toEqual(gen());
	});
});
