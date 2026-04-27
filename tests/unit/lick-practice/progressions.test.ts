import { describe, it, expect } from 'vitest';
import {
	PROGRESSION_TEMPLATES,
	transposeProgression,
	PROGRESSION_LICK_CATEGORIES,
	getLickAlignmentOffset,
	getChordRootAtOffset,
	isChordQualityCategory,
	CHORD_SUBSTITUTION_RULES,
	getSubstitutionCategories,
	findApplicableSubstitution,
	applySubstitutionOffset,
	getSubstitutionAlignmentOffset,
	resolveLickAlignmentOffset,
	resolveTransposeTarget,
	getActiveSubstitution,
	progressionHasSubstitutionTargets,
	getChordQualityAtOffset,
	detectPickupBars
} from '$lib/data/progressions';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import { PITCH_CLASSES, type Note, type PitchClass } from '$lib/types/music';
import { fractionToFloat } from '$lib/music/intervals';

describe('PROGRESSION_TEMPLATES', () => {
	const types: ChordProgressionType[] = [
		'ii-V-I-major', 'ii-V-I-minor',
		'ii-V-I-major-long', 'ii-V-I-minor-long',
		'turnaround', 'blues'
	];

	it('defines all 6 progression types', () => {
		for (const type of types) {
			expect(PROGRESSION_TEMPLATES[type]).toBeDefined();
			expect(PROGRESSION_TEMPLATES[type].type).toBe(type);
		}
	});

	it('all progressions have valid harmony segments', () => {
		for (const type of types) {
			const template = PROGRESSION_TEMPLATES[type];
			expect(template.harmony.length).toBeGreaterThan(0);

			for (const seg of template.harmony) {
				expect(PITCH_CLASSES).toContain(seg.chord.root);
				expect(seg.chord.quality).toBeTruthy();
				expect(seg.scaleId).toBeTruthy();
				expect(fractionToFloat(seg.startOffset)).toBeGreaterThanOrEqual(0);
				expect(fractionToFloat(seg.duration)).toBeGreaterThan(0);
			}
		}
	});

	it('harmony segments do not overlap within each progression', () => {
		for (const type of types) {
			const template = PROGRESSION_TEMPLATES[type];
			for (let i = 1; i < template.harmony.length; i++) {
				const prevEnd = fractionToFloat(template.harmony[i - 1].startOffset)
					+ fractionToFloat(template.harmony[i - 1].duration);
				const currStart = fractionToFloat(template.harmony[i].startOffset);
				expect(currStart).toBeGreaterThanOrEqual(prevEnd - 0.001);
			}
		}
	});

	it('short ii-V-I major is 2 bars: Dm7 (2 beats) G7 (2 beats) Cmaj7 (4 beats)', () => {
		const t = PROGRESSION_TEMPLATES['ii-V-I-major'];
		expect(t.bars).toBe(2);
		expect(t.harmony).toHaveLength(3);
		expect(t.harmony[0].chord.root).toBe('D');
		expect(t.harmony[0].chord.quality).toBe('min7');
		expect(fractionToFloat(t.harmony[0].duration) * 4).toBe(2); // 2 beats
		expect(t.harmony[1].chord.root).toBe('G');
		expect(t.harmony[1].chord.quality).toBe('7');
		expect(fractionToFloat(t.harmony[1].duration) * 4).toBe(2); // 2 beats
		expect(t.harmony[2].chord.root).toBe('C');
		expect(t.harmony[2].chord.quality).toBe('maj7');
		expect(fractionToFloat(t.harmony[2].duration) * 4).toBe(4); // 4 beats (1 bar)
		const totalBeats = t.harmony.reduce((sum, seg) => sum + fractionToFloat(seg.duration) * 4, 0);
		expect(totalBeats).toBe(8); // 2 bars * 4 beats
	});

	it('blues has correct 12-bar structure (7 segments)', () => {
		const h = PROGRESSION_TEMPLATES['blues'].harmony;
		expect(h).toHaveLength(7);
		const totalBeats = h.reduce((sum, seg) => sum + fractionToFloat(seg.duration) * 4, 0);
		expect(totalBeats).toBe(48); // 12 bars * 4 beats
	});
});

describe('transposeProgression', () => {
	it('returns original harmony when target key is C', () => {
		const original = PROGRESSION_TEMPLATES['ii-V-I-major'].harmony;
		const transposed = transposeProgression(original, 'C');
		expect(transposed).toBe(original);
	});

	it('transposes ii-V-I major to F (Gm7 → C7 → Fmaj7)', () => {
		const original = PROGRESSION_TEMPLATES['ii-V-I-major'].harmony;
		const transposed = transposeProgression(original, 'F');
		expect(transposed[0].chord.root).toBe('G');
		expect(transposed[0].chord.quality).toBe('min7');
		expect(transposed[1].chord.root).toBe('C');
		expect(transposed[1].chord.quality).toBe('7');
		expect(transposed[2].chord.root).toBe('F');
		expect(transposed[2].chord.quality).toBe('maj7');
	});

	it('transposes to Bb (Cm7 → F7 → Bbmaj7)', () => {
		const original = PROGRESSION_TEMPLATES['ii-V-I-major'].harmony;
		const transposed = transposeProgression(original, 'Bb');
		expect(transposed[0].chord.root).toBe('C');
		expect(transposed[1].chord.root).toBe('F');
		expect(transposed[2].chord.root).toBe('Bb');
	});

	it('preserves segment durations and offsets', () => {
		const original = PROGRESSION_TEMPLATES['ii-V-I-major'].harmony;
		const transposed = transposeProgression(original, 'Ab');
		for (let i = 0; i < original.length; i++) {
			expect(transposed[i].startOffset).toEqual(original[i].startOffset);
			expect(transposed[i].duration).toEqual(original[i].duration);
			expect(transposed[i].scaleId).toBe(original[i].scaleId);
		}
	});

	it('transposes all 12 keys without error', () => {
		const original = PROGRESSION_TEMPLATES['turnaround'].harmony;
		for (const key of PITCH_CLASSES) {
			const transposed = transposeProgression(original, key);
			expect(transposed).toHaveLength(original.length);
		}
	});
});

describe('PROGRESSION_LICK_CATEGORIES', () => {
	it('every progression type has at least one compatible lick category', () => {
		const allTypes: ChordProgressionType[] = [
			'ii-V-I-major', 'ii-V-I-minor',
			'ii-V-I-major-long', 'ii-V-I-minor-long',
			'turnaround', 'blues'
		];
		for (const type of allTypes) {
			expect(PROGRESSION_LICK_CATEGORIES[type], `${type} should be defined`).toBeDefined();
			expect(PROGRESSION_LICK_CATEGORIES[type].length, `${type} should have compatible categories`).toBeGreaterThan(0);
		}
	});

	it('every entry has a category and a fraction offset', () => {
		for (const entries of Object.values(PROGRESSION_LICK_CATEGORIES)) {
			for (const entry of entries) {
				expect(entry.category).toBeTruthy();
				expect(Array.isArray(entry.offset)).toBe(true);
				expect(entry.offset.length).toBe(2);
			}
		}
	});
});

describe('getLickAlignmentOffset', () => {
	it('returns [0,1] for unknown category (safe default)', () => {
		expect(getLickAlignmentOffset('ii-V-I-major-long', 'pentatonic')).toEqual([0, 1]);
	});

	it('aligns V-I-major at bar 1 of long ii-V-I major', () => {
		expect(getLickAlignmentOffset('ii-V-I-major-long', 'V-I-major')).toEqual([1, 1]);
	});

	it('aligns V-I-minor at bar 1 of long ii-V-I minor', () => {
		expect(getLickAlignmentOffset('ii-V-I-minor-long', 'V-I-minor')).toEqual([1, 1]);
	});

	it('aligns chord-quality licks correctly in long ii-V-I major', () => {
		expect(getLickAlignmentOffset('ii-V-I-major-long', 'minor-chord')).toEqual([0, 1]);
		expect(getLickAlignmentOffset('ii-V-I-major-long', 'dominant-chord')).toEqual([1, 1]);
		expect(getLickAlignmentOffset('ii-V-I-major-long', 'major-chord')).toEqual([2, 1]);
	});

	it('aligns chord-quality licks correctly in long ii-V-I minor', () => {
		expect(getLickAlignmentOffset('ii-V-I-minor-long', 'diminished-chord')).toEqual([0, 1]);
		expect(getLickAlignmentOffset('ii-V-I-minor-long', 'dominant-chord')).toEqual([1, 1]);
		expect(getLickAlignmentOffset('ii-V-I-minor-long', 'minor-chord')).toEqual([2, 1]);
	});

	it('aligns major-chord at bar 1 in short ii-V-I major (I chord)', () => {
		expect(getLickAlignmentOffset('ii-V-I-major', 'major-chord')).toEqual([1, 1]);
	});

	it('aligns minor-chord at bar 1 in short ii-V-I minor (I chord)', () => {
		expect(getLickAlignmentOffset('ii-V-I-minor', 'minor-chord')).toEqual([1, 1]);
	});
});

describe('getChordRootAtOffset', () => {
	it('returns ii root for bar 0 of long ii-V-I major in C', () => {
		expect(getChordRootAtOffset('ii-V-I-major-long', 'C', [0, 1])).toBe('D');
	});

	it('returns V root for bar 1 of long ii-V-I major in F', () => {
		// In F: ii=Gm7, V=C7, I=Fmaj7
		expect(getChordRootAtOffset('ii-V-I-major-long', 'F', [1, 1])).toBe('C');
	});

	it('returns I root for bar 2 of long ii-V-I major in F', () => {
		expect(getChordRootAtOffset('ii-V-I-major-long', 'F', [2, 1])).toBe('F');
	});

	it('returns null when no segment starts at the offset', () => {
		expect(getChordRootAtOffset('ii-V-I-major-long', 'C', [7, 8])).toBeNull();
	});
});

describe('isChordQualityCategory', () => {
	it('flags chord-quality categories', () => {
		expect(isChordQualityCategory('major-chord')).toBe(true);
		expect(isChordQualityCategory('dominant-chord')).toBe(true);
		expect(isChordQualityCategory('minor-chord')).toBe(true);
		expect(isChordQualityCategory('diminished-chord')).toBe(true);
	});

	it('does not flag sub-progression or full-progression categories', () => {
		expect(isChordQualityCategory('V-I-major')).toBe(false);
		expect(isChordQualityCategory('ii-V-I-major')).toBe(false);
		expect(isChordQualityCategory('pentatonic')).toBe(false);
	});
});

describe('CHORD_SUBSTITUTION_RULES', () => {
	it('includes the minor-over-dominant rule', () => {
		const rule = CHORD_SUBSTITUTION_RULES.find(r => r.id === 'minor-over-dominant');
		expect(rule).toBeDefined();
		expect(rule?.sourceCategory).toBe('minor-chord');
		expect(rule?.targetQuality).toBe('7');
		expect(rule?.semitoneOffset).toBe(1);
	});
});

describe('getSubstitutionCategories', () => {
	it('returns [] when substitutions are disabled', () => {
		expect(getSubstitutionCategories('ii-V-I-major', false)).toEqual([]);
		expect(getSubstitutionCategories('blues', false)).toEqual([]);
	});

	it('includes minor-chord for ii-V-I-major (has G7)', () => {
		expect(getSubstitutionCategories('ii-V-I-major', true)).toContain('minor-chord');
	});

	it('includes minor-chord for ii-V-I-major-long (has G7)', () => {
		expect(getSubstitutionCategories('ii-V-I-major-long', true)).toContain('minor-chord');
	});

	it('includes minor-chord for blues (multiple 7 chords)', () => {
		expect(getSubstitutionCategories('blues', true)).toContain('minor-chord');
	});

	it('includes minor-chord for turnaround (has A7 and G7)', () => {
		expect(getSubstitutionCategories('turnaround', true)).toContain('minor-chord');
	});

	it('omits minor-chord for minor ii-V-I (V is 7alt, not 7)', () => {
		expect(getSubstitutionCategories('ii-V-I-minor', true)).not.toContain('minor-chord');
		expect(getSubstitutionCategories('ii-V-I-minor-long', true)).not.toContain('minor-chord');
	});

	it('does not return duplicate entries when multiple rules share a source category', () => {
		const result = getSubstitutionCategories('blues', true);
		const minorCount = result.filter(c => c === 'minor-chord').length;
		expect(minorCount).toBeLessThanOrEqual(1);
	});
});

describe('findApplicableSubstitution', () => {
	it('finds minor-over-dominant for minor-chord + 7', () => {
		const rule = findApplicableSubstitution('minor-chord', '7');
		expect(rule).not.toBeNull();
		expect(rule?.id).toBe('minor-over-dominant');
	});

	it('returns null for minor-chord + min7 (no rule)', () => {
		expect(findApplicableSubstitution('minor-chord', 'min7')).toBeNull();
	});

	it('returns null for minor-chord + 7alt (rule targets 7, not 7alt)', () => {
		expect(findApplicableSubstitution('minor-chord', '7alt')).toBeNull();
	});

	it('returns null for unrelated categories', () => {
		expect(findApplicableSubstitution('pentatonic', '7')).toBeNull();
		expect(findApplicableSubstitution('major-chord', '7')).toBeNull();
	});
});

describe('applySubstitutionOffset', () => {
	it('shifts G up by 1 semitone to Ab', () => {
		expect(applySubstitutionOffset('G', 1)).toBe('Ab');
	});

	it('shifts C up by 1 semitone to Db', () => {
		expect(applySubstitutionOffset('C', 1)).toBe('Db');
	});

	it('wraps B up by 1 semitone to C', () => {
		expect(applySubstitutionOffset('B', 1)).toBe('C');
	});

	it('wraps modulo 12 for large positive offsets', () => {
		expect(applySubstitutionOffset('C', 13)).toBe('Db');
		expect(applySubstitutionOffset('C', 12)).toBe('C');
	});

	it('handles zero offset (identity)', () => {
		for (const pc of PITCH_CLASSES) {
			expect(applySubstitutionOffset(pc, 0)).toBe(pc);
		}
	});

	it('handles negative offsets', () => {
		expect(applySubstitutionOffset('C', -1)).toBe('B');
		expect(applySubstitutionOffset('Ab', -1)).toBe('G');
	});
});

describe('getSubstitutionAlignmentOffset', () => {
	it('returns the V7 offset for minor-chord in short ii-V-I major (half-bar)', () => {
		// In short ii-V-I-major, G7 starts at [1, 2] (half-bar).
		expect(getSubstitutionAlignmentOffset('ii-V-I-major', 'minor-chord')).toEqual([1, 2]);
	});

	it('returns the V7 offset for minor-chord in long ii-V-I major (bar 1)', () => {
		expect(getSubstitutionAlignmentOffset('ii-V-I-major-long', 'minor-chord')).toEqual([1, 1]);
	});

	it('returns the first 7 chord offset in blues (bar 0)', () => {
		expect(getSubstitutionAlignmentOffset('blues', 'minor-chord')).toEqual([0, 1]);
	});

	it('returns null when no rule matches the category', () => {
		expect(getSubstitutionAlignmentOffset('ii-V-I-major', 'pentatonic')).toBeNull();
		expect(getSubstitutionAlignmentOffset('ii-V-I-major', 'major-chord')).toBeNull();
	});

	it('returns null when progression has no matching target quality', () => {
		// Minor ii-V-I uses 7alt, not 7 — no match.
		expect(getSubstitutionAlignmentOffset('ii-V-I-minor', 'minor-chord')).toBeNull();
		expect(getSubstitutionAlignmentOffset('ii-V-I-minor-long', 'minor-chord')).toBeNull();
	});
});

describe('resolveLickAlignmentOffset', () => {
	it('prefers native mapping over substitution even when enableSubstitutions=true', () => {
		// minor-chord natively maps to ii in long ii-V-I-major (offset [0,1]).
		expect(resolveLickAlignmentOffset('ii-V-I-major-long', 'minor-chord', true)).toEqual([0, 1]);
	});

	it('falls back to substitution when no native mapping and enableSubstitutions=true', () => {
		// minor-chord has NO native mapping in short ii-V-I-major.
		expect(resolveLickAlignmentOffset('ii-V-I-major', 'minor-chord', true)).toEqual([1, 2]);
	});

	it('returns default [0,1] when no native mapping and enableSubstitutions=false', () => {
		expect(resolveLickAlignmentOffset('ii-V-I-major', 'minor-chord', false)).toEqual([0, 1]);
	});

	it('returns default [0,1] for unknown category even with enableSubstitutions=true', () => {
		expect(resolveLickAlignmentOffset('ii-V-I-major', 'pentatonic', true)).toEqual([0, 1]);
	});
});

describe('getChordQualityAtOffset', () => {
	it('returns min7 for ii at bar 0 of long ii-V-I-major', () => {
		expect(getChordQualityAtOffset('ii-V-I-major-long', [0, 1])).toBe('min7');
	});

	it('returns 7 for V at bar 1 of long ii-V-I-major', () => {
		expect(getChordQualityAtOffset('ii-V-I-major-long', [1, 1])).toBe('7');
	});

	it('returns 7 for V at half-bar in short ii-V-I-major', () => {
		expect(getChordQualityAtOffset('ii-V-I-major', [1, 2])).toBe('7');
	});

	it('returns null when no segment starts at the offset', () => {
		expect(getChordQualityAtOffset('ii-V-I-major-long', [7, 8])).toBeNull();
	});
});

describe('resolveTransposeTarget', () => {
	it('returns session key for non-chord-quality categories', () => {
		expect(resolveTransposeTarget('F', 'pentatonic', 'ii-V-I-major-long', [0, 1], false)).toBe('F');
		expect(resolveTransposeTarget('Bb', 'ii-V-I-major', 'ii-V-I-major-long', [0, 1], true)).toBe('Bb');
	});

	it('returns chord root for chord-quality categories', () => {
		// Long ii-V-I in F → ii=Gm7, so minor-chord lick transposes to G.
		expect(resolveTransposeTarget('F', 'minor-chord', 'ii-V-I-major-long', [0, 1], false)).toBe('G');
	});

	it('applies substitution offset when enableSubstitutions=true and rule matches', () => {
		// Short ii-V-I in C, minor-chord via substitution → V=G7, shifted up 1 → Ab.
		expect(resolveTransposeTarget('C', 'minor-chord', 'ii-V-I-major', [1, 2], true)).toBe('Ab');
	});

	it('does NOT apply substitution when enableSubstitutions=false', () => {
		// Same setup but substitutions disabled — transposes to raw V root (G).
		expect(resolveTransposeTarget('C', 'minor-chord', 'ii-V-I-major', [1, 2], false)).toBe('G');
	});

	it('does NOT apply substitution when target chord quality does not match rule', () => {
		// minor-chord over ii (min7) does not match minor-over-dominant rule (targets 7).
		// Transposes to raw ii root (D).
		expect(resolveTransposeTarget('C', 'minor-chord', 'ii-V-I-major-long', [0, 1], true)).toBe('D');
	});

	it('applies substitution in multiple keys correctly', () => {
		// In F ii-V-I-major-long, V=C7 → Cm7 lick substituted = Db.
		expect(resolveTransposeTarget('F', 'minor-chord', 'ii-V-I-major-long', [1, 1], true)).toBe('Db');
		// In Bb, V=F7 → shifted = Gb. But PITCH_CLASSES has 'F#' not 'Gb'.
		expect(resolveTransposeTarget('Bb', 'minor-chord', 'ii-V-I-major-long', [1, 1], true)).toBe('F#');
	});
});

describe('getActiveSubstitution', () => {
	it('returns null when enableSubstitutions=false', () => {
		expect(getActiveSubstitution('ii-V-I-major', 'minor-chord', false)).toBeNull();
	});

	it('returns null when the lick has a native mapping', () => {
		// minor-chord natively maps to ii in long ii-V-I-major.
		expect(getActiveSubstitution('ii-V-I-major-long', 'minor-chord', true)).toBeNull();
	});

	it('returns the rule when substitution is actually in play', () => {
		// No native minor-chord mapping in short ii-V-I-major → substitution active.
		const rule = getActiveSubstitution('ii-V-I-major', 'minor-chord', true);
		expect(rule).not.toBeNull();
		expect(rule?.id).toBe('minor-over-dominant');
	});

	it('returns null when the progression has no matching target chord', () => {
		// ii-V-I-minor uses 7alt for V, not 7 — rule does not fire.
		expect(getActiveSubstitution('ii-V-I-minor', 'minor-chord', true)).toBeNull();
	});

	it('returns the rule on blues where minor-chord has no native mapping', () => {
		expect(getActiveSubstitution('blues', 'minor-chord', true)?.id).toBe('minor-over-dominant');
	});
});

describe('progressionHasSubstitutionTargets', () => {
	it('is true for progressions with a 7 chord', () => {
		expect(progressionHasSubstitutionTargets('ii-V-I-major')).toBe(true);
		expect(progressionHasSubstitutionTargets('ii-V-I-major-long')).toBe(true);
		expect(progressionHasSubstitutionTargets('turnaround')).toBe(true);
		expect(progressionHasSubstitutionTargets('blues')).toBe(true);
	});

	it('is false for progressions whose only dominant is 7alt', () => {
		expect(progressionHasSubstitutionTargets('ii-V-I-minor')).toBe(false);
		expect(progressionHasSubstitutionTargets('ii-V-I-minor-long')).toBe(false);
	});
});

describe('detectPickupBars', () => {
	function note(offset: [number, number]): Note {
		return { pitch: 60, duration: [1, 8], offset };
	}

	it('returns 0 when the first note is on a downbeat', () => {
		expect(detectPickupBars([note([0, 1]), note([1, 4]), note([1, 2])])).toBe(0);
	});

	it('returns 0 for an empty note list', () => {
		expect(detectPickupBars([])).toBe(0);
	});

	it('returns 1 for a triplet pickup leading into bar 1', () => {
		// Anacrusis on beat 4 of bar 0; bulk downbeat at [1, 1].
		const notes = [
			note([3, 4]),
			note([5, 6]),
			note([11, 12]),
			note([1, 1]),
			note([2, 1])
		];
		expect(detectPickupBars(notes)).toBe(1);
	});

	it('returns 1 for an eighth-note pickup before bar 1', () => {
		// Single anacrusis eighth, then a downbeat at [1, 1].
		expect(detectPickupBars([note([7, 8]), note([1, 1]), note([5, 4])])).toBe(1);
	});

	it('returns 0 for a fully-syncopated multi-bar lick (no integer downbeat)', () => {
		// Notes never land exactly on a whole-bar boundary — heuristic stays safe.
		expect(detectPickupBars([note([1, 8]), note([3, 8]), note([5, 8]), note([9, 8])])).toBe(0);
	});

	it('does not infer pickup when notes start at [0, 1] even with later integer offsets', () => {
		// Standard 3-bar ii-V-I shape: bar 0 downbeat present, no anacrusis.
		expect(detectPickupBars([note([0, 1]), note([1, 1]), note([2, 1])])).toBe(0);
	});

	it('uses the EARLIEST integer downbeat, not the latest', () => {
		// First downbeat note at [1, 1]; even though [3, 1] also exists, pickupBars = 1.
		expect(detectPickupBars([note([3, 4]), note([1, 1]), note([3, 1])])).toBe(1);
	});

	it('ignores note order — works on unsorted input', () => {
		// Reversed order vs. the triplet-pickup case.
		const notes = [
			note([2, 1]),
			note([1, 1]),
			note([11, 12]),
			note([5, 6]),
			note([3, 4])
		];
		expect(detectPickupBars(notes)).toBe(1);
	});
});
