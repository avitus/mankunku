/**
 * Note segmentation: combine pitch readings + onset timestamps into DetectedNote[].
 *
 * Each onset starts a new note. The pitch is picked by a clarity-weighted
 * pitch-class vote followed by a nearest-octave tie-break. Duration is the
 * time to the next onset (or end of recording).
 */

/**
 * Speaker→mic latency window for treating a worklet onset as bleed from a
 * scheduled audible event (metronome click, backing-track hit). Below the
 * lower bound, a worklet onset that close to a scheduled event is more
 * likely the player articulating on the beat than acoustic bleed; above
 * the upper bound, the event is too far in the past to plausibly be the
 * cause. The 50–200 ms range covers typical Web Audio buffer + room
 * propagation while staying clear of fast tongued re-articulations on a
 * beat (worklet detection latency ~30–50 ms on direct instrument input).
 */
const BLEED_LATENCY_MIN = 0.050;
const BLEED_LATENCY_MAX = 0.200;

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
 * @param workletOnsets - Optional raw AudioWorklet onset timestamps. When
 *   supplied (and non-empty), consecutive same-MIDI notes whose boundary
 *   has no nearby worklet onset are merged — the pitch detector can split
 *   a sustained note via brief clarity dropouts or sub-harmonic glitches,
 *   and the absence of an amplitude attack proves the split is artificial.
 *   Pass the unprocessed worklet onsets (not the resolved/validated set),
 *   since resolveOnsets mixes in pitch-derived starts that we explicitly
 *   want to ignore here.
 */
export function segmentNotes(
	readings: PitchReading[],
	onsets: number[],
	recordingDuration: number,
	minNoteDuration: number = 0.05,
	onsetGuard: number = 0.08,
	minReadings: number = 3,
	workletOnsets?: number[],
	bleedOnsets?: number[],
	articulationOnsets?: number[]
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

	// Cross-segment octave-artifact collapse. A McLeod subharmonic glitch
	// at a note's attack can produce a brief ±12 sub-segment in the PREVIOUS
	// segment (the glitch frames sit before the worklet onset boundary).
	// The within-segment collapseOctaveArtifacts can't see across boundaries,
	// so apply the same shape here. Walk in reverse so an earlier splice
	// doesn't reindex elements still under inspection. Threshold mirrors
	// MIN_DURABLE_SUB_DURATION (0.15s) — real grace notes ≥ 150ms are kept.
	for (let k = notes.length - 2; k >= 0; k--) {
		const cur = notes[k];
		const next = notes[k + 1];
		if (
			Math.abs(cur.midi - next.midi) === 12 &&
			cur.duration < next.duration &&
			cur.duration < MIN_DURABLE_SUB_DURATION
		) {
			notes.splice(k, 1);
		}
	}

	// Sandwich rule: a note that is ±12 from BOTH neighbors when those
	// neighbors share the same midi is a stuck-octave artifact — typically
	// the pitch detector locking onto the 2nd harmonic for a stretch in the
	// middle of a sustained note. Merge the three into one continuous note
	// regardless of the middle note's duration. Genuine fast octave
	// displacement is rare enough, and bracketing same-pitch neighbors is
	// strong evidence the middle is detection error rather than music.
	const sandwiched = collapseSandwichArtifacts(notes);

	// Same-pitch attack-evidence merge. Both extractOnsetsFromReadings and
	// splitOnReadingGaps can manufacture a same-MIDI boundary from a pure
	// clarity dropout — there is no audio attack there, only the pitch
	// tracker losing the signal for a few frames. When the caller passes
	// the raw worklet onsets we can prove the boundary is artificial: a
	// real re-articulation produces an amplitude transient the worklet
	// catches, so an unsupported same-MIDI boundary collapses.
	const haveAttackEvidence =
		(workletOnsets && workletOnsets.length > 0) ||
		(articulationOnsets && articulationOnsets.length > 0);
	if (!haveAttackEvidence) return sandwiched;

	const samePitchMerged = mergeSamePitchWithoutAttack(
		sandwiched,
		workletOnsets ?? [],
		undefined,
		bleedOnsets,
		articulationOnsets
	);

	// Octave-boundary merge. McLeod can sustainably lock onto the second
	// harmonic of a low note (its half-period), producing a spurious
	// upper-octave segment adjacent to the true fundamental segment.
	// When two adjacent notes are exactly an octave apart, no real attack
	// at the boundary, AND the higher segment's RAW frequencies contain
	// multiple frames matching the lower segment's pitch (which they
	// wouldn't if the upper octave were genuinely present in the audio),
	// the upper segment is a stabilizer-locked harmonic. Collapse to lower.
	return mergeOctaveBoundariesWithoutAttack(
		samePitchMerged,
		readings,
		workletOnsets ?? [],
		undefined,
		bleedOnsets
	);
}

/**
 * Window for treating a worklet onset as evidence of a real attack at a
 * segment boundary. 75 ms is wider than typical worklet detection latency
 * (~20–40 ms after the transient) but narrower than even 32nd-note
 * articulations at 200 BPM (75 ms apart), so real repeated articulations
 * never get merged.
 */
const SAME_PITCH_ATTACK_WINDOW = 0.075;

/**
 * Merge consecutive same-MIDI notes whose boundary has no worklet onset
 * within ±window. The merged note spans the union of the two; cents and
 * clarity are duration-weighted averages so a long sustain isn't overridden
 * by a brief glitch fragment.
 *
 * Different-MIDI neighbours are passed through untouched — pitch transitions
 * are handled upstream by splitByPitchChange and don't need attack evidence.
 *
 * `bleedOnsets` (optional): scheduled times of audible events that bleed
 * into the mic (typically metronome clicks). A worklet onset that falls
 * in the speaker→mic latency window after one of these is treated as
 * acoustic bleed, not an instrument attack, so the same-MIDI split it
 * caused collapses. Without this, a metronome click sitting in the
 * middle of a sustained note manufactures a phantom re-articulation.
 */
export function mergeSamePitchWithoutAttack(
	notes: DetectedNote[],
	workletOnsets: number[],
	window: number = SAME_PITCH_ATTACK_WINDOW,
	bleedOnsets?: number[],
	articulationOnsets?: number[]
): DetectedNote[] {
	if (notes.length < 2) return notes;
	const articulations = articulationOnsets ?? [];
	if (workletOnsets.length === 0 && articulations.length === 0) return notes;

	// hasRealAttackNear's early-return assumes ascending order. The live
	// worklet emits in time order so this is usually true, but sort a
	// shallow copy defensively so an unsorted caller can't silently
	// produce wrong merges.
	const sortedOnsets = [...workletOnsets].sort((a, b) => a - b);
	const sortedArticulations = [...articulations].sort((a, b) => a - b);
	const sortedBleed =
		bleedOnsets && bleedOnsets.length > 0
			? [...bleedOnsets].sort((a, b) => a - b)
			: [];

	const result: DetectedNote[] = [];
	for (const cur of notes) {
		const last = result[result.length - 1];
		// Articulation onsets are pitch-detector-derived (clarity + RMS dip
		// evidence) and aren't subject to the speaker→mic latency that the
		// worklet's bleed filter guards against, so they count as attack
		// evidence even when adjacent to a scheduled bleed event.
		const hasAttack =
			hasRealAttackNear(sortedOnsets, cur.onsetTime, window, sortedBleed) ||
			hasOnsetNear(sortedArticulations, cur.onsetTime, window);
		if (last && last.midi === cur.midi && !hasAttack) {
			const totalDuration = cur.onsetTime + cur.duration - last.onsetTime;
			const wLast = last.duration;
			const wCur = cur.duration;
			const wSum = wLast + wCur;
			result[result.length - 1] = {
				midi: last.midi,
				cents: Math.round((last.cents * wLast + cur.cents * wCur) / wSum),
				onsetTime: last.onsetTime,
				duration: totalDuration,
				clarity: (last.clarity * wLast + cur.clarity * wCur) / wSum
			};
			continue;
		}
		result.push(cur);
	}
	return result;
}

/**
 * Minimum number of "wrong-octave" raw-frequency frames inside the higher
 * of two adjacent ±12 segments before we treat the upper segment as a
 * McLeod second-harmonic lock. Each frame is a McLeod detection event
 * where the underlying frequency matched the LOWER octave's MIDI — strong
 * evidence the lower octave's fundamental is acoustically present (which
 * couldn't happen if the upper octave were the true pitch, since a real
 * upper-octave note's audio doesn't contain the lower-octave fundamental).
 * Three independent events is well above noise; the bc-016 fixture has 7.
 */
const MIN_LOWER_FUNDAMENTAL_FRAMES = 3;

/**
 * Count readings in `[startTime, endTime)` whose RAW frequency (not the
 * octave-stabilized `midi` field) rounds to `lowerMidi`. McLeod's raw
 * pick is the source of truth here — the stabilizer can lie about the
 * octave for a long stretch while the underlying autocorrelation
 * occasionally pulls toward the true fundamental.
 */
function countLowerFundamentalFrames(
	readings: PitchReading[],
	lowerMidi: number,
	startTime: number,
	endTime: number
): number {
	let count = 0;
	for (const r of readings) {
		if (r.time < startTime) continue;
		if (r.time >= endTime) break;
		const rawMidi = Math.round(12 * Math.log2(r.frequency / 440) + 69);
		if (rawMidi === lowerMidi) count++;
	}
	return count;
}

/**
 * Merge two adjacent notes exactly an octave apart when (a) there is no
 * real worklet attack at the boundary AND (b) the higher segment's raw
 * frequencies show ≥ `MIN_LOWER_FUNDAMENTAL_FRAMES` frames pulled toward
 * the lower fundamental. The merged note adopts the lower MIDI (the
 * fundamental) and spans the union of both notes' times; cents and
 * clarity are duration-weighted, mirroring `mergeSamePitchWithoutAttack`.
 *
 * Rationale: McLeod's failure mode on low-register notes is locking
 * onto the half-period, which corresponds to the second harmonic an
 * octave above. The stabilizer holds that lock against momentary
 * fundamental detections, producing a spurious upper-octave segment
 * adjacent to the true note. The raw-frequency evidence is the smoking
 * gun — a genuinely-played upper-octave note's audio contains no lower
 * fundamental, so the count is zero; a stabilizer-locked harmonic has
 * many frames of leaked-through fundamental detection.
 *
 * Sub-octave artifacts (McLeod returning lower-than-true) don't get
 * touched here — the rule is asymmetric (merge to lower) because they
 * are vanishingly rare and the existing within-segment
 * `collapseOctaveArtifacts` already handles brief variants.
 *
 * `readings` is the full sorted pitch-reading stream; the function
 * filters by segment time range internally.
 */
export function mergeOctaveBoundariesWithoutAttack(
	notes: DetectedNote[],
	readings: PitchReading[],
	workletOnsets: number[],
	window: number = SAME_PITCH_ATTACK_WINDOW,
	bleedOnsets?: number[]
): DetectedNote[] {
	if (notes.length < 2 || workletOnsets.length === 0 || readings.length === 0) {
		return notes;
	}

	const sortedOnsets = [...workletOnsets].sort((a, b) => a - b);
	const sortedBleed =
		bleedOnsets && bleedOnsets.length > 0
			? [...bleedOnsets].sort((a, b) => a - b)
			: [];

	const result: DetectedNote[] = [];
	for (const cur of notes) {
		const last = result[result.length - 1];
		if (
			last &&
			Math.abs(last.midi - cur.midi) === 12 &&
			!hasRealAttackNear(sortedOnsets, cur.onsetTime, window, sortedBleed)
		) {
			const higher = last.midi > cur.midi ? last : cur;
			const lower = last.midi < cur.midi ? last : cur;
			const lowerFundCount = countLowerFundamentalFrames(
				readings,
				lower.midi,
				higher.onsetTime,
				higher.onsetTime + higher.duration
			);
			if (lowerFundCount >= MIN_LOWER_FUNDAMENTAL_FRAMES) {
				const totalDuration = cur.onsetTime + cur.duration - last.onsetTime;
				const wLast = last.duration;
				const wCur = cur.duration;
				const wSum = wLast + wCur;
				result[result.length - 1] = {
					midi: lower.midi,
					cents: Math.round((last.cents * wLast + cur.cents * wCur) / wSum),
					onsetTime: last.onsetTime,
					duration: totalDuration,
					clarity: (last.clarity * wLast + cur.clarity * wCur) / wSum
				};
				continue;
			}
		}
		result.push(cur);
	}
	return result;
}

/**
 * Whether a worklet onset's timing matches the speaker→mic latency window
 * after any known bleed event. Bleed times must be sorted ascending; the
 * scan walks past bleed events that are too far in the past (latency >
 * `BLEED_LATENCY_MAX`) and bails once it lands on one too close to (or
 * past) the worklet onset (latency < `BLEED_LATENCY_MIN`).
 */
function isLikelyBleed(workletOnsetTime: number, sortedBleed: number[]): boolean {
	for (const t of sortedBleed) {
		const latency = workletOnsetTime - t;
		if (latency > BLEED_LATENCY_MAX) continue;
		if (latency < BLEED_LATENCY_MIN) return false;
		return true;
	}
	return false;
}

/**
 * True iff there is a worklet onset within ±window of `target` that is
 * NOT plausibly bleed from a scheduled audible event. When `sortedBleed`
 * is empty this matches the legacy "any nearby onset counts" behaviour.
 */
function hasRealAttackNear(
	sortedOnsets: number[],
	target: number,
	window: number,
	sortedBleed: number[]
): boolean {
	for (const o of sortedOnsets) {
		if (o > target + window) return false;
		if (Math.abs(o - target) <= window && !isLikelyBleed(o, sortedBleed)) return true;
	}
	return false;
}

/**
 * True iff `sortedOnsets` contains any element within ±window of `target`.
 * Used for pitch-detector-derived articulation onsets, which (unlike raw
 * worklet onsets) aren't subject to speaker→mic bleed latency, so the
 * scheduled-event filter doesn't apply.
 */
function hasOnsetNear(
	sortedOnsets: number[],
	target: number,
	window: number
): boolean {
	for (const o of sortedOnsets) {
		if (o > target + window) return false;
		if (Math.abs(o - target) <= window) return true;
	}
	return false;
}

/**
 * Recording-time positions of metronome clicks during a capture window.
 * Used as bleed evidence by `mergeSamePitchWithoutAttack`. The metronome
 * schedules a click on every beat starting at Transport time 0 (see
 * `audio/metronome.ts`), so click times in Transport seconds are integer
 * multiples of `60 / tempo`; we convert to recording-time by subtracting
 * `recordingTransportSeconds`.
 *
 * Includes a 250 ms pre-recording lookback so a click that fired just
 * before capture but whose speaker→mic propagation arrived inside the
 * recording window is still represented.
 */
export function getMetronomeBleedOnsets(
	recordingTransportSeconds: number,
	tempo: number,
	recordingDuration: number
): number[] {
	if (tempo <= 0 || recordingDuration <= 0) return [];
	const beatDuration = 60 / tempo;
	const PRE_RECORDING_LOOKBACK = 0.250;
	const scanStartTransport = recordingTransportSeconds - PRE_RECORDING_LOOKBACK;
	const scanEndTransport = recordingTransportSeconds + recordingDuration;
	const out: number[] = [];
	let beat = Math.ceil(scanStartTransport / beatDuration) * beatDuration;
	while (beat <= scanEndTransport) {
		out.push(beat - recordingTransportSeconds);
		beat += beatDuration;
	}
	return out;
}

function collapseSandwichArtifacts(notes: DetectedNote[]): DetectedNote[] {
	if (notes.length < 3) return notes;
	const result: DetectedNote[] = [];
	for (let k = 0; k < notes.length; k++) {
		const cur = notes[k];
		const last = result[result.length - 1];
		const next = notes[k + 1];
		if (
			last &&
			next &&
			last.midi === next.midi &&
			Math.abs(cur.midi - last.midi) === 12
		) {
			result[result.length - 1] = {
				...last,
				duration: next.onsetTime + next.duration - last.onsetTime
			};
			k++; // skip `next` — already consumed by the merge
			continue;
		}
		result.push(cur);
	}
	return result;
}

/**
 * Number of consecutive frames a different MIDI must persist to count as
 * a pitch-change split point. At ~60 fps this is ~50 ms — rejects transient
 * glitches, catches genuine legato transitions.
 */
const PITCH_CHANGE_MIN_HOLD = 3;

/**
 * Minimum frames for a stable run that is flanked by clarity-dropout gaps
 * on both sides. Real but brief notes (transient pitches during fast
 * lines) often only register 2 frames before the detector loses
 * confidence. The flanking-gap context distinguishes these from
 * mid-sustain glitches, which never have gaps around them.
 */
const EPHEMERAL_RUN_MIN_HOLD = 2;

/** Minimum frame-to-frame gap that flags a clarity dropout. ~3 frames at 60fps. */
const EPHEMERAL_FLANKING_GAP = 0.05;

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

	return splitOnReadingGaps(mergeConsecutiveSameMidi(collapseOctaveArtifacts(subs)));
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

/**
 * Minimum reading gap that signals a re-articulation of the same pitch.
 * Pitchy emits at ~60fps (16.67ms intervals); a 75ms gap = ~4.5 missed frames.
 * Empirically, real-recording sustain dropouts reach ~67ms (4 frames); soft
 * re-articulation gaps start at ~84ms. 75ms cleanly separates the two classes.
 */
const READING_GAP_SPLIT_THRESHOLD = 0.075;

/**
 * Split same-MIDI sub-segments on internal reading gaps. A clarity-driven
 * gap of >= READING_GAP_SPLIT_THRESHOLD inside a sub-segment signals a
 * soft re-articulation that the HFC onset worklet missed.
 */
function splitOnReadingGaps(
	subs: SubSegment[],
	threshold: number = READING_GAP_SPLIT_THRESHOLD
): SubSegment[] {
	const result: SubSegment[] = [];
	for (const sub of subs) {
		if (sub.readings.length < 2) {
			result.push(sub);
			continue;
		}
		let curStart = sub.start;
		let curStartIdx = 0;
		for (let i = 1; i < sub.readings.length; i++) {
			const gap = sub.readings[i].time - sub.readings[i - 1].time;
			// Only split where both flanking readings match the primaryMidi.
			// Gaps that straddle a pitch-class transition are already handled by
			// splitByPitchChange; splitting them here would fragment a sub-segment
			// whose edges contain residual off-pitch warmup or attack frames.
			const bothOnPrimary =
				sub.readings[i - 1].midi === sub.primaryMidi &&
				sub.readings[i].midi === sub.primaryMidi;
			if (gap >= threshold && bothOnPrimary) {
				result.push({
					start: curStart,
					end: sub.readings[i].time,
					readings: sub.readings.slice(curStartIdx, i),
					primaryMidi: sub.primaryMidi
				});
				curStart = sub.readings[i].time;
				curStartIdx = i;
			}
		}
		result.push({
			start: curStart,
			end: sub.end,
			readings: sub.readings.slice(curStartIdx),
			primaryMidi: sub.primaryMidi
		});
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

	// Reject sub-segments composed entirely of warmup readings. By definition
	// the stabilizer never confirmed a steady pitch on these frames, so they
	// don't represent a real note — they're transient noise (mouthpiece
	// artifacts, post-reset bursts, etc.) that the emit-time aggregation
	// would otherwise crystallize into a phantom MIDI.
	if (subReadings.every((r) => r.warmup)) return null;

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
	const stableStarts = findStableRunStarts(preOnset, firstOnset);

	if (stableStarts.length > 0) {
		const lastStable = stableStarts[stableStarts.length - 1];
		if (firstOnset - lastStable.time < ATTACK_DEDUP_WINDOW) {
			// Same-attack dedup: collapse only when both sources point at the
			// same note. The post-onset readings are scanned skipping warmup
			// because warmup MIDI is unstabilized and may carry the McLeod
			// attack subharmonic — exactly the noise this dedup needs to
			// avoid being fooled by. When no non-warmup post-onset reading
			// exists (recording ends right at/after the onset) default to
			// deduping, preserving prior behavior for that edge case.
			const post = readings.find((r) => !r.warmup && r.time >= firstOnset);
			if (post === undefined || post.midi === lastStable.midi) {
				onsets[0] = lastStable.time;
				stableStarts.pop();
			}
		}
	}

	return [...stableStarts.map((s) => s.time), ...onsets];
}

interface StableRunStart {
	time: number;
	midi: number;
}

/**
 * Find the start time of every stable pitch run in a sequence of readings.
 * A "stable run" is `minHold` consecutive frames at the same MIDI note.
 * Warmup readings are skipped because the McLeod attack subharmonic can
 * dominate the warmup mode pick and seed a ghost run one octave below
 * the actual note.
 *
 * @param nextEventTime When provided, the LAST candidate run uses
 *   `nextEventTime - lastReadingTime` as `gapAfter` (instead of the
 *   edge-of-array sentinel 0). Lets a 2-frame run that sits between a
 *   clarity-dropout gap and the upcoming worklet onset qualify as
 *   gap-flanked. Caller in `resolveOnsets` passes the first worklet
 *   onset for this purpose.
 *
 * The function operates in four phases:
 *
 * Phase 1 — Collect: gather every contiguous same-MIDI run of length >=
 * EPHEMERAL_RUN_MIN_HOLD (2 frames) as a candidate.
 *
 * Phase 2 — Filter with ephemeral acceptance: keep runs of length >=
 * minHold unconditionally. For shorter runs (>= EPHEMERAL_RUN_MIN_HOLD),
 * require a clarity-dropout gap on BOTH sides — a real but brief note
 * registers 2 frames between two pitch-detection gaps, while sustain-noise
 * glitches sit in the middle of a continuous reading stream (no flanking
 * gaps). This distinguishes genuine transient pitches during fast lines from
 * mid-sustain wobbles produced by vibrato or McLeod detector noise.
 *
 * Phase 3 — Dedup: collapse consecutive accepted runs of the same MIDI.
 * Only emit on a MIDI change.
 *
 * Phase 4 — Octave-artifact collapse (Fix #1, preserved): if a run is
 * exactly ±12 semitones from the next run AND shorter than it, drop it.
 * This handles the case where Pitchy's octave stabilizer locks onto
 * the half-frequency for a few frames at a note attack before settling
 * on the true fundamental — without the collapse, those 3-4 glitch
 * frames would seed their own pre-onset and split the real note in two.
 */
function findStableRunStarts(
	readings: PitchReading[],
	nextEventTime?: number,
	minHold: number = PITCH_CHANGE_MIN_HOLD
): StableRunStart[] {
	const filtered = readings.filter((r) => !r.warmup);
	if (filtered.length < EPHEMERAL_RUN_MIN_HOLD) return [];

	// Phase 1: collect every contiguous run of length >= EPHEMERAL_RUN_MIN_HOLD.
	type Run = { midi: number; startIdx: number; endIdx: number };
	const candidates: Run[] = [];
	let curStart = 0;
	for (let i = 1; i <= filtered.length; i++) {
		const isBoundary = i === filtered.length || filtered[i].midi !== filtered[curStart].midi;
		if (isBoundary) {
			const length = i - curStart;
			if (length >= EPHEMERAL_RUN_MIN_HOLD) {
				candidates.push({ midi: filtered[curStart].midi, startIdx: curStart, endIdx: i - 1 });
			}
			curStart = i;
		}
	}

	// Phase 2: keep runs of length >= minHold; for shorter runs (>=
	// EPHEMERAL_RUN_MIN_HOLD), require a clarity-dropout gap on BOTH sides
	// — a real but brief note registers 2 frames between two pitch-detection
	// gaps, while sustain-noise glitches sit in the middle of a continuous
	// reading stream.
	const accepted: Run[] = [];
	for (const cur of candidates) {
		const length = cur.endIdx - cur.startIdx + 1;
		if (length >= minHold) {
			accepted.push(cur);
			continue;
		}
		// A real clarity-dropout gap requires an actual prior/next reading.
		// Edge-of-array means no flanking context — treat as gap=0 so
		// isolated 2-frame runs at the start or end of the readings
		// window don't self-promote without genuine surrounding evidence.
		// EXCEPTION: when the run is the LAST in the filtered array AND a
		// nextEventTime (worklet onset) is supplied, use the time to that
		// upcoming event as gapAfter — a brief note that sits right before
		// the next attack still has flanking-gap evidence.
		const gapBefore =
			cur.startIdx > 0
				? filtered[cur.startIdx].time - filtered[cur.startIdx - 1].time
				: 0;
		const gapAfter =
			cur.endIdx < filtered.length - 1
				? filtered[cur.endIdx + 1].time - filtered[cur.endIdx].time
				: nextEventTime !== undefined
					? nextEventTime - filtered[cur.endIdx].time
					: 0;
		if (gapBefore >= EPHEMERAL_FLANKING_GAP && gapAfter >= EPHEMERAL_FLANKING_GAP) {
			accepted.push(cur);
		}
	}

	// Phase 3: dedup consecutive same-MIDI runs (only emit on MIDI change).
	const dedup: Run[] = [];
	let lastMidi: number | null = null;
	for (const run of accepted) {
		if (run.midi !== lastMidi) {
			dedup.push(run);
			lastMidi = run.midi;
		}
	}

	// Phase 4: collapse cross-run octave artifacts (Fix #1, preserved).
	// If run[i] is exactly ±12 from run[i+1] AND shorter, it's a
	// McLeod-method octave glitch at the next note's attack — drop it.
	const collapsed: Run[] = [];
	for (let i = 0; i < dedup.length; i++) {
		const cur = dedup[i];
		const next = dedup[i + 1];
		const curLen = cur.endIdx - cur.startIdx + 1;
		if (next) {
			const nextLen = next.endIdx - next.startIdx + 1;
			if (Math.abs(cur.midi - next.midi) === 12 && curLen < nextLen) {
				continue;
			}
		}
		collapsed.push(cur);
	}

	return collapsed.map((r) => ({ time: filtered[r.startIdx].time, midi: r.midi }));
}

/**
 * Re-articulation detection thresholds. The HFC worklet misses soft tongue
 * attacks on a sustained same-pitch note: amplitude dips ~55% for ~50 ms
 * and climbs back, but the recovery's HFC ratio against the EMA only
 * reaches ~1.4× — well below the 3.0× worklet trigger. We find these
 * inside-segment by looking for a paired clarity dip and RMS dip-and-rise
 * in the pitch readings (both signals required so vibrato (RMS-only) and
 * McLeod glitches (clarity-only) don't trigger).
 *
 * The clarity dip can precede the RMS dip by ~100 ms — the tongue stop
 * muddies the harmonic structure before the amplitude follows — so the
 * algorithm anchors on whichever fires first and looks forward up to
 * RE_ARTICULATION_PAIR_WINDOW for the other.
 */
const RE_ARTICULATION_CLARITY_DROP = 0.07;
const RE_ARTICULATION_RMS_DROP_RATIO = 0.30;
const RE_ARTICULATION_RMS_RECOVERY_RATIO = 0.75;
const RE_ARTICULATION_RMS_ONSET_RATIO = 0.65;
const RE_ARTICULATION_PAIR_WINDOW = 0.20;
const RE_ARTICULATION_MIN_INTERVAL = 0.06;
const RE_ARTICULATION_PRE_CONTEXT_FRAMES = 4;
const RE_ARTICULATION_SCAN_WINDOW_FRAMES = 12;
const RE_ARTICULATION_ONSET_GUARD = 0.05;
const RE_ARTICULATION_ATTACK_LATENCY = 0.02;
/**
 * Same-MIDI reading-time gap above which a re-articulation is inferred even
 * without a measurable RMS dip in the readings. Deliberately higher than
 * READING_GAP_SPLIT_THRESHOLD (75 ms): the segmenter splits aggressively at
 * 75 ms, but mid-sustain detector glitches can leave a ~100 ms hole on a
 * single held note (RMS fading + clarity briefly under threshold) that we
 * do NOT want to count as a re-articulation. The 2026-05-22 dropout-gap
 * fixtures show real tongue stops produce gaps ≥ 200 ms (the pitch
 * detector quits emitting AND skips a long warmup window before resuming),
 * so 150 ms gives a comfortable margin on both sides. The dip-and-rise
 * path below catches the softer case where the pitch detector kept
 * emitting through the articulation.
 *
 * Tempo caveat: this is a physical-time threshold, not beat-relative.
 * At very fast tempos (~200 BPM+) the player can't sustain a 150 ms
 * silence between tongued sixteenths, so this pass won't fire — the
 * dip-and-rise scan below is expected to carry those cases because the
 * brief clarity drop will still register even when no gap forms. The
 * fixtures here are all 100 BPM; if a fast-tempo re-articulation MISS
 * shows up in a diagnostic, revisit whether this should become
 * `max(0.15, X * beatDuration)` and capture a fast-tempo fixture before
 * tuning.
 */
const RE_ARTICULATION_READING_GAP = 0.15;

/**
 * Short-gap re-articulation corroboration. A same-MIDI reading gap below
 * RE_ARTICULATION_READING_GAP (so the bare-gap pass won't fire) but at or
 * above READING_GAP_SPLIT_THRESHOLD still marks a tongue re-attack when the
 * amplitude clearly steps UP across the gap. These slip past both existing
 * passes: the bare-gap pass needs ≥ 150 ms, and the dip-and-rise pass needs a
 * measurable RMS dip — but here the pitch detector drops a few frames through
 * the attack transient while the RMS never falls below the pre-gap level, it
 * only jumps higher on the louder re-attack. The HFC worklet misses it too
 * because the energy only roughly doubles (ratio ~1.4×, under the 3.0× trigger).
 *
 * Require the post-gap RMS window to average ≥ RE_ARTICULATION_GAP_ATTACK_RISE
 * times the pre-gap window. A mid-sustain detector dropout leaves RMS flat or
 * fading across the hole (ratio ≲ 1.0), so the rise requirement cleanly
 * separates a real re-articulation from a sustain glitch — without lowering the
 * bare-gap floor that RE_ARTICULATION_READING_GAP deliberately keeps high.
 *
 * Reference: the 2026-06-21 "flat-five-chromatic-up" diagnostic (concert G,
 * 100 BPM) — two tongued C4 quarter-notes, 100 ms reading gap, RMS stepping
 * ~0.044 → ~0.089 (≈2×) across it. Previously merged into one note, dropping
 * the score to 0.62 ("fair") with the second note marked MISSED.
 *
 * 1.5 → 1.2 (2026-06-24): the "blues-curl-up" concert-D diagnostic is the same
 * soft-tongue shape but with a WEAKER measured step-up (~1.26×). The pitch
 * detector resumed on the new note's decay shoulder — the attack peak fell
 * inside the 117 ms reading gap and was never sampled — so the rise across the
 * gap reads lower than the true ~1.8× energy jump in the raw audio. Lowering
 * the floor to 1.2 admits it. This is only safe because the short-gap pass now
 * ALSO requires a true reading-time silence (see the gap pass below): the
 * dangerous false positive — the C-D-C upper-neighbor fixture, whose final-C
 * "gap" is a warmup-bridged stabilizer reset rising ~1.27× (HIGHER than this
 * real re-attack) — is rejected by the silence gate, not by the ratio. The
 * remaining true-gap non-re-attacks (a McLeod subharmonic flicker during a
 * note bend, mid-sustain dropouts) sit at ≤ ~1.12, comfortably below 1.2.
 */
const RE_ARTICULATION_GAP_ATTACK_RISE = 1.2;
const RE_ARTICULATION_GAP_RMS_FRAMES = 3;

/**
 * High-frequency-transient re-articulation tier. The softest legato ("doodle")
 * tongue re-attacks leave NO reading gap, NO envelope dip (the airflow never
 * stops, so rms holds or rises), and a clarity dip too shallow to clear
 * RE_ARTICULATION_CLARITY_DROP — yet they inject a sharp broadband
 * high-frequency burst (tongue noise) that spikes `hfRms` to several times the
 * run baseline. The worklet misses it because its "HFC" is amplitude-weighted
 * (≈Σ|s|·i) and the amplitude barely moves; the captured `hfRms` (RMS of the
 * first-difference high-pass) is the signal that exposes it.
 *
 * A bare hfRms spike is NOT specific. Two corroborators are required, each
 * rejecting a distinct broadband-transient impostor:
 *   1. A coincident perturbation of the FUNDAMENTAL, measured against a LOCAL
 *      baseline (the non-spike frames bracketing the spike, not the whole-run
 *      median). A tongue stop momentarily resets the reed, wobbling `midiFloat`
 *      by ≳0.1 semitone; a key click rides on top of an unbroken fundamental
 *      (midiFloat steady). The local baseline keeps a click landing on a bent or
 *      vibrato'd note from clearing the gate just because the run median sits far
 *      from the local pitch.
 *   2. Sustained energy across the spike: post-spike rms ≥ pre-spike rms ×
 *      HF_RE_ARTICULATION_MIN_RMS_SUSTAIN. A real re-attack adds/holds energy; a
 *      McLeod octave/harmonic flip (broadband AND pitch-unstable, so it clears
 *      the spike + perturbation gates) happens on a decaying note and loses
 *      energy. This also keeps the pass from emitting a spurious split inside an
 *      upper-octave artifact run, which would block the octave-collapse pass.
 * Together with the spike these reject clicks, vibrato/bends, McLeod clarity
 * flickers (no HF spike), and McLeod octave artifacts.
 *
 * Reference: the 2026-06-25 "blues-curl-down" diagnostic (concert Bb, 100 BPM) —
 * two tongued Db4 quarters; the second was a soft legato tongue at ~0.47 s with
 * hfRms spiking 0.012 → 0.067 (≈5.5×), midiFloat dipping ~0.1 st against the
 * local baseline, and rms rising ~1.1× across it — but zero reading gap. The
 * 2026-05-19 "octave-flat-seven-drop" McLeod C5 artifact is the counter-case it
 * must reject: a bigger pitch swing (0.33 st) but a falling envelope (post/pre
 * rms ≈ 0.61). Previously merged the two Dbs into one note, dropping the score
 * to 0.63 ("fair") with the second Db marked MISSED.
 */
const HF_RE_ARTICULATION_SPIKE_RATIO = 3.0;
const HF_RE_ARTICULATION_MIN_PITCH_PERTURB = 0.1;
const HF_RE_ARTICULATION_MIN_RMS_SUSTAIN = 0.9;

/** Median of a numeric array; 0 if empty. Non-mutating. */
function median(xs: number[]): number {
	if (xs.length === 0) return 0;
	const s = [...xs].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Mean RMS over readings[from, to), clamped to bounds; 0 if the range is empty. */
function meanRms(readings: PitchReading[], from: number, to: number): number {
	const lo = Math.max(0, from);
	const hi = Math.min(readings.length, to);
	if (hi <= lo) return 0;
	let sum = 0;
	for (let k = lo; k < hi; k++) sum += readings[k].rms;
	return sum / (hi - lo);
}

/**
 * Whether any reading falls strictly inside the open interval (from, to).
 * `readings` must be sorted ascending by time. Used to tell a genuine
 * detector silence (no frames of any kind across a same-MIDI hole) from a
 * warmup-bridged hole: a same-MIDI run skips warmup frames, so a stabilizer
 * reset mid-note leaves a phantom "gap" between two stable readings even
 * though warmup frames were emitted throughout. Passing the FULL reading
 * stream (warmup included) lets the short-gap re-articulation pass reject
 * those phantom gaps.
 */
function hasReadingInOpenInterval(readings: PitchReading[], from: number, to: number): boolean {
	for (const r of readings) {
		if (r.time <= from) continue;
		if (r.time >= to) return false; // sorted ascending — nothing left in range
		return true;
	}
	return false;
}

/**
 * Detect re-articulations within same-MIDI runs by looking for paired
 * clarity and RMS dip-and-recovery patterns in the pitch readings.
 *
 * Returns extra onset times (relative to recording start) that the worklet
 * missed. These are meant to be merged into the baseline onset list AND
 * threaded through as attack evidence so `mergeSamePitchWithoutAttack`
 * doesn't collapse the new boundaries.
 *
 * The scan operates on contiguous same-MIDI runs in the readings (not on
 * segments defined by the baseline onset list) because a re-articulation
 * can straddle a baseline boundary: `extractOnsetsFromReadings` may have
 * already emitted an onset at the clarity-dropout gap in the middle of
 * the run, but the segmenter's `mergeSamePitchWithoutAttack` then
 * collapses it back together. Looking at the readings directly catches
 * both the "no baseline boundary" case (Blues Curl Down) and the
 * "baseline boundary present but merged away" case (Blues Curl Up).
 *
 * Algorithm (per same-MIDI run):
 *   1. Walk the readings. When clarity drops > RE_ARTICULATION_CLARITY_DROP
 *      below the trailing pre-window max, mark a candidate.
 *   2. Find the clarity minimum in the next ~140 ms.
 *   3. Look forward up to RE_ARTICULATION_PAIR_WINDOW for the RMS minimum.
 *   4. Require: rms drop ratio ≥ RE_ARTICULATION_RMS_DROP_RATIO,
 *      post-min recovery max ≥ RE_ARTICULATION_RMS_RECOVERY_RATIO of the
 *      pre-window rms max.
 *   5. Onset point: the first reading after the rms min where rms first
 *      crosses RE_ARTICULATION_RMS_ONSET_RATIO of the pre-window rms max
 *      while rising. Subtract RE_ARTICULATION_ATTACK_LATENCY so the
 *      boundary lands at the start of the rise, not the steady-state plateau.
 */
export function findReArticulations(
	readings: PitchReading[],
	baseOnsets: number[]
): number[] {
	if (readings.length === 0) return [];

	const onsets: number[] = [];
	const runs = findSameMidiRuns(readings);
	for (const run of runs) {
		// Pass the FULL reading stream so the gap pass can distinguish a true
		// detector silence from a warmup-bridged hole (findSameMidiRuns drops
		// warmup frames, which can manufacture a phantom gap inside a run).
		onsets.push(...findReArticulationsInSegment(run.readings, run.start, run.end, readings));
	}

	// Filter to those that would actually create a new boundary or
	// reinforce a missed one — skip articulation onsets that coincide
	// with an existing baseline onset (within ATTACK_DEDUP_WINDOW),
	// since the boundary is already present; the articulation list is
	// still useful as attack evidence so the merge pass keeps the split.
	// We keep them in the output because the caller uses them as
	// evidence — duplicates are harmless once sorted.
	void baseOnsets;
	return onsets;
}

interface SameMidiRun {
	start: number;
	end: number;
	readings: PitchReading[];
}

/**
 * Group readings into contiguous same-MIDI runs (skipping warmup frames).
 * Two adjacent readings on the same MIDI are part of the same run; a
 * MIDI change starts a new run. Runs shorter than 4 frames are dropped
 * because a re-articulation needs at least a baseline-dip-recovery
 * spread of frames to be detectable.
 */
function findSameMidiRuns(readings: PitchReading[]): SameMidiRun[] {
	const runs: SameMidiRun[] = [];
	let curMidi: number | null = null;
	let curStart = 0;
	let curReadings: PitchReading[] = [];

	const flush = () => {
		if (curReadings.length >= 4) {
			runs.push({
				start: curStart,
				end: curReadings[curReadings.length - 1].time + 0.001,
				readings: curReadings
			});
		}
	};

	for (const r of readings) {
		if (r.warmup) continue;
		if (curMidi === null || r.midi !== curMidi) {
			flush();
			curMidi = r.midi;
			curStart = r.time;
			curReadings = [r];
		} else {
			curReadings.push(r);
		}
	}
	flush();
	return runs;
}

function findReArticulationsInSegment(
	readings: PitchReading[],
	segStart: number,
	segEnd: number,
	allReadings: PitchReading[]
): number[] {
	// Restrict to the segment's stable-MIDI run. Skip warmup frames and a
	// short post-onset guard so the segment-start attack transient isn't
	// mistaken for a re-articulation.
	const inSegment = readings.filter(
		(r) =>
			!r.warmup &&
			r.time >= segStart + RE_ARTICULATION_ONSET_GUARD &&
			r.time < segEnd
	);
	if (inSegment.length < RE_ARTICULATION_PRE_CONTEXT_FRAMES + 4) return [];

	// Determine the segment's primary MIDI by clarity-weighted vote, then
	// keep only readings on that MIDI so legato pitch transitions and brief
	// octave glitches don't seed a dip.
	const midiWeights = new Map<number, number>();
	for (const r of inSegment) {
		midiWeights.set(r.midi, (midiWeights.get(r.midi) ?? 0) + readingWeight(r));
	}
	let primaryMidi = inSegment[0].midi;
	let bestWeight = -Infinity;
	for (const [midi, w] of midiWeights) {
		if (w > bestWeight) {
			bestWeight = w;
			primaryMidi = midi;
		}
	}
	const stable = inSegment.filter((r) => r.midi === primaryMidi);
	if (stable.length < RE_ARTICULATION_PRE_CONTEXT_FRAMES + 4) return [];

	const onsets: number[] = [];

	// Gap pass: a same-MIDI reading-time gap is itself evidence of an
	// articulation. On a sustained reed note the pitch detector practically
	// never loses tracking for >75 ms except at a tongue stop, so the gap
	// stands in for the RMS dip the dip-and-rise scan below can't see (the
	// readings stop being emitted before RMS bottoms out, then resume already
	// recovered). A bare gap ≥ RE_ARTICULATION_READING_GAP fires on its own;
	// a shorter gap (≥ READING_GAP_SPLIT_THRESHOLD, where the segmenter already
	// splits) fires only when the RMS clearly steps up across it, which marks a
	// re-attack and rules out a mid-sustain dropout. Anchor at the resumption
	// of the gap, minus the attack-latency adjustment used elsewhere.
	for (let g = 1; g < stable.length; g++) {
		const gap = stable[g].time - stable[g - 1].time;
		if (gap < READING_GAP_SPLIT_THRESHOLD) continue;
		if (gap < RE_ARTICULATION_READING_GAP) {
			// A genuine soft-tongue re-attack the worklet missed produces a
			// true detector silence — no frames of any kind across the hole.
			// If warmup frames bridge it, the gap is a stabilizer-reset
			// artifact (findSameMidiRuns skipped them, manufacturing a phantom
			// gap), not a missed attack, so the corroborated step-up tier must
			// not fire. The ≥ 150 ms bare-gap tier stays unconditional: a long
			// enough silence is a re-attack even when the stabilizer re-warms
			// as the new note blooms.
			if (hasReadingInOpenInterval(allReadings, stable[g - 1].time, stable[g].time)) {
				continue;
			}
			const preRms = meanRms(stable, g - RE_ARTICULATION_GAP_RMS_FRAMES, g);
			const postRms = meanRms(stable, g, g + RE_ARTICULATION_GAP_RMS_FRAMES);
			if (preRms <= 0 || postRms < preRms * RE_ARTICULATION_GAP_ATTACK_RISE) {
				continue;
			}
		}
		const onsetTime = stable[g].time - RE_ARTICULATION_ATTACK_LATENCY;
		if (onsetTime > segStart + RE_ARTICULATION_ONSET_GUARD) {
			onsets.push(onsetTime);
		}
	}

	// HF-transient pass: catch the softest legato-tongue re-attacks that leave
	// no gap and no envelope dip but spike hfRms (broadband tongue noise) while
	// perturbing the fundamental. See HF_RE_ARTICULATION_SPIKE_RATIO. Gated on
	// hfRms being present so readings restored from pre-2026-06-25 diagnostic
	// JSON (no hfRms field) simply skip this pass.
	if (stable.some((r) => r.hfRms != null)) {
		const baseHf = median(stable.map((r) => r.hfRms ?? 0));
		if (baseHf > 0) {
			let k = 0;
			while (k < stable.length) {
				if ((stable[k].hfRms ?? 0) < baseHf * HF_RE_ARTICULATION_SPIKE_RATIO) {
					k++;
					continue;
				}
				// Span the contiguous spike and track its hfRms peak.
				let peak = k;
				let j = k;
				while (j < stable.length && (stable[j].hfRms ?? 0) >= baseHf * HF_RE_ARTICULATION_SPIKE_RATIO) {
					if ((stable[j].hfRms ?? 0) > (stable[peak].hfRms ?? 0)) peak = j;
					j++;
				}
				// Measure the fundamental perturbation against a LOCAL baseline —
				// the non-spike frames immediately bracketing the spike — not the
				// whole-run median. A vibrato swing or an expressive bend moves the
				// run median far from the local pitch, so a key click landing on the
				// bent portion would clear the gate against the run median even
				// though the fundamental is locally steady. The local baseline
				// tracks the bend, so only a genuine reed reset (which dips the
				// pitch relative to its immediate neighbours) clears the gate.
				const context = [
					...stable.slice(Math.max(0, k - RE_ARTICULATION_PRE_CONTEXT_FRAMES), k),
					...stable.slice(j, Math.min(stable.length, j + RE_ARTICULATION_PRE_CONTEXT_FRAMES))
				];
				const localMidiFloat = median(
					(context.length > 0 ? context : stable).map((r) => r.midiFloat)
				);
				let maxPerturb = 0;
				for (let p = k; p < j; p++) {
					const dev = Math.abs(stable[p].midiFloat - localMidiFloat);
					if (dev > maxPerturb) maxPerturb = dev;
				}
				// A genuine re-attack sustains or adds energy; a McLeod octave/
				// harmonic flip (or any HF artifact on a decaying note) loses it.
				const preRms = meanRms(stable, k - RE_ARTICULATION_PRE_CONTEXT_FRAMES, k);
				const postRms = meanRms(stable, j, j + RE_ARTICULATION_PRE_CONTEXT_FRAMES);
				const sustainsEnergy =
					preRms > 0 && postRms >= preRms * HF_RE_ARTICULATION_MIN_RMS_SUSTAIN;
				if (maxPerturb >= HF_RE_ARTICULATION_MIN_PITCH_PERTURB && sustainsEnergy) {
					const onsetTime = stable[peak].time - RE_ARTICULATION_ATTACK_LATENCY;
					if (onsetTime > segStart + RE_ARTICULATION_ONSET_GUARD) {
						onsets.push(onsetTime);
					}
				}
				k = j; // skip past this spike
			}
		}
	}

	let i = RE_ARTICULATION_PRE_CONTEXT_FRAMES;

	while (i < stable.length - 3) {
		// Pre-window: max clarity and RMS over the trailing N frames. These
		// are the "baseline" we're comparing the dip against.
		let preMaxClarity = 0;
		let preMaxRms = 0;
		const preStart = Math.max(0, i - RE_ARTICULATION_PRE_CONTEXT_FRAMES);
		for (let j = preStart; j < i; j++) {
			if (stable[j].clarity > preMaxClarity) preMaxClarity = stable[j].clarity;
			if (stable[j].rms > preMaxRms) preMaxRms = stable[j].rms;
		}
		if (preMaxClarity <= 0 || preMaxRms <= 0) {
			i++;
			continue;
		}

		// Trigger only on a clarity dip below the pre-window baseline.
		if (preMaxClarity - stable[i].clarity <= RE_ARTICULATION_CLARITY_DROP) {
			i++;
			continue;
		}

		// Find the clarity minimum in a short forward window.
		const clarityScanEnd = Math.min(
			stable.length,
			i + RE_ARTICULATION_SCAN_WINDOW_FRAMES
		);
		let clarityMinIdx = i;
		for (let j = i + 1; j < clarityScanEnd; j++) {
			if (stable[j].clarity < stable[clarityMinIdx].clarity) clarityMinIdx = j;
			// Don't track past the clarity recovery point.
			if (stable[j].clarity > stable[clarityMinIdx].clarity + 0.04) break;
		}

		// From the clarity minimum, look forward up to PAIR_WINDOW for the
		// RMS minimum — the tongue stop muddies harmonics first and dips
		// amplitude shortly after on most reed instruments.
		const rmsSearchEndTime = stable[clarityMinIdx].time + RE_ARTICULATION_PAIR_WINDOW;
		let rmsMinIdx = clarityMinIdx;
		for (let j = clarityMinIdx; j < stable.length && stable[j].time <= rmsSearchEndTime; j++) {
			if (stable[j].rms < stable[rmsMinIdx].rms) rmsMinIdx = j;
		}

		const rmsDropRatio = 1 - stable[rmsMinIdx].rms / preMaxRms;
		if (rmsDropRatio < RE_ARTICULATION_RMS_DROP_RATIO) {
			i = clarityMinIdx + 1;
			continue;
		}

		// Walk forward from the RMS min until rms crosses the onset
		// threshold going up. Also track the post-min max for the
		// recovery-strength check.
		const onsetTarget = preMaxRms * RE_ARTICULATION_RMS_ONSET_RATIO;
		let recoveryIdx = -1;
		let postMaxRms = stable[rmsMinIdx].rms;
		const recoveryEndIdx = Math.min(
			stable.length,
			rmsMinIdx + RE_ARTICULATION_SCAN_WINDOW_FRAMES + 4
		);
		for (let j = rmsMinIdx + 1; j < recoveryEndIdx; j++) {
			if (stable[j].rms > postMaxRms) postMaxRms = stable[j].rms;
			if (recoveryIdx === -1 && stable[j].rms >= onsetTarget) recoveryIdx = j;
		}

		if (
			recoveryIdx === -1 ||
			postMaxRms / preMaxRms < RE_ARTICULATION_RMS_RECOVERY_RATIO
		) {
			i = rmsMinIdx + 1;
			continue;
		}

		const onsetTime = stable[recoveryIdx].time - RE_ARTICULATION_ATTACK_LATENCY;
		if (onsetTime > segStart + RE_ARTICULATION_ONSET_GUARD) {
			onsets.push(onsetTime);
		}
		i = recoveryIdx + 1;
	}

	// Sort + dedupe within MIN_INTERVAL. The dip scan walks forward so it
	// emits in time order on its own, but the gap pass above runs first and
	// can interleave its onsets with later dip detections, so a final sort
	// is required to make the dedupe correct.
	onsets.sort((a, b) => a - b);
	const deduped: number[] = [];
	for (const t of onsets) {
		if (
			deduped.length === 0 ||
			t - deduped[deduped.length - 1] > RE_ARTICULATION_MIN_INTERVAL
		) {
			deduped.push(t);
		}
	}
	return deduped;
}
