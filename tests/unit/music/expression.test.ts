import { describe, it, expect } from 'vitest';
import type { Phrase, Note, HarmonicSegment } from '$lib/types/music';
import {
	extractSoundingNotes,
	computeExpression,
	computePhraseExpression
} from '$lib/music/expression';

const C7_HARMONY: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: '7' }, scaleId: 'bebop.dominant', startOffset: [0, 1], duration: [1, 1] }
];

function makePhrase(notes: Note[], harmony: HarmonicSegment[] = C7_HARMONY): Phrase {
	return {
		id: 'test',
		name: 'Test',
		timeSignature: [4, 4],
		key: 'C',
		notes,
		harmony,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'bebop-lines',
		tags: [],
		source: 'curated'
	};
}

// One bar of straight eighths over C7. Roles chosen so we can assert dynamics:
// idx0 C  (beat0, strong)   chord tone → accent target (also first note)
// idx1 D  (beat0.5, off)    scale tone
// idx2 E  (beat1, weak on)  chord tone
// idx3 Eb (beat1.5, off)    CHROMATIC eighth, weak → ghost
// idx4 G5 (beat2, strong)   chord tone, highest → accent target + apex
// idx5 A  (beat2.5, off)    scale tone
// idx6 Bb (beat3, weak on)  chord tone
// idx7 C  (beat3.5, off)    chord tone (final)
const EIGHTH_LINE: Note[] = [
	{ pitch: 60, duration: [1, 8], offset: [0, 1] },
	{ pitch: 62, duration: [1, 8], offset: [1, 8] },
	{ pitch: 64, duration: [1, 8], offset: [1, 4] },
	{ pitch: 63, duration: [1, 8], offset: [3, 8] },
	{ pitch: 79, duration: [1, 8], offset: [1, 2] },
	{ pitch: 69, duration: [1, 8], offset: [5, 8] },
	{ pitch: 70, duration: [1, 8], offset: [3, 4] },
	{ pitch: 72, duration: [1, 8], offset: [7, 8] }
];

describe('extractSoundingNotes', () => {
	it('skips rests', () => {
		const notes: Note[] = [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },
			{ pitch: null, duration: [1, 4], offset: [1, 4] },
			{ pitch: 64, duration: [1, 4], offset: [1, 2] }
		];
		const sounding = extractSoundingNotes(notes);
		expect(sounding.map((s) => s.pitch)).toEqual([60, 64]);
		expect(sounding.map((s) => s.index)).toEqual([0, 1]);
	});

	it('reports sourceIndex as the input-array position, skipping rests', () => {
		const notes: Note[] = [
			{ pitch: null, duration: [1, 4], offset: [0, 1] },
			{ pitch: 60, duration: [1, 4], offset: [1, 4] },
			{ pitch: null, duration: [1, 4], offset: [1, 2] },
			{ pitch: 64, duration: [1, 4], offset: [3, 4] }
		];
		const sounding = extractSoundingNotes(notes);
		expect(sounding.map((s) => s.sourceIndex)).toEqual([1, 3]);
	});

	it('reports the tie chain start as sourceIndex for merged chains', () => {
		const notes: Note[] = [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },
			{ pitch: 62, duration: [1, 2], offset: [1, 4], tied: true },
			{ pitch: 62, duration: [1, 4], offset: [3, 4] },
			{ pitch: 65, duration: [1, 4], offset: [1, 1] }
		];
		const sounding = extractSoundingNotes(notes);
		expect(sounding.map((s) => s.pitch)).toEqual([60, 62, 65]);
		expect(sounding.map((s) => s.sourceIndex)).toEqual([0, 1, 3]);
	});

	it('keeps sourceIndex identical to index for rest-free untied lines', () => {
		const sounding = extractSoundingNotes(EIGHTH_LINE);
		expect(sounding.map((s) => s.sourceIndex)).toEqual(sounding.map((s) => s.index));
	});

	it('merges a same-pitch tie chain into one sounding note with summed duration', () => {
		const notes: Note[] = [
			{ pitch: 60, duration: [1, 4], offset: [0, 1], tied: true },
			{ pitch: 60, duration: [1, 4], offset: [1, 4] },
			{ pitch: 64, duration: [1, 4], offset: [1, 2] }
		];
		const sounding = extractSoundingNotes(notes);
		expect(sounding).toHaveLength(2);
		expect(sounding[0].pitch).toBe(60);
		expect(sounding[0].duration).toEqual([1, 2]); // 1/4 + 1/4
		expect(sounding[1].pitch).toBe(64);
	});

	it('does not merge a tie across different pitches', () => {
		const notes: Note[] = [
			{ pitch: 60, duration: [1, 4], offset: [0, 1], tied: true },
			{ pitch: 62, duration: [1, 4], offset: [1, 4] }
		];
		expect(extractSoundingNotes(notes)).toHaveLength(2);
	});
});

describe('computeExpression — dynamics', () => {
	const phrase = makePhrase(EIGHTH_LINE);
	const expr = computeExpression(extractSoundingNotes(phrase.notes), phrase);

	it('accents chord-tone targets on strong beats past the forte split (>100)', () => {
		expect(expr[4].velocity).toBeGreaterThan(100); // G on beat 2, apex
		expect(expr[0].velocity).toBeGreaterThan(100); // C on beat 1 (downbeat target)
	});

	it('de-emphasizes a chromatic passing tone (ghost, softer than the melody)', () => {
		expect(expr[3].isGhost).toBe(true);
		expect(expr[3].velocity).toBeLessThan(85); // clearly under the ~88 mp line
	});

	it('shapes a phrase arch that peaks above both endpoints', () => {
		const apex = expr[4].velocity;
		expect(apex).toBeGreaterThan(expr[0].velocity);
		expect(apex).toBeGreaterThan(expr[7].velocity);
	});

	it('releases the final note softer than the apex', () => {
		expect(expr[7].velocity).toBeLessThan(expr[4].velocity);
	});

	it('keeps all velocities within the musical clamp', () => {
		for (const e of expr) {
			expect(e.velocity).toBeGreaterThanOrEqual(45);
			expect(e.velocity).toBeLessThanOrEqual(122);
		}
	});
});

describe('computeExpression — layer selection is deterministic (flicker fix)', () => {
	const phrase = makePhrase(EIGHTH_LINE);

	it('sets layerVelocity to the intended (un-humanized) velocity', () => {
		const expr = computeExpression(extractSoundingNotes(phrase.notes), phrase);
		for (const e of expr) expect(e.layerVelocity).toBe(e.velocity);
	});

	it('produces identical output across repeated calls (no randomness)', () => {
		const a = computeExpression(extractSoundingNotes(phrase.notes), phrase);
		const b = computeExpression(extractSoundingNotes(phrase.notes), phrase);
		expect(a).toEqual(b);
	});
});

describe('computeExpression — articulation', () => {
	it('plays a scalar eighth-note run legato (near-full length)', () => {
		const phrase = makePhrase(EIGHTH_LINE);
		const expr = computeExpression(extractSoundingNotes(phrase.notes), phrase);
		// idx5 (A, beat2.5): eighth, not ghost, not final, not before an accent.
		expect(expr[5].durationScale).toBeGreaterThanOrEqual(0.97);
	});

	it('detaches on-beat swing quarters', () => {
		const quarters: Note[] = [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },
			{ pitch: 62, duration: [1, 4], offset: [1, 4] },
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }
		];
		const phrase = makePhrase(quarters);
		const expr = computeExpression(extractSoundingNotes(phrase.notes), phrase);
		// idx1 (D, beat1): interior quarter, detached.
		expect(expr[1].durationScale).toBeLessThanOrEqual(0.9);
	});

	it('clips a staccato-marked note short', () => {
		const notes: Note[] = [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },
			{ pitch: 64, duration: [1, 4], offset: [1, 4], articulation: 'staccato' },
			{ pitch: 67, duration: [1, 4], offset: [1, 2] }
		];
		const phrase = makePhrase(notes);
		const expr = computeExpression(extractSoundingNotes(phrase.notes), phrase);
		expect(expr[1].durationScale).toBeLessThanOrEqual(0.55);
	});
});

describe('computeExpression — authored overrides honored', () => {
	it('uses an authored velocity verbatim as intended loudness', () => {
		const notes: Note[] = [
			{ pitch: 60, duration: [1, 8], offset: [0, 1], velocity: 41 },
			{ pitch: 62, duration: [1, 8], offset: [1, 8] }
		];
		const phrase = makePhrase(notes);
		const expr = computeExpression(extractSoundingNotes(phrase.notes), phrase);
		expect(expr[0].velocity).toBe(41);
		expect(expr[0].layerVelocity).toBe(41);
	});

	it('honors an authored articulation over the computed default', () => {
		// A stepwise eighth would default to legato; mark it staccato instead.
		const notes: Note[] = [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 62, duration: [1, 8], offset: [1, 8], articulation: 'staccato' },
			{ pitch: 64, duration: [1, 8], offset: [1, 4] }
		];
		const phrase = makePhrase(notes);
		const expr = computeExpression(extractSoundingNotes(phrase.notes), phrase);
		expect(expr[1].durationScale).toBeLessThanOrEqual(0.55);
	});
});

describe('computeExpression — intensity scaling', () => {
	const phrase = makePhrase(EIGHTH_LINE);
	const sounding = extractSoundingNotes(phrase.notes);

	it('widens accents with intensity while ghost loudness stays a fixed tuning', () => {
		const subtle = computeExpression(sounding, phrase, { intensity: 'subtle' });
		const pronounced = computeExpression(sounding, phrase, { intensity: 'pronounced' });
		// The apex accent (idx4) is louder under pronounced.
		expect(pronounced[4].velocity).toBeGreaterThan(subtle[4].velocity);
		// The ghost (idx3) loudness comes from its tuning, not the intensity knob.
		expect(subtle[3].isGhost).toBe(true);
		expect(pronounced[3].velocity).toBe(subtle[3].velocity);
	});
});

describe('computePhraseExpression — convenience wrapper', () => {
	it('returns aligned sounding notes and expression arrays', () => {
		const phrase = makePhrase(EIGHTH_LINE);
		const { sounding, expression } = computePhraseExpression(phrase);
		expect(sounding).toHaveLength(expression.length);
		expect(sounding).toHaveLength(8);
	});
});

describe('computeExpression — ghost notes are de-emphasized but legato', () => {
	it('renders a ghost as softer + muffled, yet connected (not staccato)', () => {
		const phrase = makePhrase(EIGHTH_LINE);
		const expr = computeExpression(extractSoundingNotes(phrase.notes), phrase);
		const ghost = expr.find((e) => e.isGhost);
		expect(ghost).toBeDefined();
		expect(ghost!.velocity).toBeLessThan(85); // de-emphasized vs the ~88 melody
		expect(ghost!.cutoffHz).toBeLessThan(4500); // muffled beneath the global warmth
		expect(ghost!.cutoffHz).toBeGreaterThan(3000); // but subtler than the old ~2300
		expect(ghost!.durationScale).toBeGreaterThanOrEqual(0.85); // LEGATO — airstream stays connected
		expect(ghost!.release).toBeGreaterThanOrEqual(0.1); // long enough to connect the line
	});

	it('fully ghosts an authored articulation:ghost even when a velocity is set (gap fix)', () => {
		const notes: Note[] = [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 64, duration: [1, 8], offset: [1, 8], articulation: 'ghost', velocity: 80 },
			{ pitch: 67, duration: [1, 8], offset: [1, 4] }
		];
		const phrase = makePhrase(notes);
		const expr = computeExpression(extractSoundingNotes(phrase.notes), phrase);
		expect(expr[1].isGhost).toBe(true);
		expect(expr[1].velocity).toBeLessThan(80); // ghost tuning overrides the authored 80
	});

});

describe('computeExpression — broadened ghost selection', () => {
	it('ghosts a chromatic passing tone', () => {
		const phrase = makePhrase(EIGHTH_LINE); // idx3 Eb is chromatic over C7
		const expr = computeExpression(extractSoundingNotes(phrase.notes), phrase);
		expect(expr[3].isGhost).toBe(true);
	});

	it('ghosts a stepwise passing tone (approached and left by step)', () => {
		const notes: Note[] = [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] }, // C strong (first)
			{ pitch: 62, duration: [1, 8], offset: [1, 8] }, // D off, C->D->E stepwise passing
			{ pitch: 64, duration: [1, 8], offset: [1, 4] } // E
		];
		const phrase = makePhrase(notes);
		const expr = computeExpression(extractSoundingNotes(phrase.notes), phrase);
		expect(expr[1].isGhost).toBe(true);
	});

	it('ghosts a stepwise approach into an accent target', () => {
		const notes: Note[] = [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] }, // C beat0 strong (first)
			{ pitch: 64, duration: [1, 8], offset: [1, 8] }, // E off chord tone
			{ pitch: 69, duration: [1, 8], offset: [1, 4] }, // A beat1 leap up
			{ pitch: 65, duration: [1, 8], offset: [3, 8] }, // F beat1.5 off, leap-in then step up into G
			{ pitch: 67, duration: [1, 8], offset: [1, 2] }, // G beat2 strong chord tone → accent target
			{ pitch: 72, duration: [1, 8], offset: [5, 8] } // C off (final)
		];
		const phrase = makePhrase(notes);
		const expr = computeExpression(extractSoundingNotes(phrase.notes), phrase);
		expect(expr[3].isGhost).toBe(true); // F approaches the G accent by step
		expect(expr[1].isGhost).toBe(false); // E is a chord tone → voiced
		expect(expr[4].isGhost).toBe(false); // G accent target → voiced
	});

	it('ghosts a repeated-note weak upbeat but leaves the melodic apex voiced', () => {
		const notes: Note[] = [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] }, // C strong (first)
			{ pitch: 69, duration: [1, 8], offset: [1, 8] }, // A off scale tone — apex (first max)
			{ pitch: 69, duration: [1, 8], offset: [1, 4] }, // A repeated (not strong) → ghost
			{ pitch: 67, duration: [1, 8], offset: [3, 8] }, // G off chord tone
			{ pitch: 65, duration: [1, 8], offset: [1, 2] } // F (final)
		];
		const phrase = makePhrase(notes);
		const expr = computeExpression(extractSoundingNotes(phrase.notes), phrase);
		expect(expr[2].isGhost).toBe(true); // repeated A
		expect(expr[1].isGhost).toBe(false); // apex A stays voiced
	});

	it('ghosts the low note of a big leap down then big leap up (the Blue Monk figure)', () => {
		const notes: Note[] = [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] }, // C5 (first)
			{ pitch: 74, duration: [1, 8], offset: [1, 8] }, // D5
			{ pitch: 65, duration: [1, 8], offset: [1, 4] }, // F4 — leap DOWN a 6th, then leap UP → low note ghosts
			{ pitch: 74, duration: [1, 8], offset: [3, 8] }, // D5 (leap up)
			{ pitch: 79, duration: [1, 8], offset: [1, 2] } // G5 (final, apex)
		];
		const phrase = makePhrase(notes);
		const expr = computeExpression(extractSoundingNotes(phrase.notes), phrase);
		expect(expr[2].isGhost).toBe(true); // the low F4
		expect(expr[1].isGhost).toBe(false);
		expect(expr[3].isGhost).toBe(false);
	});
});

describe('computeExpression — ghost guards keep the line intelligible', () => {
	it('never ghosts strong-beat chord-tone accents, the apex, or the first/last note', () => {
		const phrase = makePhrase(EIGHTH_LINE);
		const expr = computeExpression(extractSoundingNotes(phrase.notes), phrase);
		expect(expr[0].isGhost).toBe(false); // first note (also a downbeat accent)
		expect(expr[4].isGhost).toBe(false); // apex + strong-beat accent target
		expect(expr[expr.length - 1].isGhost).toBe(false); // final note
		// Not everything is ghosted — structural notes stay voiced.
		expect(expr.filter((e) => !e.isGhost).length).toBeGreaterThan(expr.length / 2);
	});

	it('does not ghost a stepwise passing tone that is a quarter note', () => {
		const notes: Note[] = [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] }, // C quarter
			{ pitch: 62, duration: [1, 4], offset: [1, 4] }, // D quarter — stepwise passing, but too long to ghost
			{ pitch: 64, duration: [1, 4], offset: [1, 2] } // E quarter
		];
		const phrase = makePhrase(notes);
		const expr = computeExpression(extractSoundingNotes(phrase.notes), phrase);
		expect(expr[1].isGhost).toBe(false);
	});
});
