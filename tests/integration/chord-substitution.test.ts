/**
 * Integration tests for the chord-substitution feature.
 *
 * Exercises the end-to-end flow through the lick-practice state module:
 *   - filtering (getPracticeLicks includes substitution-eligible licks when
 *     enableSubstitutions is on)
 *   - per-key phrase building (getPhraseFor transposes by the substitution
 *     offset and shifts the alignment offset into the target chord's bar)
 *   - super-phrase building (buildLickSuperPhrase embeds the substitution-
 *     adjusted demo in continuous mode)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	lickPractice,
	getPracticeLicks,
	getPhraseFor,
	buildLickSuperPhrase
} from '$lib/state/lick-practice.svelte';
import type { LickPracticePlanItem } from '$lib/types/lick-practice';
import {
	togglePracticeTag,
	loadUserLickTags,
	saveUserLickTags
} from '$lib/persistence/lick-practice-store';
import { getAllLicks } from '$lib/phrases/library-loader';
import { fractionToFloat } from '$lib/music/intervals';
import { midiToPitchClass } from '$lib/music/intervals';
import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';

// ─── localStorage mock (lick-practice-store writes practice tags here) ──

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: vi.fn((key: string) => store.get(key) ?? null),
	setItem: vi.fn((key: string, val: string) => store.set(key, val)),
	removeItem: vi.fn((key: string) => store.delete(key)),
	key: vi.fn((i: number) => [...store.keys()][i] ?? null),
	get length() {
		return store.size;
	},
	clear: vi.fn(() => store.clear())
});

const MINOR_LICK_ID = 'minor-chord-001';

/**
 * Lowercase pitch-class helper — convert a MIDI pitch to a PitchClass.
 */
function pitchClassOf(midi: number): PitchClass {
	return PITCH_CLASSES[midiToPitchClass(midi)];
}

/** Build a plan with a single lick at the given category and keys. */
function planWith(phraseId: string, keys: PitchClass[], category: LickPracticePlanItem['category']): LickPracticePlanItem[] {
	return [
		{
			phraseId,
			phraseName: phraseId,
			phraseNumber: 1,
			category,
			keys
		}
	];
}

beforeEach(() => {
	store.clear();
	lickPractice.config.progressionType = 'ii-V-I-major';
	lickPractice.config.practiceMode = 'continuous';
	lickPractice.config.enableSubstitutions = false;
	lickPractice.currentLickIndex = 0;
	lickPractice.currentKeyIndex = 0;
	lickPractice.currentTempo = 100;
	lickPractice.keyResults = [];
	lickPractice.allAttempts = [];
	lickPractice.plan = [];
	lickPractice.progress = {};
});

// ─── Filter integration ────────────────────────────────────────

describe('getPracticeLicks — substitution filter', () => {
	it('excludes minor-chord licks on short ii-V-I-major by default', () => {
		togglePracticeTag(MINOR_LICK_ID);
		lickPractice.config.progressionType = 'ii-V-I-major';
		lickPractice.config.enableSubstitutions = false;

		const licks = getPracticeLicks();
		expect(licks.find(l => l.id === MINOR_LICK_ID)).toBeUndefined();
	});

	it('includes minor-chord licks on short ii-V-I-major when enableSubstitutions=true', () => {
		togglePracticeTag(MINOR_LICK_ID);
		lickPractice.config.progressionType = 'ii-V-I-major';
		lickPractice.config.enableSubstitutions = true;

		const licks = getPracticeLicks();
		expect(licks.find(l => l.id === MINOR_LICK_ID)).toBeDefined();
	});

	it('still excludes untagged minor-chord licks when substitutions are on', () => {
		// No practice tag toggled for MINOR_LICK_ID.
		lickPractice.config.progressionType = 'ii-V-I-major';
		lickPractice.config.enableSubstitutions = true;

		const licks = getPracticeLicks();
		expect(licks.find(l => l.id === MINOR_LICK_ID)).toBeUndefined();
	});

	it('includes minor-chord licks on ii-V-I-minor via native mapping (tonic I = min7) — V is 7alt, so substitution would not fire anyway', () => {
		togglePracticeTag(MINOR_LICK_ID);
		lickPractice.config.progressionType = 'ii-V-I-minor';
		lickPractice.config.enableSubstitutions = true;

		// minor-chord is native on ii-V-I-minor (the I chord), so the lick
		// appears via native mapping. Substitution over V (7alt) does not fire
		// because the rule targets plain '7'; native wins regardless.
		const licks = getPracticeLicks();
		expect(licks.find(l => l.id === MINOR_LICK_ID)).toBeDefined();
	});

	it('still includes minor-chord licks on long ii-V-I-major via native mapping', () => {
		// minor-chord maps natively to the ii on the long form; works with or
		// without substitutions.
		togglePracticeTag(MINOR_LICK_ID);
		lickPractice.config.progressionType = 'ii-V-I-major-long';

		lickPractice.config.enableSubstitutions = false;
		expect(getPracticeLicks().find(l => l.id === MINOR_LICK_ID)).toBeDefined();

		lickPractice.config.enableSubstitutions = true;
		expect(getPracticeLicks().find(l => l.id === MINOR_LICK_ID)).toBeDefined();
	});
});

// ─── Phrase building integration ───────────────────────────────

describe('getPhraseFor — substitution transposition', () => {
	it('transposes minor-chord to V-root (G) + 1 semitone = Ab in C when substitutions active', () => {
		lickPractice.config.progressionType = 'ii-V-I-major';
		lickPractice.config.enableSubstitutions = true;
		lickPractice.plan = planWith(MINOR_LICK_ID, ['C'], 'minor-chord');

		const phrase = getPhraseFor(0, 0);
		expect(phrase).not.toBeNull();

		// First note of minor-chord-001 is C in the source lick; with
		// substitution over G7 (semitoneOffset = +1), it should land on Ab.
		const firstPitch = phrase!.notes[0].pitch!;
		expect(pitchClassOf(firstPitch)).toBe('Ab');
	});

	it('transposes minor-chord to D (the ii root) natively on long ii-V-I-major in C', () => {
		lickPractice.config.progressionType = 'ii-V-I-major-long';
		lickPractice.config.enableSubstitutions = true; // no-op here
		lickPractice.plan = planWith(MINOR_LICK_ID, ['C'], 'minor-chord');

		const phrase = getPhraseFor(0, 0);
		const firstPitch = phrase!.notes[0].pitch!;
		// Native mapping sends the lick to the ii chord (Dm7 in C) —
		// substitutions are ignored because a native home exists.
		expect(pitchClassOf(firstPitch)).toBe('D');
	});

	it('shifts note offsets by the substitution alignment offset (half-bar for short ii-V-I-major)', () => {
		lickPractice.config.progressionType = 'ii-V-I-major';
		lickPractice.config.enableSubstitutions = true;
		lickPractice.plan = planWith(MINOR_LICK_ID, ['C'], 'minor-chord');

		const phrase = getPhraseFor(0, 0);
		// minor-chord-001's first note has offset [0, 1] in the source lick.
		// Short ii-V-I-major places V at offset [1, 2] — notes should shift
		// accordingly.
		const firstOffset = fractionToFloat(phrase!.notes[0].offset);
		expect(firstOffset).toBeCloseTo(0.5, 5);
	});

	it('in key F, minor-chord over V (C7) substitutes to Db (C + 1 semitone)', () => {
		lickPractice.config.progressionType = 'ii-V-I-major';
		lickPractice.config.enableSubstitutions = true;
		lickPractice.plan = planWith(MINOR_LICK_ID, ['F'], 'minor-chord');

		const phrase = getPhraseFor(0, 0);
		const firstPitch = phrase!.notes[0].pitch!;
		expect(pitchClassOf(firstPitch)).toBe('Db');
	});

	it('returns raw V-root (G in C) when substitutions are disabled — filter would normally exclude the lick, but here we force it', () => {
		lickPractice.config.progressionType = 'ii-V-I-major';
		lickPractice.config.enableSubstitutions = false;
		lickPractice.plan = planWith(MINOR_LICK_ID, ['C'], 'minor-chord');

		const phrase = getPhraseFor(0, 0);
		// No substitution → no alignment offset fallback → default [0, 1]
		// which points at the ii (Dm7) — so the lick transposes to D.
		const firstPitch = phrase!.notes[0].pitch!;
		expect(pitchClassOf(firstPitch)).toBe('D');
	});

	it('preserves harmony from the progression template (not the lick)', () => {
		lickPractice.config.progressionType = 'ii-V-I-major';
		lickPractice.config.enableSubstitutions = true;
		lickPractice.plan = planWith(MINOR_LICK_ID, ['C'], 'minor-chord');

		const phrase = getPhraseFor(0, 0);
		expect(phrase!.harmony.length).toBe(3);
		// ii-V-I in C: Dm7, G7, Cmaj7 — harmony should reflect the progression,
		// not the lick's single Cm7 chord.
		expect(phrase!.harmony[0].chord.root).toBe('D');
		expect(phrase!.harmony[1].chord.root).toBe('G');
		expect(phrase!.harmony[2].chord.root).toBe('C');
	});
});

describe('buildLickSuperPhrase — substitution in continuous demo', () => {
	it('demo melody in continuous mode reflects the substitution transposition', () => {
		lickPractice.config.progressionType = 'ii-V-I-major';
		lickPractice.config.enableSubstitutions = true;
		lickPractice.config.practiceMode = 'continuous';
		lickPractice.plan = planWith(MINOR_LICK_ID, ['C', 'F'], 'minor-chord');

		const sp = buildLickSuperPhrase(0);
		expect(sp).not.toBeNull();

		// The demo is the lick transposed to keys[0] with substitution applied.
		// In C, V7 = G, substituted up 1 = Ab. First note pitch class = Ab.
		const demoFirstPitch = sp!.notes[0].pitch!;
		expect(pitchClassOf(demoFirstPitch)).toBe('Ab');
	});

	it('demo melody offsets are shifted by the substitution alignment offset', () => {
		lickPractice.config.progressionType = 'ii-V-I-major';
		lickPractice.config.enableSubstitutions = true;
		lickPractice.config.practiceMode = 'continuous';
		lickPractice.plan = planWith(MINOR_LICK_ID, ['C'], 'minor-chord');

		const sp = buildLickSuperPhrase(0);
		// Short ii-V-I-major places V at offset [1, 2] (half-bar in),
		// so demo notes must be pushed by that much.
		const firstOffset = fractionToFloat(sp!.notes[0].offset);
		expect(firstOffset).toBeCloseTo(0.5, 5);
	});

	it('call-response melody also applies substitution per key', () => {
		lickPractice.config.progressionType = 'ii-V-I-major';
		lickPractice.config.enableSubstitutions = true;
		lickPractice.config.practiceMode = 'call-response';
		lickPractice.plan = planWith(MINOR_LICK_ID, ['C', 'F'], 'minor-chord');

		const sp = buildLickSuperPhrase(0);
		// Call-response emits the lick's notes for EACH key.
		// minor-chord-001 has 4 notes, 2 keys → 8 notes.
		expect(sp!.notes.length).toBe(8);

		const minorLickNotes = getAllLicks().find(l => l.id === MINOR_LICK_ID)!.notes.length;
		expect(sp!.notes.length).toBe(minorLickNotes * 2);

		// First note of first key (C session key) — V=G → substituted Ab.
		expect(pitchClassOf(sp!.notes[0].pitch!)).toBe('Ab');

		// First note of second key (F session key) — V=C → substituted Db.
		// Notes are appended per key, so index = first-key note count.
		expect(pitchClassOf(sp!.notes[minorLickNotes].pitch!)).toBe('Db');
	});
});

describe('end-to-end — substitutions off is a pure pass-through', () => {
	it('long ii-V-I-major behavior is identical whether substitutions are on or off', () => {
		lickPractice.config.progressionType = 'ii-V-I-major-long';
		lickPractice.plan = planWith(MINOR_LICK_ID, ['C'], 'minor-chord');

		lickPractice.config.enableSubstitutions = false;
		const phraseOff = getPhraseFor(0, 0);

		lickPractice.config.enableSubstitutions = true;
		const phraseOn = getPhraseFor(0, 0);

		// Native mapping wins — both should transpose to the ii root (D).
		expect(pitchClassOf(phraseOff!.notes[0].pitch!)).toBe('D');
		expect(pitchClassOf(phraseOn!.notes[0].pitch!)).toBe('D');
	});
});

// ─── Cleanup — ensure no stray user lick tags cross between tests ──

describe('cleanup', () => {
	it('clears practice tags when localStorage store is cleared', () => {
		togglePracticeTag(MINOR_LICK_ID);
		saveUserLickTags(loadUserLickTags());
		store.clear();
		lickPractice.config.progressionType = 'ii-V-I-major';
		lickPractice.config.enableSubstitutions = true;
		expect(getPracticeLicks().find(l => l.id === MINOR_LICK_ID)).toBeUndefined();
	});
});
