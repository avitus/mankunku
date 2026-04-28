/**
 * Swing timing for off-beat 8th notes.
 *
 * Triplets are immune by construction: a beat offset of `n + 1/2`
 * (the off-beat 8th) cannot arise from triplet denominators (3, 6, 12, 24),
 * so the `fractional ≈ 0.5` check naturally excludes them. This is shared
 * between playback (Tone.js scheduling) and scoring (DTW alignment) so a
 * perfect performance scores perfectly.
 *
 * @param beats - Position in beats (quarter notes from the phrase start)
 * @param swing - 0.5 straight, 0.67 ≈ triplet feel, 0.8 heavy
 * @returns Shifted beat position
 */
export function applySwingToBeats(beats: number, swing: number): number {
	if (swing <= 0.5) return beats;
	const fractional = beats - Math.floor(beats);
	if (Math.abs(fractional - 0.5) < 0.001) {
		return beats + (swing - 0.5);
	}
	return beats;
}
