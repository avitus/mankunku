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
	if (swing <= 0.5) return beats;
	const fractional = beats - Math.floor(beats);
	if (Math.abs(fractional - 0.5) < 0.001) {
		return beats + (swing - 0.5);
	}
	return beats;
}
