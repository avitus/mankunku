import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	computeAutoTempoAdjustment,
	hasLickProgress,
	updateKeyProgress
} from '$lib/persistence/lick-practice-store';
import { getCompatibleLickCategories } from '$lib/data/progressions';
import type { LickPracticeProgress } from '$lib/types/lick-practice';

// Mock localStorage (same pattern as persistence.test.ts)
const store: Record<string, string> = {};
const localStorageMock = {
	getItem: vi.fn((key: string) => store[key] ?? null),
	setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
	removeItem: vi.fn((key: string) => { delete store[key]; }),
	clear: vi.fn(() => { for (const key of Object.keys(store)) delete store[key]; }),
	get length() { return Object.keys(store).length; },
	key: vi.fn((i: number) => Object.keys(store)[i] ?? null)
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

beforeEach(() => {
	localStorageMock.clear();
	vi.clearAllMocks();
});

describe('computeAutoTempoAdjustment', () => {
	it('returns +5 for score 1.0', () => {
		expect(computeAutoTempoAdjustment(1.0)).toBe(5);
	});

	it('returns +5 for score 0.95 (boundary)', () => {
		expect(computeAutoTempoAdjustment(0.95)).toBe(5);
	});

	it('returns +2 for score 0.94', () => {
		expect(computeAutoTempoAdjustment(0.94)).toBe(2);
	});

	it('returns +2 for score 0.85 (boundary)', () => {
		expect(computeAutoTempoAdjustment(0.85)).toBe(2);
	});

	it('returns -1 for score 0.84', () => {
		expect(computeAutoTempoAdjustment(0.84)).toBe(-1);
	});

	it('returns -1 for score 0.70 (boundary)', () => {
		expect(computeAutoTempoAdjustment(0.70)).toBe(-1);
	});

	it('returns -3 for score 0.69', () => {
		expect(computeAutoTempoAdjustment(0.69)).toBe(-3);
	});

	it('returns -3 for score 0.0', () => {
		expect(computeAutoTempoAdjustment(0.0)).toBe(-3);
	});
});

describe('hasLickProgress', () => {
	it('returns false for unknown phraseId', () => {
		const progress: LickPracticeProgress = {};
		expect(hasLickProgress(progress, 'nonexistent-lick')).toBe(false);
	});

	it('returns true after saving progress for that phraseId', () => {
		let progress: LickPracticeProgress = {};
		progress = updateKeyProgress(progress, 'lick-42', 'C', {
			currentTempo: 110,
			lastPracticedAt: Date.now(),
			passCount: 1
		});
		expect(hasLickProgress(progress, 'lick-42')).toBe(true);
	});

	it('returns false when phraseId entry exists but has no keys', () => {
		const progress: LickPracticeProgress = { 'lick-empty': {} };
		expect(hasLickProgress(progress, 'lick-empty')).toBe(false);
	});

	it('returns true with multiple keys', () => {
		let progress: LickPracticeProgress = {};
		progress = updateKeyProgress(progress, 'lick-7', 'C', {
			currentTempo: 100, lastPracticedAt: 0, passCount: 0
		});
		progress = updateKeyProgress(progress, 'lick-7', 'F', {
			currentTempo: 80, lastPracticedAt: 0, passCount: 0
		});
		expect(hasLickProgress(progress, 'lick-7')).toBe(true);
	});
});

describe('getCompatibleLickCategories', () => {
	it('returns categories for ii-V-I-major', () => {
		const cats = getCompatibleLickCategories('ii-V-I-major');
		expect(cats).toContain('ii-V-I-major');
		expect(cats).toContain('short-ii-V-I-major');
		expect(cats).toContain('major-chord');
	});

	it('returns categories for blues', () => {
		const cats = getCompatibleLickCategories('blues');
		expect(cats).toContain('blues');
		expect(cats).toContain('dominant-chord');
	});
});
