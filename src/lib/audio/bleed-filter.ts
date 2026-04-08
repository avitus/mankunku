/**
 * Reference-aware bleed filter: rejects detected notes that likely came
 * from the backing track bleeding into the microphone rather than from
 * the user's instrument.
 *
 * Heuristics use clarity (autocorrelation confidence) as a proxy for
 * signal strength at the mic. Direct instrument input typically produces
 * clarity >= 0.92; speaker bleed at typical distances lands in 0.80–0.88.
 */

import type { DetectedNote } from '$lib/types/audio.ts';
import type { BackingTrackSchedule } from './backing-track-schedule.ts';

/** Default clarity below which a backing-track-matching note is rejected. */
const DEFAULT_CLARITY_FLOOR = 0.88;

/** Clarity above which a note is always kept, even if it matches the backing track. */
const CLARITY_CEILING = 0.92;

/** If a detected onset lands within this window of a backing note start, it's suspect. */
const ONSET_COINCIDENCE_WINDOW = 0.05;

export interface BleedFilterResult {
	kept: DetectedNote[];
	filtered: DetectedNote[];
}

/**
 * Filter detected notes that are likely backing track bleed.
 *
 * @param detected - Notes from the segmenter (post onset-validation)
 * @param schedule - Backing track schedule for the current phrase
 * @param recordingTransportSeconds - Transport time when recording began
 * @param clarityFloor - Clarity threshold for bleed rejection (default 0.88)
 */
export function filterBleed(
	detected: DetectedNote[],
	schedule: BackingTrackSchedule,
	recordingTransportSeconds: number,
	clarityFloor: number = DEFAULT_CLARITY_FLOOR
): BleedFilterResult {
	const kept: DetectedNote[] = [];
	const filtered: DetectedNote[] = [];

	for (const note of detected) {
		const transportTime = recordingTransportSeconds + note.onsetTime;
		const activeMidi = schedule.activeMidiAt(transportTime);

		// No backing track pitch active at this time → keep
		if (!midiMatches(note.midi, activeMidi)) {
			kept.push(note);
			continue;
		}

		// Strong signal → keep even if pitch matches (user playing same note)
		if (note.clarity >= CLARITY_CEILING) {
			kept.push(note);
			continue;
		}

		// Weak signal + pitch match → bleed
		if (note.clarity < clarityFloor) {
			filtered.push(note);
			continue;
		}

		// Borderline clarity: check onset coincidence with backing note starts
		if (hasOnsetCoincidence(transportTime, schedule)) {
			filtered.push(note);
			continue;
		}

		// Benefit of the doubt
		kept.push(note);
	}

	return { kept, filtered };
}

/**
 * Check if a detected MIDI note matches any active backing track MIDI,
 * accounting for octave aliasing (pitch detector may lock onto a
 * different octave of the same pitch class).
 */
function midiMatches(detectedMidi: number, activeMidi: number[]): boolean {
	for (const backing of activeMidi) {
		const interval = Math.abs(detectedMidi - backing);
		if (interval === 0 || interval === 12 || interval === 24) {
			return true;
		}
	}
	return false;
}

/**
 * Check whether a backing track note starts within the coincidence window
 * of the given transport time.
 */
function hasOnsetCoincidence(
	transportSeconds: number,
	schedule: BackingTrackSchedule
): boolean {
	for (const n of schedule.notes) {
		if (Math.abs(n.startSeconds - transportSeconds) <= ONSET_COINCIDENCE_WINDOW) {
			return true;
		}
		if (n.startSeconds > transportSeconds + ONSET_COINCIDENCE_WINDOW) break;
	}
	return false;
}
