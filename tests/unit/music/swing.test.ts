import { describe, it, expect } from 'vitest';
import { applySwingToBeats, swingForTempo } from '$lib/music/swing';

describe('applySwingToBeats', () => {
	it('passes through downbeats unchanged at any swing', () => {
		expect(applySwingToBeats(0, 0.67)).toBe(0);
		expect(applySwingToBeats(1, 0.8)).toBe(1);
		expect(applySwingToBeats(3, 0.67)).toBe(3);
	});

	it('does not shift any note when swing is straight', () => {
		expect(applySwingToBeats(0.5, 0.5)).toBe(0.5);
		expect(applySwingToBeats(1.5, 0.5)).toBe(1.5);
	});

	it('shifts off-beat 8ths by (swing - 0.5)', () => {
		expect(applySwingToBeats(0.5, 0.67)).toBeCloseTo(0.67, 6);
		expect(applySwingToBeats(1.5, 0.67)).toBeCloseTo(1.67, 6);
		expect(applySwingToBeats(3.5, 0.8)).toBeCloseTo(3.8, 6);
	});

	it('leaves triplet 8ths unshifted (the bug we are fixing)', () => {
		// Triplet 8ths within a single beat (denominator 12 / 6)
		expect(applySwingToBeats(1 / 3, 0.67)).toBeCloseTo(1 / 3, 6);
		expect(applySwingToBeats(2 / 3, 0.67)).toBeCloseTo(2 / 3, 6);
		// Beat-4 triplet pickup from major-chord-pickup-001 (offsets [3,4], [5,6], [11,12]):
		// quarter-notes from start = 3.0, 10/3, 11/3
		expect(applySwingToBeats(3.0, 0.67)).toBeCloseTo(3.0, 6);
		expect(applySwingToBeats(10 / 3, 0.67)).toBeCloseTo(10 / 3, 6);
		expect(applySwingToBeats(11 / 3, 0.67)).toBeCloseTo(11 / 3, 6);
	});

	it('keeps the three triplet 8ths at exact 1/3-beat spacing under heavy swing', () => {
		const swing = 0.8;
		const a = applySwingToBeats(3.0, swing);
		const b = applySwingToBeats(10 / 3, swing);
		const c = applySwingToBeats(11 / 3, swing);
		expect(b - a).toBeCloseTo(1 / 3, 6);
		expect(c - b).toBeCloseTo(1 / 3, 6);
	});

	it('does not shift 16th-note off-beats (only 8ths get swung)', () => {
		// fractional beat = 0.25 or 0.75 → not 0.5
		expect(applySwingToBeats(0.25, 0.67)).toBeCloseTo(0.25, 6);
		expect(applySwingToBeats(0.75, 0.67)).toBeCloseTo(0.75, 6);
		expect(applySwingToBeats(1.75, 0.67)).toBeCloseTo(1.75, 6);
	});
});

describe('swingForTempo (backing-track only)', () => {
	it('matches the Friberg–Sundström anchors', () => {
		expect(swingForTempo(60)).toBeCloseTo(0.78, 6); // capped ≈3.5:1
		expect(swingForTempo(120)).toBeCloseTo(0.78, 6); // still capped
		expect(swingForTempo(160)).toBeCloseTo(1 - 160 / 600, 6); // ≈0.733
		expect(swingForTempo(200)).toBeCloseTo(2 / 3, 3); // triplet feel
		expect(swingForTempo(240)).toBeCloseTo(0.6, 6);
		expect(swingForTempo(300)).toBe(0.5); // straight
		expect(swingForTempo(400)).toBe(0.5); // floor holds
	});

	it('is monotone non-increasing across the playable range', () => {
		let prev = Infinity;
		for (let bpm = 40; bpm <= 400; bpm += 5) {
			const s = swingForTempo(bpm);
			expect(s).toBeLessThanOrEqual(prev);
			expect(s).toBeGreaterThanOrEqual(0.5);
			expect(s).toBeLessThanOrEqual(0.78);
			prev = s;
		}
	});

	it('keeps the short eighth at ~100ms in the uncapped band', () => {
		for (const bpm of [140, 180, 220, 260]) {
			const shortEighthMs = (1 - swingForTempo(bpm)) * (60_000 / bpm);
			expect(shortEighthMs).toBeCloseTo(100, 6);
		}
	});
});
