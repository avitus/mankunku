/**
 * Integration tests for the lick practice pipeline.
 *
 * Tests the full flow across 6+ modules: library loading, transposition,
 * validation, key ordering, persistence, and progression transposition.
 * Covers the end-to-end path a lick takes from curated data through
 * a 12-key practice session with progress tracking.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { PitchClass, Phrase } from '$lib/types/music';
import type { LickPracticeProgress } from '$lib/types/lick-practice';
import type { InstrumentConfig } from '$lib/types/instruments';
import { PITCH_CLASSES } from '$lib/types/music';
import { INSTRUMENTS } from '$lib/types/instruments';

// ── localStorage mock ─────────────────────────────────────────
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: vi.fn((key: string) => store.get(key) ?? null),
	setItem: vi.fn((key: string, val: string) => store.set(key, val)),
	removeItem: vi.fn((key: string) => store.delete(key)),
	key: vi.fn((i: number) => [...store.keys()][i] ?? null),
	get length() { return store.size; },
	clear: vi.fn(() => store.clear())
});

// Restore the original localStorage after this file so other tests don't
// inherit the fake and become order-dependent.
afterAll((): void => {
	vi.unstubAllGlobals();
});

// ── Mock sync module to prevent Supabase calls ───────────────
vi.mock('$lib/persistence/sync', () => ({
	syncLickMetadataToCloud: vi.fn().mockResolvedValue(undefined),
	loadLickMetadataFromCloud: vi.fn().mockResolvedValue(null),
	syncUserLicksToCloud: vi.fn().mockResolvedValue(undefined)
}));

// ── Imports (after mocks) ────────────────────────────────────
import {
	getAllLicks,
	getLickById,
	queryLicks,
	transposeLick
} from '$lib/phrases/library-loader';
import {
	circleOfFifthsFrom,
	chromaticFrom,
	wholeTonePairFrom,
	planLickKeys
} from '$lib/music/key-ordering';
import {
	updateKeyProgress,
	getKeyProgress,
	getLickTempo,
	saveLickPracticeProgress,
	loadLickPracticeProgress,
	computeAutoTempoAdjustment,
	clampTempo
} from '$lib/persistence/lick-practice-store';
import { validatePhrase } from '$lib/phrases/validator';
import {
	transposeProgression,
	PROGRESSION_TEMPLATES
} from '$lib/data/progressions';

// ── Helpers ──────────────────────────────────────────────────

/** Instrument range: concert Ab2 (44) to concert Eb5 (75) — tenor sax */
const RANGE_LOW = 44;
const RANGE_HIGH = 75;

const TENOR_SAX: InstrumentConfig = INSTRUMENTS['tenor-sax'];

/** Get a real curated lick or fail with a clear message */
function requireLick(id: string): Phrase {
	const lick = getLickById(id);
	if (!lick) throw new Error(`Curated lick '${id}' not found — has the library changed?`);
	return lick;
}

/** Get the first lick in the library, regardless of ID */
function firstLick(): Phrase {
	const all = getAllLicks();
	if (all.length === 0) throw new Error('No licks in library');
	return all[0];
}

// ── Lick Practice Pipeline ───────────────────────────────────

describe('lick practice pipeline', () => {
	it('loads a curated lick by ID, transposes to F, and validates result', () => {
		const lick = firstLick();
		const transposed = transposeLick(lick, 'F', RANGE_LOW, RANGE_HIGH);

		expect(transposed.key).toBe('F');
		expect(transposed.notes.length).toBe(lick.notes.length);

		const result = validatePhrase(transposed, { range: [RANGE_LOW, RANGE_HIGH] });
		expect(result.valid).toBe(true);
	});

	it('loads a curated lick by ID, transposes to all 12 keys, all valid', () => {
		const lick = firstLick();

		for (const key of PITCH_CLASSES) {
			const transposed = transposeLick(lick, key, RANGE_LOW, RANGE_HIGH);

			expect(transposed.key).toBe(key);
			expect(transposed.notes.length).toBe(lick.notes.length);

			const result = validatePhrase(transposed, { range: [RANGE_LOW, RANGE_HIGH] });
			expect(result.valid).toBe(true);
		}
	});

	it('queryLicks filters by category with real data', () => {
		const results = queryLicks({ category: 'blues' });

		expect(results.length).toBeGreaterThan(0);
		for (const lick of results) {
			expect(lick.category).toBe('blues');
		}
	});

	it('queryLicks filters by maxDifficulty with real data', () => {
		const results = queryLicks({ maxDifficulty: 30 });

		expect(results.length).toBeGreaterThan(0);
		for (const lick of results) {
			expect(lick.difficulty.level).toBeLessThanOrEqual(30);
		}
	});
});

// ── Key Ordering ─────────────────────────────────────────────

describe('key ordering', () => {
	it('circleOfFifthsFrom returns 12 unique pitch classes starting from given root', () => {
		const keys = circleOfFifthsFrom('C');

		expect(keys).toHaveLength(12);
		expect(keys[0]).toBe('C');
		expect(new Set(keys).size).toBe(12);
		// Every element should be a valid PitchClass
		for (const k of keys) {
			expect(PITCH_CLASSES).toContain(k);
		}
	});

	it('chromaticFrom returns 12 ascending semitones', () => {
		const keys = chromaticFrom('Eb');
		const startIdx = PITCH_CLASSES.indexOf('Eb');

		expect(keys).toHaveLength(12);
		const expected: PitchClass[] = [];
		for (let i = 0; i < 12; i++) {
			expected.push(PITCH_CLASSES[(startIdx + i) % 12]);
		}
		expect(keys).toEqual(expected);
	});

	it('wholeTonePairFrom produces two whole-tone scales', () => {
		const keys = wholeTonePairFrom('C');

		expect(keys).toHaveLength(12);
		// First 6 keys: whole-tone scale containing C
		const firstHalf = keys.slice(0, 6);
		expect(firstHalf).toEqual(['C', 'D', 'E', 'F#', 'Ab', 'Bb']);
		// Second 6 keys: complementary whole-tone scale
		const secondHalf = keys.slice(6, 12);
		expect(secondHalf).toEqual(['Db', 'Eb', 'F', 'G', 'A', 'B']);
		// All unique
		expect(new Set(keys).size).toBe(12);
	});

	it('planLickKeys returns 12 unique keys regardless of parameters', () => {
		const configs = [
			{ tempo: 60, minBpm: 60 },
			{ tempo: 100, minBpm: 60 },
			{ tempo: 130, minBpm: 60 },
			{ tempo: 150, minBpm: 60 },
			{ tempo: 200, minBpm: 80 },
			{ tempo: 60, minBpm: 40 }
		];

		for (const { tempo, minBpm } of configs) {
			const keys = planLickKeys({
				tempo,
				minBpm,
				instrument: TENOR_SAX,
				rng: () => 0.5 // deterministic
			});

			expect(keys).toHaveLength(12);
			expect(new Set(keys).size).toBe(12);
			for (const k of keys) {
				expect(PITCH_CLASSES).toContain(k);
			}
		}
	});
});

// ── Key Progress Persistence ─────────────────────────────────

describe('key progress persistence', () => {
	beforeEach(() => {
		store.clear();
	});

	it('updateKeyProgress saves and getKeyProgress retrieves correctly', () => {
		let progress: LickPracticeProgress = {};

		progress = updateKeyProgress(progress, 'lick-x', 'G', {
			currentTempo: 100,
			lastPracticedAt: 1000,
			passCount: 3
		});

		const kp = getKeyProgress(progress, 'lick-x', 'G');

		expect(kp.currentTempo).toBe(100);
		expect(kp.lastPracticedAt).toBe(1000);
		expect(kp.passCount).toBe(3);
	});

	it('getKeyProgress returns defaults for unknown lick/key', () => {
		const progress: LickPracticeProgress = {};
		const kp = getKeyProgress(progress, 'nonexistent', 'C');

		expect(kp.currentTempo).toBe(100);
		expect(kp.lastPracticedAt).toBe(0);
		expect(kp.passCount).toBe(0);
	});

	it('getLickTempo returns the minimum tempo from stored progress', () => {
		let progress: LickPracticeProgress = {};

		progress = updateKeyProgress(progress, 'lick-y', 'C', { currentTempo: 120, lastPracticedAt: 0, passCount: 0 });
		progress = updateKeyProgress(progress, 'lick-y', 'F', { currentTempo: 90, lastPracticedAt: 0, passCount: 0 });
		progress = updateKeyProgress(progress, 'lick-y', 'Bb', { currentTempo: 110, lastPracticedAt: 0, passCount: 0 });

		expect(getLickTempo(progress, 'lick-y')).toBe(90);
	});

	it('getLickTempo returns default (100) for unknown lick', () => {
		const progress: LickPracticeProgress = {};
		expect(getLickTempo(progress, 'unknown')).toBe(100);
	});

	it('saveLickPracticeProgress and loadLickPracticeProgress round-trip', () => {
		let progress: LickPracticeProgress = {};
		progress = updateKeyProgress(progress, 'lick-rt', 'D', {
			currentTempo: 85,
			lastPracticedAt: 12345,
			passCount: 7
		});
		progress = updateKeyProgress(progress, 'lick-rt', 'Ab', {
			currentTempo: 95,
			lastPracticedAt: 67890,
			passCount: 2
		});

		saveLickPracticeProgress(progress);
		const loaded = loadLickPracticeProgress();

		expect(loaded['lick-rt']).toBeDefined();
		expect(loaded['lick-rt']!['D']!.currentTempo).toBe(85);
		expect(loaded['lick-rt']!['D']!.passCount).toBe(7);
		expect(loaded['lick-rt']!['Ab']!.currentTempo).toBe(95);
		expect(loaded['lick-rt']!['Ab']!.lastPracticedAt).toBe(67890);
	});

	it('computeAutoTempoAdjustment returns correct BPM deltas', () => {
		expect(computeAutoTempoAdjustment(0.97)).toBe(5);   // >= 0.95
		expect(computeAutoTempoAdjustment(0.90)).toBe(2);   // >= 0.85
		expect(computeAutoTempoAdjustment(0.75)).toBe(-1);  // >= 0.70
		expect(computeAutoTempoAdjustment(0.50)).toBe(-3);  // < 0.70
	});

	it('clampTempo enforces 50–300 range', () => {
		expect(clampTempo(30)).toBe(50);
		expect(clampTempo(350)).toBe(300);
		expect(clampTempo(120)).toBe(120);
		expect(clampTempo(50)).toBe(50);
		expect(clampTempo(300)).toBe(300);
	});
});

// ── Progression Transposition ────────────────────────────────

describe('progression transposition', () => {
	it('transposeProgression shifts chord roots correctly', () => {
		const template = PROGRESSION_TEMPLATES['ii-V-I-major'];
		// Template is in C: Dm7 → G7 → Cmaj7
		const transposed = transposeProgression(template.harmony, 'F');

		// Shifted by 5 semitones: Gm7 → C7 → Fmaj7
		expect(transposed[0].chord.root).toBe('G');
		expect(transposed[0].chord.quality).toBe('min7');
		expect(transposed[1].chord.root).toBe('C');
		expect(transposed[1].chord.quality).toBe('7');
		expect(transposed[2].chord.root).toBe('F');
		expect(transposed[2].chord.quality).toBe('maj7');
	});

	it('transposeProgression returns equivalent harmony for key of C', () => {
		const template = PROGRESSION_TEMPLATES['ii-V-I-major'];
		const transposed = transposeProgression(template.harmony, 'C');

		// Value equality rather than referential identity: a non-referential copy
		// is also valid behavior so long as the content matches.
		expect(transposed).toEqual(template.harmony);
	});

	it('transposeProgression handles all 12 keys without error', () => {
		const template = PROGRESSION_TEMPLATES['turnaround'];

		for (const key of PITCH_CLASSES) {
			const transposed = transposeProgression(template.harmony, key);

			expect(transposed).toHaveLength(template.harmony.length);
			// Chord qualities are preserved
			for (let i = 0; i < transposed.length; i++) {
				expect(transposed[i].chord.quality).toBe(template.harmony[i].chord.quality);
			}
		}
	});

	it('PROGRESSION_TEMPLATES have valid structure', () => {
		for (const [type, template] of Object.entries(PROGRESSION_TEMPLATES)) {
			expect(template.type).toBe(type);
			expect(template.name).toBeTruthy();
			expect(template.shortName).toBeTruthy();
			expect(template.bars).toBeGreaterThan(0);
			expect(template.harmony.length).toBeGreaterThan(0);

			for (const seg of template.harmony) {
				// Valid chord root
				expect(PITCH_CLASSES).toContain(seg.chord.root);
				// Has a chord quality
				expect(seg.chord.quality).toBeTruthy();
				// Has a scale reference
				expect(seg.scaleId).toBeTruthy();
				// Duration and offset are valid fractions
				expect(seg.duration).toHaveLength(2);
				expect(seg.duration[1]).toBeGreaterThan(0);
				expect(seg.startOffset).toHaveLength(2);
				expect(seg.startOffset[1]).toBeGreaterThan(0);
			}
		}
	});
});

// ── Full Session Flow ────────────────────────────────────────

describe('full session flow', () => {
	beforeEach(() => {
		store.clear();
	});

	it('end-to-end: load lick → plan keys → transpose per key → record progress', () => {
		// 1. Pick a real lick from the library
		const lick = firstLick();

		// 2. Plan key order using circle of fifths from concert Bb
		//    (tenor sax written C → concert Bb)
		const keys = circleOfFifthsFrom('Bb');
		expect(keys).toHaveLength(12);
		expect(keys[0]).toBe('Bb');

		// 3. Transpose to the first 3 keys and validate each
		const transposed: Phrase[] = [];
		for (const key of keys.slice(0, 3)) {
			const t = transposeLick(lick, key, RANGE_LOW, RANGE_HIGH);
			expect(t.key).toBe(key);

			const valid = validatePhrase(t, { range: [RANGE_LOW, RANGE_HIGH] });
			expect(valid.valid).toBe(true);

			transposed.push(t);
		}

		// 4. Simulate recording progress for each key
		let progress: LickPracticeProgress = {};
		const scores = [0.92, 0.88, 0.78];

		for (let i = 0; i < 3; i++) {
			const key = keys[i];
			const score = scores[i];
			const tempoAdj = computeAutoTempoAdjustment(score);
			const currentTempo = clampTempo(100 + tempoAdj);

			progress = updateKeyProgress(progress, lick.id, key, {
				currentTempo,
				lastPracticedAt: Date.now() + i * 1000,
				passCount: score >= 0.85 ? 1 : 0
			});
		}

		// 5. Persist and reload
		saveLickPracticeProgress(progress);
		const loaded = loadLickPracticeProgress();

		// 6. Verify stored state
		expect(loaded[lick.id]).toBeDefined();

		// Key 0 (Bb): score 0.92 → +2 BPM → tempo 102
		const kp0 = getKeyProgress(loaded, lick.id, keys[0]);
		expect(kp0.currentTempo).toBe(102);
		expect(kp0.passCount).toBe(1);

		// Key 1: score 0.88 → +2 BPM → tempo 102
		const kp1 = getKeyProgress(loaded, lick.id, keys[1]);
		expect(kp1.currentTempo).toBe(102);
		expect(kp1.passCount).toBe(1);

		// Key 2: score 0.78 → -1 BPM → tempo 99
		const kp2 = getKeyProgress(loaded, lick.id, keys[2]);
		expect(kp2.currentTempo).toBe(99);
		expect(kp2.passCount).toBe(0);

		// getLickTempo should return the minimum across all practiced keys
		expect(getLickTempo(loaded, lick.id)).toBe(99);
	});

	it('progression transposition integrates with lick transposition', () => {
		const lick = firstLick();
		const targetKey: PitchClass = 'Eb';

		// Transpose both the lick and its backing progression
		const transposedLick = transposeLick(lick, targetKey, RANGE_LOW, RANGE_HIGH);
		const template = PROGRESSION_TEMPLATES['ii-V-I-major'];
		const transposedHarmony = transposeProgression(template.harmony, targetKey);

		// Lick should be in the target key
		expect(transposedLick.key).toBe(targetKey);
		// Progression's I chord root should match the target key
		const iChord = transposedHarmony[transposedHarmony.length - 1];
		expect(iChord.chord.root).toBe(targetKey);
	});
});
