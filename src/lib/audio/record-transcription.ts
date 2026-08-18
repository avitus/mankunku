/**
 * The record-a-lick transcription tail, extracted from the /licks/record page
 * so the whole pipeline — rebase onto the scheduled entrance, segmentation
 * with the click grid as bleed evidence, quantization, and concert-C
 * normalization — is one pure, Node-testable function. The page owns audio
 * plumbing and UI state; this owns everything from raw capture to Phrase.
 */
import type { DetectedNote } from '$lib/types/audio';
import type { Phrase } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import type { PitchReading } from './pitch-frame';
import { rebaseToAnchor } from './capture-window';
import {
	segmentNotes,
	resolveOnsets,
	findReArticulations,
	getMetronomeBleedOnsets
} from './note-segmenter';
import { quantizeNotes, detectKey } from './quantizer';
import { calculateDifficulty } from '$lib/difficulty/calculate';

/**
 * The record flow's fixed pre-take transport span: a 2-bar count-in in 4/4.
 * The transport runs from 0, so the take starts exactly 8 beats in — the
 * offset the analytic click grid (`getMetronomeBleedOnsets`) walks from.
 */
export const RECORD_COUNT_IN_BEATS = 8;

export interface RecordedTake {
	readings: PitchReading[];
	workletOnsets: number[];
	/**
	 * The entrance in the capture's own timebase: the bar-3 downbeat's
	 * context time minus the detectors' shared epoch.
	 */
	anchorOffset: number;
	tempo: number;
}

/**
 * Transcribe a finished take into a concert-C user Phrase, or null when the
 * capture holds no usable performance (no readings past the anchor, or
 * nothing survives segmentation).
 */
export function transcribeTake({
	readings: rawReadings,
	workletOnsets: rawWorkletOnsets,
	anchorOffset,
	tempo
}: RecordedTake): Phrase | null {
	// Re-origin the capture on the entrance, discarding the count-in the
	// detectors ran through.
	const { readings, workletOnsets } = rebaseToAnchor(rawReadings, rawWorkletOnsets, anchorOffset);
	if (readings.length === 0) return null;

	// The rebase keeps readings down to -tolerance, so a take whose last
	// reading precedes the anchor would otherwise hand segmentation a
	// negative duration.
	const recordingDuration = Math.max(0, readings[readings.length - 1].time + 0.1);

	// Segment through the same pipeline as ear-training and lick-practice.
	// The metronome clicks through the whole take, so the segmenter MUST get
	// the click grid as bleed evidence — dropping it silently restores
	// phantom-onset splits.
	const recordingTransportSeconds = RECORD_COUNT_IN_BEATS * (60 / tempo);
	const baseOnsets = resolveOnsets(workletOnsets, readings);
	const bleedOnsets = getMetronomeBleedOnsets(recordingTransportSeconds, tempo, recordingDuration);
	const articulationOnsets = findReArticulations(readings, baseOnsets, bleedOnsets);
	const onsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
	const detected: DetectedNote[] = segmentNotes(
		readings,
		onsets,
		recordingDuration,
		undefined,
		undefined,
		undefined,
		workletOnsets,
		bleedOnsets,
		articulationOnsets
	);
	if (detected.length === 0) return null;

	const notes = quantizeNotes(detected, tempo, [4, 4]);
	const key = detectKey(detected);

	// Normalize to concert C — user licks are stored in C like the curated
	// catalog and transposed at practice time.
	const shift = -PITCH_CLASSES.indexOf(key);
	const normalizedNotes = notes.map((n) => ({
		...n,
		pitch: n.pitch !== null ? n.pitch + shift : null
	}));

	const phrase: Phrase = {
		id: '',
		name: '',
		timeSignature: [4, 4],
		key: 'C',
		notes: normalizedNotes,
		harmony: [],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'user',
		tags: ['user-recorded'],
		source: 'user-recorded'
	};
	phrase.difficulty = calculateDifficulty(phrase);
	return phrase;
}
