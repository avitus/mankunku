/**
 * Integration tests for ABC notation generation across all curated licks
 * and instrument transpositions.
 *
 * phraseToAbc() is the only visual output of lick data — if it produces
 * bad ABC for certain categories, the user sees garbled notation.
 */

import { describe, it, expect } from 'vitest';
import { phraseToAbc } from '../../src/lib/music/notation';
import { ALL_CURATED_LICKS } from '../../src/lib/data/licks/index';
import { INSTRUMENTS } from '../../src/lib/types/instruments';
import { PITCH_CLASSES, type PitchClass, type Phrase } from '../../src/lib/types/music';

// ─── Helpers ───────────────────────────────────────────────────

const ABC_HEADER_FIELDS = ['X:1', 'T:', 'M:', 'L:', 'K:'] as const;

/** Verify that an ABC string contains all required header fields. */
function assertValidHeader(abc: string, lickId: string): void {
	for (const field of ABC_HEADER_FIELDS) {
		expect(abc, `Lick ${lickId} missing header field "${field}"`).toContain(field);
	}
}

/** Get the note content (everything after the header lines). */
function noteContent(abc: string): string {
	const lines = abc.split('\n');
	// Header is X:, T:, M:, L:, K: — note content starts after
	return lines.slice(5).join('\n');
}

/** Filter curated licks by category, returning empty array if none found. */
function licksByCategory(category: string): Phrase[] {
	return ALL_CURATED_LICKS.filter((l) => l.category === category);
}

// ─── Full library validation ──────────────────────────────────

describe('notation round-trip', () => {
	it('phraseToAbc produces valid ABC header for every curated lick', () => {
		for (const lick of ALL_CURATED_LICKS) {
			const abc = phraseToAbc(lick);
			assertValidHeader(abc, lick.id);
		}
	});

	it('phraseToAbc does not throw for any curated lick', () => {
		for (const lick of ALL_CURATED_LICKS) {
			try {
				phraseToAbc(lick);
			} catch (e) {
				expect.fail(`phraseToAbc threw for lick "${lick.id}": ${e}`);
			}
		}
	});

	// ─── Category-specific tests ────────────────────────────────

	const categoryTests: Array<{ category: string; label: string }> = [
		{ category: 'ii-V-I-major', label: 'ii-V-I-major' },
		{ category: 'blues', label: 'blues' },
		{ category: 'pentatonic', label: 'pentatonic' },
		{ category: 'modal', label: 'modal' },
		{ category: 'bebop-lines', label: 'bebop-lines' },
		{ category: 'beginner-cells', label: 'beginner-cells' },
		{ category: 'ballad', label: 'ballad' },
	];

	for (const { category, label } of categoryTests) {
		const licks = licksByCategory(category);

		it.skipIf(licks.length === 0)(`handles ${label} category licks (${licks.length} licks)`, () => {
			for (const lick of licks) {
				const abc = phraseToAbc(lick);
				assertValidHeader(abc, lick.id);
				const content = noteContent(abc);
				expect(content.trim().length, `Lick ${lick.id} produced empty note content`).toBeGreaterThan(0);
			}
		});
	}

	// ─── Instrument transposition ───────────────────────────────

	it('phraseToAbc with tenor sax instrument transposition does not throw', () => {
		const tenorSax = INSTRUMENTS['tenor-sax'];
		const sample = ALL_CURATED_LICKS.slice(0, 10);
		for (const lick of sample) {
			try {
				const abc = phraseToAbc(lick, tenorSax);
				assertValidHeader(abc, lick.id);
			} catch (e) {
				expect.fail(`phraseToAbc threw for lick "${lick.id}" with tenor sax: ${e}`);
			}
		}
	});

	it('phraseToAbc with alto sax instrument transposition does not throw', () => {
		const altoSax = INSTRUMENTS['alto-sax'];
		const sample = ALL_CURATED_LICKS.slice(0, 10);
		for (const lick of sample) {
			try {
				const abc = phraseToAbc(lick, altoSax);
				assertValidHeader(abc, lick.id);
			} catch (e) {
				expect.fail(`phraseToAbc threw for lick "${lick.id}" with alto sax: ${e}`);
			}
		}
	});

	it('phraseToAbc with trumpet transposition does not throw', () => {
		const trumpet = INSTRUMENTS['trumpet'];
		const sample = ALL_CURATED_LICKS.slice(0, 10);
		for (const lick of sample) {
			try {
				const abc = phraseToAbc(lick, trumpet);
				assertValidHeader(abc, lick.id);
			} catch (e) {
				expect.fail(`phraseToAbc threw for lick "${lick.id}" with trumpet: ${e}`);
			}
		}
	});

	// ─── Rest handling ──────────────────────────────────────────

	it('phraseToAbc renders rests as z', () => {
		const licksWithRests = ALL_CURATED_LICKS.filter((l) =>
			l.notes.some((n) => n.pitch === null)
		);

		if (licksWithRests.length === 0) {
			// If no curated licks have rests, create a synthetic one
			const syntheticPhrase: Phrase = {
				id: 'test-rest',
				name: 'Rest Test',
				timeSignature: [4, 4],
				key: 'C',
				notes: [
					{ pitch: 60, duration: [1, 4], offset: [0, 1] },
					{ pitch: null, duration: [1, 4], offset: [1, 4] },
					{ pitch: 62, duration: [1, 4], offset: [2, 4] },
					{ pitch: 64, duration: [1, 4], offset: [3, 4] },
				],
				harmony: [],
				difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
				category: 'user',
				tags: [],
				source: 'test',
			};
			const abc = phraseToAbc(syntheticPhrase);
			expect(noteContent(abc)).toContain('z');
		} else {
			for (const lick of licksWithRests) {
				const abc = phraseToAbc(lick);
				expect(noteContent(abc), `Lick ${lick.id} has rests but ABC has no 'z'`).toContain('z');
			}
		}
	});

	// ─── All 12 key signatures ──────────────────────────────────

	it('phraseToAbc handles all 12 key signatures without crashing', () => {
		const baseLick = ALL_CURATED_LICKS[0];

		for (const key of PITCH_CLASSES) {
			const lick: Phrase = { ...baseLick, key: key as PitchClass };
			try {
				const abc = phraseToAbc(lick);
				assertValidHeader(abc, `${baseLick.id}@key=${key}`);
			} catch (e) {
				expect.fail(`phraseToAbc threw for key "${key}": ${e}`);
			}
		}
	});

	// ─── Barlines ───────────────────────────────────────────────

	it('output contains barlines for multi-bar licks', () => {
		// Filter by actual note extent rather than metadata — some licks
		// have lengthBars metadata that doesn't match their note offsets.
		const multiBarLicks = ALL_CURATED_LICKS.filter((l) => {
			const barDuration = l.timeSignature[0] / l.timeSignature[1];
			const lastNote = l.notes[l.notes.length - 1];
			if (!lastNote) return false;
			const lastOffset = lastNote.offset[0] / lastNote.offset[1];
			return lastOffset >= barDuration; // notes extend past bar 1
		});
		expect(multiBarLicks.length, 'No multi-bar licks found in library').toBeGreaterThan(0);

		for (const lick of multiBarLicks) {
			const abc = phraseToAbc(lick);
			const content = noteContent(abc);
			// Multi-bar licks must have at least one internal barline '|'
			// (the closing '|]' doesn't count as an internal barline)
			const withoutClosing = content.replace(/\|]\s*$/, '');
			expect(
				withoutClosing,
				`Multi-bar lick ${lick.id} has no internal barlines`
			).toContain('|');
		}
	});
});
