/**
 * Note segmentation: combine pitch readings + onset timestamps into DetectedNote[].
 *
 * Each onset starts a new note. The pitch is the median of all pitch readings
 * between onsets. Duration is the time to the next onset (or end of recording).
 */

import type { DetectedNote } from '$lib/types/audio.ts';
import type { PitchReading } from './pitch-detector.ts';

/**
 * Validate worklet onsets against pitch readings.
 *
 * An onset is only valid if there's a pitch reading within a short window
 * after it. This filters out false onsets from metronome bleed (percussion
 * sounds have low clarity and don't produce pitch readings) or other
 * environmental noise picked up by the mic.
 *
 * @param onsets - Raw onset timestamps (seconds, relative to recording start)
 * @param readings - Pitch readings (sorted by time)
 * @param window - Max time after onset to look for a pitch reading (seconds)
 * @returns Filtered onsets confirmed by pitch data
 */
export function validateOnsets(
	onsets: number[],
	readings: PitchReading[],
	window: number = 0.15
): number[] {
	if (readings.length === 0) return [];

	return onsets.filter(onset => {
		// Check if any pitch reading falls within [onset, onset + window]
		for (const r of readings) {
			if (r.time >= onset && r.time <= onset + window) return true;
			if (r.time > onset + window) break; // readings are sorted
		}
		return false;
	});
}

/**
 * Segment pitch readings into discrete notes using onset boundaries.
 *
 * @param readings - Pitch readings from the pitch detector (sorted by time)
 * @param onsets - Onset timestamps in seconds (sorted, relative to recording start)
 * @param recordingDuration - Total recording duration in seconds
 * @param minNoteDuration - Minimum note duration to keep (filters glitches)
 */
export function segmentNotes(
	readings: PitchReading[],
	onsets: number[],
	recordingDuration: number,
	minNoteDuration: number = 0.05,
	onsetGuard: number = 0.08
): DetectedNote[] {
	if (readings.length === 0) return [];

	// If no onsets detected, treat all readings as one note
	const boundaries = onsets.length > 0
		? onsets
		: [readings[0].time];

	const notes: DetectedNote[] = [];

	for (let i = 0; i < boundaries.length; i++) {
		const segStart = boundaries[i];
		const segEnd = i < boundaries.length - 1
			? boundaries[i + 1]
			: recordingDuration;

		const duration = segEnd - segStart;
		if (duration < minNoteDuration) continue;

		// Collect pitch readings within this segment.
		// For segments after the first, skip readings within the onset guard
		// window — the FFT buffer still contains audio from the previous note,
		// so early readings report stale pitch values.
		const guarded = i > 0;
		const effectiveStart = guarded ? segStart + onsetGuard : segStart;
		let segReadings = readings.filter(
			(r) => r.time >= effectiveStart && r.time < segEnd
		);
		// Fallback: if the guard window ate all readings (very short note),
		// use the unguarded range so the note isn't silently dropped.
		if (segReadings.length === 0 && guarded) {
			segReadings = readings.filter(
				(r) => r.time >= segStart && r.time < segEnd
			);
		}

		if (segReadings.length === 0) continue;

		// Use median MIDI note (robust to outliers)
		const midis = segReadings.map((r) => r.midi).sort((a, b) => a - b);
		const medianMidi = midis[Math.floor(midis.length / 2)];

		// Use median cents for that MIDI note
		const matchingReadings = segReadings.filter((r) => r.midi === medianMidi);
		const centsList = matchingReadings.map((r) => r.cents).sort((a, b) => a - b);
		const medianCents = centsList[Math.floor(centsList.length / 2)];

		// Average clarity of matching readings
		const avgClarity =
			matchingReadings.reduce((sum, r) => sum + r.clarity, 0) / matchingReadings.length;

		notes.push({
			midi: medianMidi,
			cents: medianCents,
			onsetTime: segStart,
			duration,
			clarity: avgClarity
		});
	}

	return notes;
}
