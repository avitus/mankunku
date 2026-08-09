/**
 * The straight-eighths ratio: the off-beat eighth sits exactly halfway
 * through the beat. Also the floor of the user's swing setting and the
 * value every "no swing" branch tests against — it was previously written
 * as a bare 0.5 in four unrelated modules.
 */
export const STRAIGHT_SWING = 0.5;

/** Heaviest swing the settings UI allows. */
export const MAX_SWING = 0.8;

/**
 * Swing timing for off-beat 8th notes.
 *
 * Triplet-eighth positions are immune by construction: they land at
 * `n + 1/3` and `n + 2/3`, not near `n + 1/2` (the swung off-beat 8th),
 * so the `fractional ≈ 0.5` check naturally excludes them. This is shared
 * between playback (Tone.js scheduling) and scoring (DTW alignment) so a
 * perfect performance scores perfectly.
 *
 * @param beats - Position in beats (quarter notes from the phrase start)
 * @param swing - 0.5 straight, 0.67 ≈ triplet feel, 0.8 heavy
 * @returns Shifted beat position
 */
export function applySwingToBeats(beats: number, swing: number): number {
	if (swing <= STRAIGHT_SWING) return beats;
	const fractional = beats - Math.floor(beats);
	if (Math.abs(fractional - 0.5) < 0.001) {
		return beats + (swing - 0.5);
	}
	return beats;
}

/**
 * BACKING-TRACK swing position as a function of tempo, after Friberg &
 * Sundström: jazz drummers keep the SHORT (second) eighth roughly constant
 * at ~100 ms across tempi, capping the long-short ratio near 3.5:1 at slow
 * tempi and converging to straight eighths around 300 BPM. With the swing
 * parameter expressed as "position of the off-beat eighth within the beat",
 * a 100 ms short eighth means `1 − s = bpm / 600`.
 *
 * Anchors: 60→0.78 (cap, ≈3.5:1) · 160→0.733 · 200→0.667 (triplet) ·
 * 240→0.60 · ≥300→0.5 (straight). The cap engages below ~132 BPM.
 *
 * This drives ONLY the backing track's own placement (see
 * `resolveBackingSwing` in backing-generation.ts). It must never be
 * imported by playback, scoring, or tricks modules: the melody the user
 * plays — and is scored against — always uses the session swing through
 * `applySwingToBeats` above, so what the scorer expects of the player is
 * untouched by tempo (guarded by a unit test).
 */
export function swingForTempo(bpm: number): number {
	return Math.min(0.78, Math.max(0.5, 1 - bpm / 600));
}
