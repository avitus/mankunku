import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
	SWING_TIMING,
	BALLAD_TIMING,
	BOSSA_TIMING,
	STRAIGHT_TIMING,
	placeEventTicks,
	createTimingStreams,
	type TimingRole
} from '$lib/audio/backing-timing';
import { createRng, seedFrom } from '$lib/audio/generation-rng';
import { generateBacking } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';
import { applySwingToBeats } from '$lib/music/swing';

const PPQ = 192;

function msToTicks(ms: number, tempo: number): number {
	return (ms / (60_000 / tempo)) * PPQ;
}

describe('timing profiles', () => {
	it('encode the ensemble roles: bass on top, comp behind, ride the clock', () => {
		expect(SWING_TIMING.bass.offsetMs).toBeLessThan(0);
		expect(SWING_TIMING.ride.offsetMs).toBe(0);
		expect(SWING_TIMING.comp.offsetMs).toBeGreaterThan(SWING_TIMING.kick.offsetMs);
	});

	it('style variants keep every role defined', () => {
		for (const table of [SWING_TIMING, BALLAD_TIMING, BOSSA_TIMING, STRAIGHT_TIMING]) {
			for (const role of Object.keys(SWING_TIMING) as TimingRole[]) {
				expect(table[role]).toBeDefined();
				expect(Number.isFinite(table[role].offsetMs)).toBe(true);
				expect(table[role].jitterMs).toBeGreaterThanOrEqual(0);
			}
		}
		// Ballad looser, bossa tight-on-the-grid, straight halved personality.
		expect(BALLAD_TIMING.comp.offsetMs).toBeGreaterThan(SWING_TIMING.comp.offsetMs);
		expect(BOSSA_TIMING.comp.offsetMs).toBe(0);
		expect(STRAIGHT_TIMING.comp.offsetMs).toBeCloseTo(SWING_TIMING.comp.offsetMs / 2, 6);
	});
});

describe('placeEventTicks', () => {
	it('centers on the swung grid plus the role offset (triangular jitter, bounded)', () => {
		const tempo = 120;
		const profile = { offsetMs: 12, jitterMs: 8 };
		const rng = createRng(seedFrom('probe', tempo, 'comp-time', 0));
		const expectedCenter = applySwingToBeats(1.5, 0.67) * PPQ + msToTicks(12, tempo);
		let sum = 0;
		const N = 400;
		for (let i = 0; i < N; i++) {
			const t = placeEventTicks(1.5, 0.67, PPQ, tempo, profile, rng);
			sum += t;
			// |deviation from center| ≤ jitter bound (+1 for rounding)
			expect(Math.abs(t - expectedCenter)).toBeLessThanOrEqual(msToTicks(8, tempo) + 1);
		}
		expect(sum / N).toBeCloseTo(expectedCenter, 0);
	});

	it('jitter magnitude is constant in ms across tempi (no 120/tempo scaling)', () => {
		const profile = { offsetMs: 0, jitterMs: 6 };
		for (const tempo of [80, 160, 240]) {
			const rng = createRng(seedFrom('probe', tempo, 'ride-time', 0));
			let maxDevMs = 0;
			for (let i = 0; i < 300; i++) {
				const t = placeEventTicks(2, 0.5, PPQ, tempo, profile, rng);
				const devTicks = Math.abs(t - 2 * PPQ);
				maxDevMs = Math.max(maxDevMs, (devTicks / PPQ) * (60_000 / tempo));
			}
			expect(maxDevMs).toBeLessThanOrEqual(6 + 1);
			expect(maxDevMs).toBeGreaterThan(2); // it actually jitters
		}
	});

	it('compresses constant-ms offsets at fast tempi', () => {
		// At 300 BPM a beat is 200ms; the 4% cap is 8ms — a +12ms comp
		// offset must compress to 8ms.
		const profile = { offsetMs: 12, jitterMs: 0 };
		const rng = createRng(seedFrom('probe', 300, 'comp-time', 0));
		const t = placeEventTicks(1, 0.5, PPQ, 300, profile, rng);
		expect(t).toBe(Math.round(PPQ + msToTicks(8, 300)));
	});

	it('never returns negative ticks', () => {
		const profile = { offsetMs: -30, jitterMs: 10 };
		const rng = createRng(seedFrom('probe', 60, 'bass-time', 0));
		for (let i = 0; i < 50; i++) {
			expect(placeEventTicks(0, 0.5, PPQ, 60, profile, rng)).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('ensemble ordering in generated output', () => {
	it('bass places ahead of comp on average (on top vs laid back)', () => {
		const preset = BACKING_LAB_PRESETS.find((p) => p.id === 'lab-blues-f')!;
		const style = BACKING_STYLES.swing;
		const swing = 0.67;
		const generated = generateBacking(preset.phrase.harmony, style, {
			phraseId: preset.phrase.id,
			tempo: 140,
			ppq: PPQ,
			beatsPerBar: 4,
			swing,
			timing: style.timing
		});
		const meanDev = (events: Array<{ time: string; absBeat: number }>) => {
			const devs = events.map(
				(e) => parseInt(e.time, 10) - applySwingToBeats(e.absBeat, swing) * PPQ
			);
			return devs.reduce((a, b) => a + b, 0) / Math.max(1, devs.length);
		};
		const bassDev = meanDev(generated.bassEvents);
		const compDev = meanDev(generated.compEvents);
		expect(bassDev).toBeLessThan(compDev);
		// Comp lays back a clearly audible amount at 140 BPM (+12ms ≈ 5.4 ticks).
		expect(compDev).toBeGreaterThan(2);
	});

	it('timing streams are per-role: consuming one never shifts another', () => {
		const a = createTimingStreams('iso', 140);
		const b = createTimingStreams('iso', 140);
		// Drain some of role comp's bar-0 stream on `a` only.
		for (let i = 0; i < 10; i++) a.for('comp', 0).float();
		// Bass bar-0 draws stay identical between contexts.
		expect(a.for('bass', 0).float()).toBe(b.for('bass', 0).float());
	});
});

describe('scorer independence guard', () => {
	it('swingForTempo is never imported by playback, scoring, or tricks', () => {
		const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
		const files: string[] = ['src/lib/audio/playback.ts'];
		for (const dir of ['src/lib/scoring', 'src/lib/tricks']) {
			for (const f of readdirSync(join(repoRoot, dir), { recursive: true }) as string[]) {
				if (String(f).endsWith('.ts')) files.push(join(dir, String(f)));
			}
		}
		for (const file of files) {
			const src = readFileSync(join(repoRoot, file), 'utf8');
			expect(src.includes('swingForTempo'), `${file} must not use swingForTempo`).toBe(false);
		}
	});
});
