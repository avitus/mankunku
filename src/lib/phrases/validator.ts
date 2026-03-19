/**
 * Phrase validation: contour rules, range limits, musical constraints.
 *
 * These rules ensure generated/mutated phrases sound idiomatically jazz
 * rather than random. All pitch values are MIDI concert pitch.
 */

import type { Phrase, Note } from '$lib/types/music.ts';
import { intervalSize } from '$lib/music/intervals.ts';
import { fractionToFloat } from '$lib/music/intervals.ts';

export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

export interface ValidationRules {
	/** Max semitone interval between consecutive notes (default: 14, a major 9th) */
	maxInterval: number;
	/** Max consecutive leaps (intervals > 2 semitones) before a step is required */
	maxConsecutiveLeaps: number;
	/** Minimum ratio of steps to total intervals (0-1, default: 0.3) */
	minStepRatio: number;
	/** MIDI range bounds [low, high] */
	range: [number, number];
	/** Require leap recovery (step in opposite direction after large leap) */
	leapRecovery: boolean;
	/** Threshold for "large leap" requiring recovery (semitones, default: 7) */
	leapRecoveryThreshold: number;
	/** Minimum number of direction changes in a phrase */
	minDirectionChanges: number;
	/** Whether the last note should resolve to a chord tone */
	requireEndingResolution: boolean;
}

const DEFAULT_RULES: ValidationRules = {
	maxInterval: 14,
	maxConsecutiveLeaps: 3,
	minStepRatio: 0.3,
	range: [44, 84], // covers tenor sax, alto sax, trumpet
	leapRecovery: true,
	leapRecoveryThreshold: 7,
	minDirectionChanges: 1,
	requireEndingResolution: false
};

/**
 * Validate a phrase against contour and range rules.
 */
export function validatePhrase(
	phrase: Phrase,
	rules: Partial<ValidationRules> = {}
): ValidationResult {
	const r = { ...DEFAULT_RULES, ...rules };
	const errors: string[] = [];
	const pitched = phrase.notes.filter((n) => n.pitch !== null);

	if (pitched.length < 2) {
		return { valid: true, errors: [] };
	}

	// Range check
	for (const note of pitched) {
		if (note.pitch! < r.range[0] || note.pitch! > r.range[1]) {
			errors.push(`Note ${note.pitch} out of range [${r.range[0]}, ${r.range[1]}]`);
		}
	}

	// Interval checks
	const intervals: number[] = [];
	const directions: number[] = [];
	let consecutiveLeaps = 0;
	let maxConsecutive = 0;

	for (let i = 1; i < pitched.length; i++) {
		const prev = pitched[i - 1].pitch!;
		const curr = pitched[i].pitch!;
		const size = intervalSize(prev, curr);
		const dir = Math.sign(curr - prev);

		intervals.push(size);
		if (dir !== 0) directions.push(dir);

		// Max interval
		if (size > r.maxInterval) {
			errors.push(`Interval ${size} semitones exceeds max ${r.maxInterval}`);
		}

		// Consecutive leaps
		if (size > 2) {
			consecutiveLeaps++;
			maxConsecutive = Math.max(maxConsecutive, consecutiveLeaps);
		} else {
			consecutiveLeaps = 0;
		}

		// Leap recovery: after a large leap, the next interval should step
		// in the opposite direction
		if (r.leapRecovery && i >= 2) {
			const prevSize = intervals[intervals.length - 2];
			const prevDir = Math.sign(pitched[i - 1].pitch! - pitched[i - 2].pitch!);

			if (prevSize >= r.leapRecoveryThreshold && size > 2 && dir === prevDir) {
				errors.push(`No leap recovery after ${prevSize}-semitone leap at note ${i - 1}`);
			}
		}
	}

	if (maxConsecutive > r.maxConsecutiveLeaps) {
		errors.push(
			`${maxConsecutive} consecutive leaps exceeds max ${r.maxConsecutiveLeaps}`
		);
	}

	// Step ratio
	if (intervals.length > 0) {
		const steps = intervals.filter((i) => i <= 2).length;
		const ratio = steps / intervals.length;
		if (ratio < r.minStepRatio) {
			errors.push(
				`Step ratio ${ratio.toFixed(2)} below minimum ${r.minStepRatio}`
			);
		}
	}

	// Direction changes
	let changes = 0;
	for (let i = 1; i < directions.length; i++) {
		if (directions[i] !== directions[i - 1]) changes++;
	}
	if (changes < r.minDirectionChanges && pitched.length > 3) {
		errors.push(`Only ${changes} direction changes, minimum is ${r.minDirectionChanges}`);
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Check if a MIDI note is a chord tone of the current harmony.
 */
export function isChordTone(midi: number, chordMidiNotes: number[]): boolean {
	const pc = ((midi % 12) + 12) % 12;
	return chordMidiNotes.some((cn) => ((cn % 12) + 12) % 12 === pc);
}

/**
 * Quick check: is a note array within a MIDI range?
 */
export function isInRange(notes: Note[], low: number, high: number): boolean {
	return notes.every((n) => n.pitch === null || (n.pitch >= low && n.pitch <= high));
}

/**
 * Get rules appropriate for a difficulty level (1-100).
 */
export function rulesForDifficulty(level: number): Partial<ValidationRules> {
	if (level <= 20) {
		return {
			maxInterval: 5,
			maxConsecutiveLeaps: 1,
			minStepRatio: 0.5,
			leapRecoveryThreshold: 5,
			minDirectionChanges: 1
		};
	}
	if (level <= 40) {
		return {
			maxInterval: 7,
			maxConsecutiveLeaps: 2,
			minStepRatio: 0.4,
			leapRecoveryThreshold: 6,
			minDirectionChanges: 2
		};
	}
	if (level <= 60) {
		return {
			maxInterval: 10,
			maxConsecutiveLeaps: 2,
			minStepRatio: 0.35,
			leapRecoveryThreshold: 7,
			minDirectionChanges: 2
		};
	}
	if (level <= 80) {
		return {
			maxInterval: 12,
			maxConsecutiveLeaps: 3,
			minStepRatio: 0.3,
			leapRecoveryThreshold: 7,
			minDirectionChanges: 2
		};
	}
	return {
		maxInterval: 14,
		maxConsecutiveLeaps: 3,
		minStepRatio: 0.25,
		leapRecoveryThreshold: 8,
		minDirectionChanges: 2
	};
}
