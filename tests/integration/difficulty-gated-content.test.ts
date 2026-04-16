/**
 * Integration tests: adaptive difficulty system gates content.
 *
 * Verifies that level changes actually affect content profiles,
 * validator rules, and tier boundaries. All functions under test
 * are pure — no mocking needed.
 */

import { describe, it, expect } from 'vitest';
import {
	createInitialAdaptiveState,
	processAttempt,
	getAdaptiveSummary,
	WINDOW_SIZE
} from '../../src/lib/difficulty/adaptive';
import {
	getProfile,
	levelToContentTier,
	DIFFICULTY_PROFILES
} from '../../src/lib/difficulty/params';
import { rulesForDifficulty } from '../../src/lib/phrases/validator';
import { calculateDifficulty } from '../../src/lib/difficulty/calculate';
import type { Phrase, Note, Fraction } from '../../src/lib/types/music';
import type { AdaptiveState } from '../../src/lib/types/progress';

// ── Helpers ───────────────────────────────────────────────────────

/** Build a minimal Phrase for calculateDifficulty. */
function makePhrase(notes: Note[]): Phrase {
	return {
		id: 'test',
		name: 'test phrase',
		timeSignature: [4, 4],
		key: 'C',
		notes,
		harmony: [],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: [],
		source: 'generated'
	};
}

function note(pitch: number | null, dur: Fraction, offset: Fraction): Note {
	return { pitch, duration: dur, offset };
}

/** Process N identical attempts on a state. */
function processN(
	state: AdaptiveState,
	n: number,
	overall: number,
	pitch: number,
	rhythm: number
): AdaptiveState {
	let s = state;
	for (let i = 0; i < n; i++) {
		s = processAttempt(s, overall, pitch, rhythm);
	}
	return s;
}

// ─── Content Tier Profiles ────────────────────────────────────────

describe('content tier profiles', () => {
	it('tier 1 has restricted scale types (no bebop or altered)', () => {
		const profile = getProfile(1);
		expect(profile.scaleTypes).not.toContain('bebop');
		expect(profile.scaleTypes).not.toContain('melodic-minor');
		expect(profile.scaleTypes).not.toContain('harmonic-minor');
		expect(profile.scaleTypes).not.toContain('symmetric');
	});

	it('tier 1 has restricted rhythm types (quarter notes only)', () => {
		const profile = getProfile(1);
		expect(profile.rhythmTypes).toEqual(['quarter']);
		expect(profile.rhythmTypes).not.toContain('eighth');
		expect(profile.rhythmTypes).not.toContain('triplet');
		expect(profile.rhythmTypes).not.toContain('sixteenth');
	});

	it('tier 1 restricts to easy keys', () => {
		const profile = getProfile(1);
		expect(profile.keys).toEqual(expect.arrayContaining(['C', 'F', 'G']));
		expect(profile.keys.length).toBeLessThanOrEqual(5);
	});

	it('tier 5 unlocks more scale types than tier 1', () => {
		const tier1 = getProfile(1);
		const tier5 = getProfile(40); // level 40 maps to tier 5
		expect(tier5.scaleTypes.length).toBeGreaterThan(tier1.scaleTypes.length);
	});

	it('tier 7+ unlocks all 12 keys', () => {
		const profile = getProfile(65); // level 65 maps to tier 7
		expect(profile.keys.length).toBe(12);
	});

	it('tier 10 has maximum intervals allowed', () => {
		const profile = getProfile(95); // level 95 maps to tier 10
		expect(profile.maxInterval).toBe(24);
		// Verify it is the largest across all tiers
		for (const p of DIFFICULTY_PROFILES) {
			expect(profile.maxInterval).toBeGreaterThanOrEqual(p.maxInterval);
		}
	});

	it('each successive tier has equal or more content than the previous', () => {
		for (let tier = 2; tier <= 10; tier++) {
			const prev = getProfile(tier - 1);
			const curr = getProfile(tier);

			expect(curr.scaleTypes.length).toBeGreaterThanOrEqual(prev.scaleTypes.length);
			expect(curr.keys.length).toBeGreaterThanOrEqual(prev.keys.length);
			expect(curr.maxInterval).toBeGreaterThanOrEqual(prev.maxInterval);
			expect(curr.rhythmTypes.length).toBeGreaterThanOrEqual(prev.rhythmTypes.length);
		}
	});
});

// ─── levelToContentTier Boundaries ────────────────────────────────

describe('levelToContentTier boundaries', () => {
	// Boundary definitions from params.ts:
	//   Level  1-5   -> Tier 1
	//   Level  6-12  -> Tier 2
	//   Level 13-20  -> Tier 3
	//   Level 21-30  -> Tier 4
	//   Level 31-40  -> Tier 5
	//   Level 41-52  -> Tier 6
	//   Level 53-65  -> Tier 7
	//   Level 66-78  -> Tier 8
	//   Level 79-90  -> Tier 9
	//   Level 91-100 -> Tier 10

	const boundaries: Array<{ tier: number; lower: number; upper: number }> = [
		{ tier: 1, lower: 1, upper: 5 },
		{ tier: 2, lower: 6, upper: 12 },
		{ tier: 3, lower: 13, upper: 20 },
		{ tier: 4, lower: 21, upper: 30 },
		{ tier: 5, lower: 31, upper: 40 },
		{ tier: 6, lower: 41, upper: 52 },
		{ tier: 7, lower: 53, upper: 65 },
		{ tier: 8, lower: 66, upper: 78 },
		{ tier: 9, lower: 79, upper: 90 },
		{ tier: 10, lower: 91, upper: 100 }
	];

	for (const { tier, lower, upper } of boundaries) {
		it(`level ${lower} maps to tier ${tier} (lower bound)`, () => {
			expect(levelToContentTier(lower)).toBe(tier);
		});

		it(`level ${upper} maps to tier ${tier} (upper bound)`, () => {
			expect(levelToContentTier(upper)).toBe(tier);
		});
	}

	it('all levels 1-100 map to tiers 1-10 without gaps', () => {
		for (let level = 1; level <= 100; level++) {
			const tier = levelToContentTier(level);
			expect(tier).toBeGreaterThanOrEqual(1);
			expect(tier).toBeLessThanOrEqual(10);
		}
	});
});

// ─── Validator Rules by Difficulty ────────────────────────────────

describe('validator rules by difficulty', () => {
	it('lower difficulty has stricter maxInterval', () => {
		const low = rulesForDifficulty(10);
		const high = rulesForDifficulty(80);
		expect(low.maxInterval!).toBeLessThan(high.maxInterval!);
	});

	it('lower difficulty has stricter maxConsecutiveLeaps', () => {
		const low = rulesForDifficulty(10);
		const high = rulesForDifficulty(80);
		expect(low.maxConsecutiveLeaps!).toBeLessThanOrEqual(high.maxConsecutiveLeaps!);
	});

	it('rules relax monotonically as difficulty increases', () => {
		const levels = [10, 30, 50, 70, 90];
		const intervals = levels.map((l) => rulesForDifficulty(l).maxInterval!);
		const leaps = levels.map((l) => rulesForDifficulty(l).maxConsecutiveLeaps!);

		for (let i = 1; i < intervals.length; i++) {
			expect(intervals[i]).toBeGreaterThanOrEqual(intervals[i - 1]);
		}
		for (let i = 1; i < leaps.length; i++) {
			expect(leaps[i]).toBeGreaterThanOrEqual(leaps[i - 1]);
		}
	});

	it('minStepRatio decreases as difficulty increases', () => {
		const levels = [10, 30, 50, 70, 90];
		const ratios = levels.map((l) => rulesForDifficulty(l).minStepRatio!);

		for (let i = 1; i < ratios.length; i++) {
			expect(ratios[i]).toBeLessThanOrEqual(ratios[i - 1]);
		}
	});
});

// ─── Adaptive State Advancement ──────────────────────────────────

describe('adaptive state advancement', () => {
	it('25 attempts at 90% overall advances the level', () => {
		const initial = createInitialAdaptiveState();
		const result = processN(initial, 25, 0.90, 0.90, 0.90);

		expect(result.currentLevel).toBeGreaterThan(initial.currentLevel);
		expect(result.pitchComplexity).toBeGreaterThan(initial.pitchComplexity);
		expect(result.rhythmComplexity).toBeGreaterThan(initial.rhythmComplexity);
	});

	it('25 attempts at 40% overall retreats the level', () => {
		// Start at level 20 by setting pitch and rhythm complexity high
		let state: AdaptiveState = {
			...createInitialAdaptiveState(),
			currentLevel: 20,
			pitchComplexity: 20,
			rhythmComplexity: 20
		};

		state = processN(state, 25, 0.40, 0.40, 0.40);

		expect(state.pitchComplexity).toBeLessThan(20);
		expect(state.rhythmComplexity).toBeLessThan(20);
		expect(state.currentLevel).toBeLessThan(20);
	});

	it('pitch and rhythm track independently', () => {
		const initial = createInitialAdaptiveState();
		// High pitch accuracy, low rhythm accuracy
		const result = processN(initial, 25, 0.70, 0.95, 0.40);

		// Pitch should advance (avg 0.95 >= 0.85 threshold)
		expect(result.pitchComplexity).toBeGreaterThan(initial.pitchComplexity);
		// Rhythm stays at 1 (can't retreat below 1, and avg 0.40 < 0.50 threshold)
		expect(result.rhythmComplexity).toBe(1);
	});

	it('cooldown prevents rapid level changes', () => {
		const initial = createInitialAdaptiveState();

		// 10 good attempts — triggers first advancement (cooldown resets to 0)
		let state = processN(initial, 10, 0.95, 0.95, 0.95);
		const levelAfterAdvance = state.currentLevel;
		expect(levelAfterAdvance).toBeGreaterThan(1);

		// Immediately send 5 bad attempts — not enough to pass the 10-attempt cooldown
		state = processN(state, 5, 0.20, 0.20, 0.20);

		// Level should NOT have retreated because cooldown hasn't elapsed
		expect(state.pitchComplexity).toBeGreaterThanOrEqual(
			levelAfterAdvance // complexity can't drop yet
		);
	});

	it('getAdaptiveSummary returns human-readable string', () => {
		let state = createInitialAdaptiveState();
		state = processN(state, 5, 0.80, 0.85, 0.75);

		const summary = getAdaptiveSummary(state);
		expect(typeof summary).toBe('string');
		expect(summary.length).toBeGreaterThan(0);
		expect(summary).toContain('Pitch');
		expect(summary).toContain('Rhythm');
		// Should include the percentage
		expect(summary).toMatch(/\d+%/);
	});

	it('window size is 25', () => {
		expect(WINDOW_SIZE).toBe(25);
	});

	it('high pitch + low rhythm diverges complexity dimensions', () => {
		let state: AdaptiveState = {
			...createInitialAdaptiveState(),
			currentLevel: 10,
			pitchComplexity: 10,
			rhythmComplexity: 10
		};

		// 25 attempts: pitch excels, rhythm struggles
		state = processN(state, 25, 0.70, 0.95, 0.30);

		expect(state.pitchComplexity).toBeGreaterThan(10);
		expect(state.rhythmComplexity).toBeLessThan(10);
	});
});

// ─── Difficulty Calculation Consistency ───────────────────────────

describe('difficulty calculation consistency', () => {
	it('returns reasonable values for a simple stepwise phrase', () => {
		// Simple: four quarter notes stepping up C-D-E-F (MIDI 60-65)
		const notes: Note[] = [
			note(60, [1, 4], [0, 1]),   // C4
			note(62, [1, 4], [1, 4]),   // D4
			note(64, [1, 4], [2, 4]),   // E4
			note(65, [1, 4], [3, 4])    // F4
		];
		const phrase = makePhrase(notes);
		const diff = calculateDifficulty(phrase);

		expect(diff.level).toBeGreaterThanOrEqual(1);
		expect(diff.level).toBeLessThanOrEqual(100);
		expect(diff.pitchComplexity).toBeGreaterThanOrEqual(1);
		expect(diff.rhythmComplexity).toBeGreaterThanOrEqual(1);
		// Stepwise quarter notes should be low difficulty
		expect(diff.level).toBeLessThanOrEqual(30);
	});

	it('returns higher values for complex phrases', () => {
		// Complex: large intervals, sixteenth notes, chromatic, wide range
		const notes: Note[] = [
			note(48, [1, 16], [0, 1]),      // C3
			note(72, [1, 16], [1, 16]),     // C5 (+24 semitones)
			note(49, [1, 16], [2, 16]),     // Db3 (chromatic)
			note(73, [1, 16], [3, 16]),     // Db5
			note(50, [1, 16], [4, 16]),     // D3
			note(74, [1, 16], [5, 16]),     // D5
			note(51, [1, 16], [6, 16]),     // Eb3
			note(75, [1, 16], [7, 16]),     // Eb5
			note(52, [1, 16], [8, 16]),     // E3
			note(76, [1, 16], [9, 16]),     // E5
			note(53, [1, 16], [10, 16]),    // F3
			note(77, [1, 16], [11, 16]),    // F5
			note(54, [1, 16], [12, 16]),    // F#3
			note(78, [1, 16], [13, 16])     // F#5
		];
		const phrase = makePhrase(notes);
		const diff = calculateDifficulty(phrase);

		expect(diff.level).toBeGreaterThanOrEqual(1);
		expect(diff.level).toBeLessThanOrEqual(100);
		// Should be substantially harder than stepwise quarter notes
		expect(diff.level).toBeGreaterThan(30);
	});

	it('complex phrase scores higher than simple phrase', () => {
		const simpleNotes: Note[] = [
			note(60, [1, 4], [0, 1]),
			note(62, [1, 4], [1, 4]),
			note(64, [1, 4], [2, 4]),
			note(65, [1, 4], [3, 4])
		];
		const complexNotes: Note[] = [
			note(48, [1, 16], [0, 1]),
			note(72, [1, 16], [1, 16]),
			note(49, [1, 16], [2, 16]),
			note(73, [1, 16], [3, 16]),
			note(50, [1, 16], [4, 16]),
			note(74, [1, 16], [5, 16]),
			note(51, [1, 16], [6, 16]),
			note(75, [1, 16], [7, 16]),
			note(52, [1, 16], [8, 16]),
			note(76, [1, 16], [9, 16]),
			note(53, [1, 16], [10, 16]),
			note(77, [1, 16], [11, 16]),
			note(54, [1, 16], [12, 16]),
			note(78, [1, 16], [13, 16])
		];

		const simple = calculateDifficulty(makePhrase(simpleNotes));
		const complex = calculateDifficulty(makePhrase(complexNotes));

		expect(complex.level).toBeGreaterThan(simple.level);
		expect(complex.pitchComplexity).toBeGreaterThan(simple.pitchComplexity);
		expect(complex.rhythmComplexity).toBeGreaterThan(simple.rhythmComplexity);
	});

	it('returns correct lengthBars for multi-bar phrases', () => {
		const notes: Note[] = [
			note(60, [1, 4], [0, 1]),
			note(62, [1, 4], [1, 4]),
			note(64, [1, 4], [2, 4]),
			note(65, [1, 4], [3, 4]),
			note(67, [1, 4], [4, 4]),   // bar 2
			note(69, [1, 4], [5, 4]),
			note(71, [1, 4], [6, 4]),
			note(72, [1, 4], [7, 4])
		];
		const diff = calculateDifficulty(makePhrase(notes));

		expect(diff.lengthBars).toBe(2);
	});
});
