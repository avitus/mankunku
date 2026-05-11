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
	return collapseSandwichArtifacts(notes);
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
