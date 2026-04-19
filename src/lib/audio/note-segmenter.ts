/**
 * Note segmentation: combine pitch readings + onset timestamps into DetectedNote[].
 *
 * Each onset starts a new note. The pitch is picked by a clarity-weighted
 * pitch-class vote followed by a nearest-octave tie-break. Duration is the
 * time to the next onset (or end of recording).
 */

import type { DetectedNote } from '$lib/types/audio';
import type { PitchReading } from './pitch-detector';

/**
 * Warmup frames (emitted during the octave stabilizer's warmup window) are
 * down-weighted because raw MIDI passes through unstabilized and often
 * reflects attack-transient partials.
 */
const WARMUP_WEIGHT_FACTOR = 0.25;

function readingWeight(r: PitchReading): number {
	const w = r.clarity * r.clarity;
	return r.warmup ? w * WARMUP_WEIGHT_FACTOR : w;
}

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
	onsetGuard: number = 0.08,
	minReadings: number = 3
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

		// Split on durable pitch changes (legato transitions produce no
		// amplitude-based onset). Each sub-segment becomes its own note.
		// Use segStart (not effectiveStart) so the emitted note's onsetTime
		// matches the caller's onset — the guard only affects which readings
		// are scanned, not the reported note boundary.
		const subSegments = splitByPitchChange(segReadings, segStart, segEnd);

		for (const sub of subSegments) {
			const prevMidi = notes.length > 0 ? notes[notes.length - 1].midi : null;
			const note = emitNote(
				sub.readings,
				sub.start,
				sub.end - sub.start,
				prevMidi,
				minReadings,
				minNoteDuration
			);
			if (note) notes.push(note);
		}
	}

	return notes;
}

/**
 * Number of consecutive frames a different MIDI must persist to count as
 * a pitch-change split point. At ~60 fps this is ~50 ms — rejects transient
 * glitches, catches genuine legato transitions.
 */
const PITCH_CHANGE_MIN_HOLD = 3;

/**
 * Sub-segments shorter than this that are exactly ±12 semitones from a
 * longer neighbor are treated as McLeod subharmonic glitches and merged.
 * Chosen at ~150 ms — shorter than a fast quarter note (~250 ms at 240 BPM),
 * longer than a PITCH_CHANGE_MIN_HOLD window (~50 ms at 60 fps).
 */
const MIN_DURABLE_SUB_DURATION = 0.15;

interface SubSegment {
	start: number;
	end: number;
	readings: PitchReading[];
	/** The stable MIDI run that defined this sub-segment */
	primaryMidi: number;
}

/**
 * Walk the readings looking for stable runs of a consistent MIDI. When the
 * stable MIDI changes, split the segment at the transition point. This
 * catches legato pitch changes that don't produce an amplitude-based onset.
 * After splitting, collapses short octave-artifact sub-segments (see
 * collapseOctaveArtifacts).
 */
function splitByPitchChange(
	segReadings: PitchReading[],
	segStart: number,
	segEnd: number
): SubSegment[] {
	if (segReadings.length < PITCH_CHANGE_MIN_HOLD * 2) {
		const primaryMidi = segReadings[0]?.midi ?? 0;
		return [{ start: segStart, end: segEnd, readings: segReadings, primaryMidi }];
	}

	const subs: SubSegment[] = [];
	let subStart = segStart;
	let subStartIdx = 0;
	let stableMidi: number | null = null;

	let runMidi: number | null = null;
	let runCount = 0;
	let runStartIdx = 0;

	for (let i = 0; i < segReadings.length; i++) {
		const m = segReadings[i].midi;
		if (m === runMidi) {
			runCount++;
		} else {
			runMidi = m;
			runCount = 1;
			runStartIdx = i;
		}

		if (runCount === PITCH_CHANGE_MIN_HOLD) {
			if (stableMidi !== null && runMidi !== stableMidi) {
				const splitTime = segReadings[runStartIdx].time;
				subs.push({
					start: subStart,
					end: splitTime,
					readings: segReadings.slice(subStartIdx, runStartIdx),
					primaryMidi: stableMidi
				});
				subStart = splitTime;
				subStartIdx = runStartIdx;
			}
			stableMidi = runMidi;
		}
	}

	subs.push({
		start: subStart,
		end: segEnd,
		readings: segReadings.slice(subStartIdx),
		primaryMidi: stableMidi ?? segReadings[0].midi
	});

	return mergeConsecutiveSameMidi(collapseOctaveArtifacts(subs));
}

/**
 * Fraction of readings whose RAW (pre-stabilization) MIDI matches the given
 * target. Computed from `frequency` because `midiFloat` carries the
 * stabilizer's octave correction. The McLeod subharmonic glitch is
 * characterized by the stabilizer locking on one octave while the
 * underlying frequencies drift between the two — exactly what we want
 * to count here.
 */
function rawMidiMatchFraction(readings: PitchReading[], target: number): number {
	if (readings.length === 0) return 0;
	let matches = 0;
	for (const r of readings) {
		const rawMidi = Math.round(12 * Math.log2(r.frequency / 440) + 69);
		if (rawMidi === target) matches++;
	}
	return matches / readings.length;
}

/** Threshold for raw-frequency-match collapse — see collapseOctaveArtifacts. */
const OCTAVE_ARTIFACT_RAW_MATCH = 0.25;

/**
 * Merge sub-segments whose primaryMidi is exactly ±12 semitones from a
 * longer neighbor's. Catches McLeod subharmonic glitches at legato
 * transitions and during sustained-note pitch bends.
 *
 * A sub merges into a longer ±12 neighbor when EITHER:
 *   1. it's shorter than MIN_DURABLE_SUB_DURATION (handles attack-time
 *      glitches that resolve quickly), OR
 *   2. ≥ OCTAVE_ARTIFACT_RAW_MATCH of its raw frequencies match the
 *      neighbor's pitch (handles longer glitches where the stabilizer
 *      locked on a subharmonic while the underlying audio drifted between
 *      the fundamental and the half-frequency).
 *
 * Only triggers on exact-octave differences, so genuine short non-octave
 * notes (e.g. grace notes in a real phrase) are preserved.
 */
function collapseOctaveArtifacts(subs: SubSegment[]): SubSegment[] {
	if (subs.length <= 1) return subs;

	const result: SubSegment[] = [];
	for (let i = 0; i < subs.length; i++) {
		const cur = subs[i];
		const curDuration = cur.end - cur.start;
		const last = result[result.length - 1];
		const next = subs[i + 1];

		const isShort = curDuration < MIN_DURABLE_SUB_DURATION;

		if (
			next &&
			Math.abs(cur.primaryMidi - next.primaryMidi) === 12 &&
			next.end - next.start > curDuration &&
			(isShort || rawMidiMatchFraction(cur.readings, next.primaryMidi) >= OCTAVE_ARTIFACT_RAW_MATCH)
		) {
			subs[i + 1] = {
				start: cur.start,
				end: next.end,
				readings: [...cur.readings, ...next.readings],
				primaryMidi: next.primaryMidi
			};
			continue;
		}
		if (
			last &&
			Math.abs(cur.primaryMidi - last.primaryMidi) === 12 &&
			last.end - last.start > curDuration &&
			(isShort || rawMidiMatchFraction(cur.readings, last.primaryMidi) >= OCTAVE_ARTIFACT_RAW_MATCH)
		) {
			result[result.length - 1] = {
				start: last.start,
				end: cur.end,
				readings: [...last.readings, ...cur.readings],
				primaryMidi: last.primaryMidi
			};
			continue;
		}
		result.push(cur);
	}
	return result;
}

/**
 * Merge consecutive same-MIDI sub-segments produced by collapseOctaveArtifacts.
 * When a glitch sub-segment merges into one of its octave neighbors, the
 * other neighbor (same MIDI, opposite side) is left adjacent — this
 * second-pass collapses them into one continuous note.
 */
function mergeConsecutiveSameMidi(subs: SubSegment[]): SubSegment[] {
	if (subs.length <= 1) return subs;
	const result: SubSegment[] = [subs[0]];
	for (let i = 1; i < subs.length; i++) {
		const prev = result[result.length - 1];
		const cur = subs[i];
		if (prev.primaryMidi === cur.primaryMidi) {
			result[result.length - 1] = {
				start: prev.start,
				end: cur.end,
				readings: [...prev.readings, ...cur.readings],
				primaryMidi: prev.primaryMidi
			};
		} else {
			result.push(cur);
		}
	}
	return result;
}

function emitNote(
	subReadings: PitchReading[],
	subStart: number,
	subDuration: number,
	prevMidi: number | null,
	minReadings: number,
	minNoteDuration: number
): DetectedNote | null {
	if (subReadings.length === 0) return null;

	// Short-note fallback (4d): when a segment has some data but not enough
	// to run the full vote, pick the single highest-clarity reading so a
	// quarter note at fast tempo isn't silently dropped. Requires at least
	// 2 readings so a single stray frame can't invent a phantom note.
	if (subReadings.length < minReadings) {
		if (subReadings.length < 2 || subDuration < minNoteDuration) return null;
		const pick = subReadings.reduce((best, r) =>
			r.clarity > best.clarity ? r : best
		);
		return {
			midi: pick.midi,
			cents: pick.cents,
			onsetTime: subStart,
			duration: subDuration,
			clarity: pick.clarity * 0.5
		};
	}

	// Clarity-weighted pitch-class + nearest-octave aggregation (4c).
	// Sustained, high-clarity frames dominate the vote; attack transients
	// and subharmonic glitches get outvoted. Tie-break the octave by
	// proximity to the previous note so cross-note flips don't happen.
	const chosenMidi = pickMidi(subReadings, prevMidi);

	const matchingReadings = subReadings.filter((r) => r.midi === chosenMidi);
	const centsList = matchingReadings.map((r) => r.cents).sort((a, b) => a - b);
	const medianCents = centsList[Math.floor(centsList.length / 2)];

	const avgClarity =
		matchingReadings.reduce((sum, r) => sum + r.clarity, 0) / matchingReadings.length;

	return {
		midi: chosenMidi,
		cents: medianCents,
		onsetTime: subStart,
		duration: subDuration,
		clarity: avgClarity
	};
}

/**
 * Pick the MIDI note for a segment using a two-stage weighted vote:
 *   1. Pitch class (midi % 12) with the largest summed weight wins.
 *   2. Among readings at that pitch class, the octave with the largest
 *      summed weight wins. Ties (or near-ties) are broken by proximity to
 *      the previous note's MIDI.
 */
function pickMidi(readings: PitchReading[], prevMidi: number | null): number {
	const pcWeights = new Map<number, number>();
	for (const r of readings) {
		const pc = ((r.midi % 12) + 12) % 12;
		pcWeights.set(pc, (pcWeights.get(pc) ?? 0) + readingWeight(r));
	}

	let winningPc = 0;
	let bestPcWeight = -Infinity;
	for (const [pc, w] of pcWeights) {
		if (w > bestPcWeight) {
			bestPcWeight = w;
			winningPc = pc;
		}
	}

	const octaveWeights = new Map<number, number>();
	for (const r of readings) {
		const pc = ((r.midi % 12) + 12) % 12;
		if (pc !== winningPc) continue;
		octaveWeights.set(r.midi, (octaveWeights.get(r.midi) ?? 0) + readingWeight(r));
	}

	// Octave pick: highest weight, with ties (and near-ties within 5%)
	// broken by proximity to the previous note's MIDI.
	let bestMidi = 0;
	let bestWeight = -Infinity;
	const TIE_EPSILON = 0.05;
	for (const [midi, w] of octaveWeights) {
		if (w > bestWeight * (1 + TIE_EPSILON)) {
			bestMidi = midi;
			bestWeight = w;
		} else if (prevMidi !== null && w >= bestWeight * (1 - TIE_EPSILON)) {
			if (Math.abs(midi - prevMidi) < Math.abs(bestMidi - prevMidi)) {
				bestMidi = midi;
				bestWeight = w;
			}
		}
	}
	return bestMidi;
}

// ---------------------------------------------------------------------------
// Onset helpers (moved from score-pipeline to decouple scoring from audio)
// ---------------------------------------------------------------------------

/**
 * Fallback onset extractor used when the worklet produced nothing useful
 * (metronome-only recordings, permission races, etc.). Inferred from
 * gaps and pitch changes in the readings themselves.
 */
export function extractOnsetsFromReadings(readings: PitchReading[]): number[] {
	if (readings.length === 0) return [];
	const onsets: number[] = [readings[0].time];
	const GAP_THRESHOLD = 0.1;
	const MIN_ONSET_INTERVAL = 0.08;
	const ATTACK_LATENCY = 0.05;
	for (let i = 1; i < readings.length; i++) {
		const timeSinceLastOnset = readings[i].time - onsets[onsets.length - 1];
		if (timeSinceLastOnset < MIN_ONSET_INTERVAL) continue;
		const gap = readings[i].time - readings[i - 1].time;
		const noteChanged = readings[i].midi !== readings[i - 1].midi;
		if (gap > GAP_THRESHOLD) {
			onsets.push(readings[i].time - ATTACK_LATENCY);
		} else if (noteChanged) {
			onsets.push(readings[i].time);
		}
	}
	return onsets;
}

/**
 * Resolve the final onset list for segmentation. Worklet onsets are
 * validated against pitch data; if nothing survives, fall back to the
 * reading-derived onsets; finally, prepend onsets for any notes the
 * live worklet missed before the first detected attack — legato lines
 * and recordings that start with the user already playing don't
 * provide the silence→signal HFC ratio the worklet needs to fire.
 *
 * Pre-onset prepend uses stable-pitch-run starts (not just readings[0])
 * so multiple missed notes are recovered, and warmup readings are
 * skipped so the McLeod subharmonic at attack doesn't seed a ghost.
 * A noise burst at capture start can't synthesize an onset because it
 * never forms a stable run after warmup.
 *
 * When the trailing stable-run start lands within ATTACK_DEDUP_WINDOW of
 * the first worklet onset they describe the same attack — the pitch
 * detector caught it earlier than the HFC peak. We replace the worklet
 * onset with the earlier stable-run start so the resulting note isn't
 * fragmented across that boundary.
 */
/** Window inside which a prepended stable-run start and a worklet onset are treated as the same attack. */
const ATTACK_DEDUP_WINDOW = 0.15;

export function resolveOnsets(
	workletOnsets: number[],
	readings: PitchReading[]
): number[] {
	const validated = validateOnsets(workletOnsets, readings);
	const onsets = validated.length > 0 ? validated : extractOnsetsFromReadings(readings);

	if (readings.length === 0 || onsets.length === 0) return onsets;

	const firstOnset = onsets[0];
	const preOnset = readings.filter((r) => r.time < firstOnset);
	const stableStarts = findStableRunStarts(preOnset);

	if (
		stableStarts.length > 0 &&
		firstOnset - stableStarts[stableStarts.length - 1] < ATTACK_DEDUP_WINDOW
	) {
		// Same attack — keep the earlier stable-run start, drop the worklet onset.
		onsets[0] = stableStarts.pop()!;
	}

	return [...stableStarts, ...onsets];
}

/**
 * Find the start time of every stable pitch run in a sequence of readings.
 * A "stable run" is PITCH_CHANGE_MIN_HOLD consecutive frames at the same
 * MIDI note. Warmup readings are skipped because the McLeod attack
 * subharmonic can dominate the warmup mode pick and seed a ghost run
 * one octave below the actual note.
 */
function findStableRunStarts(
	readings: PitchReading[],
	minHold: number = PITCH_CHANGE_MIN_HOLD
): number[] {
	const filtered = readings.filter((r) => !r.warmup);
	if (filtered.length < minHold) return [];

	const starts: number[] = [];
	let runMidi: number | null = null;
	let runCount = 0;
	let runStartIdx = 0;
	let stableMidi: number | null = null;

	for (let i = 0; i < filtered.length; i++) {
		const m = filtered[i].midi;
		if (m === runMidi) {
			runCount++;
		} else {
			runMidi = m;
			runCount = 1;
			runStartIdx = i;
		}

		if (runCount === minHold && runMidi !== stableMidi) {
			starts.push(filtered[runStartIdx].time);
			stableMidi = runMidi;
		}
	}
	return starts;
}
