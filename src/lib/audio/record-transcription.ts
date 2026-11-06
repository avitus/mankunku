/**
 * The record-a-lick transcription tail, extracted from the /licks/record page
 * so the whole pipeline — rebase onto the scheduled entrance, segmentation
 * with the click grid as bleed evidence, quantization, and concert-C
 * normalization — is one pure, Node-testable function. The page owns audio
 * plumbing and UI state; this owns everything from raw capture to Phrase.
 */
import type { DetectedNote } from '$lib/types/audio';
import type { Note, Phrase, PitchClass } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import type { PitchReading } from './pitch-frame';
import { rebaseToAnchor } from './capture-window';
import {
	segmentNotes, findGhostNotes, insertGhostNotes,
	resolveOnsets,
	findReArticulations,
	getMetronomeBleedOnsets
} from './note-segmenter';
import { recorderBoundaries, type BoundaryEvidence, type RecorderSignal } from './recorder-boundaries';
import { recorderOctaveCorrections } from './recorder-octaves';
import { recorderPassingNotes } from './recorder-passing-notes';
import { ringingRelease } from './recorder-ending';
import { inferRecorderKey } from './recorder-key';
import { quantizeRecorderRhythm } from './recorder-rhythm';
import { calculateDifficulty } from '$lib/difficulty/calculate';

/**
 * The record flow's fixed pre-take transport span: a 2-bar count-in in 4/4.
 * The transport runs from 0, so the take starts exactly 8 beats in — the
 * offset the analytic click grid (`getMetronomeBleedOnsets`) walks from.
 */
export const RECORD_COUNT_IN_BEATS = 8;

export interface RecordedTake {
	readings: PitchReading[];
	weakReadings?: PitchReading[];
	pcm?: Pick<RecorderSignal, 'samples' | 'sampleRate'>;
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
export function transcribeTake(take: RecordedTake): Phrase | null {
	return transcribeTakeWithKey(take)?.phrase ?? null;
}

/** Expose the inferred key and original attacks so offline comparisons share one detection pass. */
export function transcribeTakeWithKey({
	readings: rawReadings,
	weakReadings = [],
	pcm,
	workletOnsets: rawWorkletOnsets,
	anchorOffset,
	tempo
}: RecordedTake, onSegmented?: (evidence: BoundaryEvidence) => void) {
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
	const reedResets = new Set<number>();
	const articulationOnsets = findReArticulations(readings, baseOnsets, bleedOnsets, time => reedResets.add(time));
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

	// A quiet but pitched plateau can carry a ghosted attack that the
	// confident stream represents as a hole. Require enough of a triplet
	// subdivision to distinguish it from a passing reed transient.
	const weak = rebaseToAnchor(weakReadings, [], anchorOffset).readings;
	const ghosts = findGhostNotes(readings, weak).filter(n => n.duration >= (2 / 9) * 60 / tempo);
	const performance = insertGhostNotes(detected, ghosts, 0.05);
	const signal = pcm && { ...pcm, anchorOffset };
	const segmented = recorderBoundaries(performance, readings, tempo, signal);
	const octaveCorrections = signal ? recorderOctaveCorrections(performance, readings, signal) : [];
	for (const { index, originalMidi } of octaveCorrections) segmented.notes[index].midi = originalMidi - 12;
	// The replay harness can compare versions on identical segmented audio.
	onSegmented?.(segmented);
	const additions = recorderPassingNotes(segmented.notes, readings, weak, tempo);
	const lastSegment = segmented.notes.at(-1);
	// Tier deduplication can retain a nearby onset instead of the reset's
	// timestamp. Use the segmenter's 75 ms same-pitch attack window.
	const protectRepeat = !!lastSegment && lastSegment.midi === segmented.notes.at(-2)?.midi &&
		[...reedResets].some(time => Math.abs(time - lastSegment.onsetTime) <= 0.075);
	const candidates = refineRecorderNotes(segmented, additions, protectRepeat);
	const last = candidates.notes.at(-1);
	const previous = candidates.notes.at(-2);
	const endingRelease = last && previous && signal && !protectRepeat ? ringingRelease(last, previous, signal, readings) : undefined;
	const { notes, phaseSeconds, collisions, omittedIndices } = quantizeRecorderRhythm(
		candidates.notes, tempo, candidates.skipCosts, undefined, endingRelease
	);
	const key = inferRecorderKey(detected);

	// Normalize to concert C — user licks are stored in C like the curated
	// catalog and transposed at practice time.
	return { phrase: recordedPhrase(notes, key), performedNotes: notes, detectedKey: key,
		detected, candidates, recoveredNotes: [...additions.values()], endingRelease, octaveCorrections, phaseSeconds, collisions, omitted: omittedIndices.length,
		omittedBoundaries: omittedIndices.map(i => ({
			time: candidates.notes[i].onsetTime, midi: candidates.notes[i].midi,
			reason: endingRelease !== undefined && i === candidates.notes.length - 1 ? 'sustained ending' : candidates.reasons[i]
		})) };
}

/** Insert recovered passing tones and make a confirmed final tongue mandatory. */
function refineRecorderNotes(segmented: BoundaryEvidence, additions: Map<number, DetectedNote>, protectRepeat: boolean): BoundaryEvidence {
	if (!additions.size && !protectRepeat) return segmented;
	const refined: BoundaryEvidence = { notes: [], skipCosts: [], reasons: [] };
	for (const [index, note] of segmented.notes.entries()) {
		const passing = additions.get(index);
		refined.notes.push(passing ? { ...note, duration: passing.onsetTime - note.onsetTime } : note);
		const repeatedAttack = protectRepeat && index === segmented.notes.length - 1;
		refined.skipCosts.push(repeatedAttack ? Infinity : segmented.skipCosts[index]);
		refined.reasons.push(repeatedAttack ? null : segmented.reasons[index]);
		if (passing) {
			refined.notes.push(passing);
			refined.skipCosts.push(Infinity);
			refined.reasons.push(null);
		}
	}
	return refined;
}

/** Save in concert C, using the tonic supplied by the musician or inferred from the take. */
export function recordedPhrase(notes: Note[], key: PitchClass): Phrase {
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
