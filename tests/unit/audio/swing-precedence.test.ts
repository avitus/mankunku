import { describe, it, expect } from 'vitest';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import {
	BACKING_STYLES,
	BACKING_STYLE_IDS,
	melodySwingForStyle,
	resolveMelodySwing
} from '$lib/audio/backing-styles';
import { swingForTempo, STRAIGHT_SWING, MAX_SWING } from '$lib/music/swing';
import type { BackingStyle } from '$lib/types/instruments';

/**
 * Who owns the eighth-note grid, style or user?
 *
 * The rule: a 'fixed' style declares a genre whose eighth-note placement is
 * not a matter of taste, so it wins outright — and band and melody both take
 * it, so a soloist never swings over a straight bossa. Only the 'tempo' style
 * (swing) defers to the user's knob.
 *
 * Band and melody agree for 'fixed' styles, NOT universally: on the swing
 * style with the knob straight the band follows the tempo curve while the
 * melody stays even (asserted below). That divergence is deliberate — the grid
 * the scorer expects must never move with tempo.
 *
 * These tests exist because the original rule was inverted and had no
 * coverage above STRAIGHT_SWING — the knob's very first step (0.55) silently
 * swung Straight and Bossa Nova, and nothing failed.
 */

const FIXED_STYLES: BackingStyle[] = ['straight', 'bossa-nova', 'ballad'];
/** Every knob position the settings UI can actually produce, 0.50–0.80 by 0.05. */
const KNOB_POSITIONS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8];
const TEMPOS = [60, 100, 140, 200, 240];

describe('swing precedence — fixed-grid styles', () => {
	for (const id of FIXED_STYLES) {
		const style = BACKING_STYLES[id];

		it(`${id}: backing pins to defaultSwing at every knob position and tempo`, () => {
			for (const knob of KNOB_POSITIONS) {
				for (const tempo of TEMPOS) {
					expect(resolveBackingSwing(knob, style, tempo)).toBe(style.defaultSwing);
				}
			}
		});

		it(`${id}: melody pins to the same value, so soloist and band share one grid`, () => {
			for (const knob of KNOB_POSITIONS) {
				expect(resolveMelodySwing(knob, style)).toBe(style.defaultSwing);
				// Tempo cannot enter the melody grid — the scorer must not move
				// under the player just because the tempo changed.
				for (const tempo of TEMPOS) {
					expect(resolveMelodySwing(knob, style)).toBe(resolveBackingSwing(knob, style, tempo));
				}
			}
		});
	}

	it('straight and bossa are genuinely straight; ballad has its own slight lilt', () => {
		expect(BACKING_STYLES.straight.defaultSwing).toBe(STRAIGHT_SWING);
		expect(BACKING_STYLES['bossa-nova'].defaultSwing).toBe(STRAIGHT_SWING);
		expect(BACKING_STYLES.ballad.defaultSwing).toBeGreaterThan(STRAIGHT_SWING);
	});
});

describe('swing precedence — the swing style defers to the user', () => {
	const style = BACKING_STYLES.swing;

	it('uses the knob whenever it is off the straight floor', () => {
		for (const knob of KNOB_POSITIONS.filter((k) => k > STRAIGHT_SWING)) {
			for (const tempo of TEMPOS) {
				expect(resolveBackingSwing(knob, style, tempo)).toBe(knob);
			}
			expect(resolveMelodySwing(knob, style)).toBe(knob);
		}
	});

	it('falls back to the tempo curve when the knob sits straight', () => {
		for (const tempo of TEMPOS) {
			expect(resolveBackingSwing(STRAIGHT_SWING, style, tempo)).toBe(swingForTempo(tempo));
		}
	});

	it('leaves the melody straight when the knob is straight — the curve is backing-only', () => {
		// swingForTempo must never reach the scorer: at 100 BPM the band swings
		// 0.78 while the player is graded on even eighths, by design.
		expect(resolveMelodySwing(STRAIGHT_SWING, style)).toBe(STRAIGHT_SWING);
		expect(resolveBackingSwing(STRAIGHT_SWING, style, 100)).toBeGreaterThan(STRAIGHT_SWING);
	});
});

describe('melodySwingForStyle', () => {
	it('agrees with resolveMelodySwing for every registered style', () => {
		for (const id of BACKING_STYLE_IDS) {
			for (const knob of KNOB_POSITIONS) {
				expect(melodySwingForStyle(knob, id)).toBe(resolveMelodySwing(knob, BACKING_STYLES[id]));
			}
		}
	});

	it('never returns a value outside the range applySwingToBeats accepts', () => {
		for (const id of BACKING_STYLE_IDS) {
			for (const knob of KNOB_POSITIONS) {
				const s = melodySwingForStyle(knob, id);
				expect(s).toBeGreaterThanOrEqual(STRAIGHT_SWING);
				expect(s).toBeLessThanOrEqual(MAX_SWING);
			}
		}
	});
});
