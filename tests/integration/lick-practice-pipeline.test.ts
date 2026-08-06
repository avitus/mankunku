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
	loadLickMetadataFromCloud: vi.fn().mockResolvedValue({ status: 'empty' }),
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

// ── Progression Transposition ────────────────────────────────

describe('progression transposition', () => {
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
				passCount: score >= 0.90 ? 1 : 0
			});
		}

		// 5. Persist and reload
		saveLickPracticeProgress(progress);
		const loaded = loadLickPracticeProgress();

		// 6. Verify stored state
		expect(loaded[lick.id]).toBeDefined();

		// Key 0 (Bb): score 0.92 → +1 BPM (proficient) → tempo 101
		const kp0 = getKeyProgress(loaded, lick.id, keys[0]);
		expect(kp0.currentTempo).toBe(101);
		expect(kp0.passCount).toBe(1);

		// Key 1: score 0.88 → -1 BPM (between floor and proficient) → tempo 99
		const kp1 = getKeyProgress(loaded, lick.id, keys[1]);
		expect(kp1.currentTempo).toBe(99);
		expect(kp1.passCount).toBe(0);

		// Key 2: score 0.78 → -1 BPM (still above floor) → tempo 99
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
