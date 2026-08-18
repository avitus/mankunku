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

	// Amplitude-derived boundary times, for the onset-guard provenance check
	// below. Null when the caller supplies neither list (legacy callers) —
	// in that mode every boundary is guarded, preserving prior behaviour.
	const amplitudeOnsets =
		workletOnsets !== undefined || articulationOnsets !== undefined
			? [...(workletOnsets ?? []), ...(articulationOnsets ?? [])].sort((a, b) => a - b)
			: null;

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
		// so early readings report stale pitch values. That rationale only
		// holds for AMPLITUDE-derived boundaries (worklet or articulation
		// onsets): a pitch-derived boundary (stable-run prepend, reading-gap
		// or legato-transition onset) starts exactly where the readings
		// already show the new pitch — guarding those throws away the very
		// frames that define the note. The 2026-07-25 "root-frame" diagnostic
		// is the reference: the guard ate five of the six B♭ frames of a
		// stable-run segment, a McLeod C3 subharmonic glitch won the vote,
		// and the sandwich collapse then swallowed C–B♭–C into one long C.
		const guarded =
			i > 0 &&
			(amplitudeOnsets === null ||
				hasOnsetNear(amplitudeOnsets, segStart, ONSET_GUARD_MATCH_WINDOW));
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
	if (!haveAttackEvidence) return mergeWholeNoteOctaveUpLocks(sandwiched, readings);

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
	const octaveMerged = mergeOctaveBoundariesWithoutAttack(
		samePitchMerged,
		readings,
		workletOnsets ?? [],
		undefined,
		bleedOnsets
	);

	// Whole-note octave-up locks: a low note whose fundamental never surfaces as
	// its own segment reads an octave high across the entire note, so the
	// adjacent-segment merge above can't reach it. Drop it here on a strong
	// majority of octave-up-flagged frames.
	return mergeWholeNoteOctaveUpLocks(octaveMerged, readings);
}

/**
 * Match window for deciding whether a segment boundary IS an amplitude
 * onset (worklet or articulation). Boundaries inherit their exact float
 * values from those lists when amplitude-derived, so this only needs to
 * absorb resolveOnsets' dedup adjustments — deliberately much tighter than
 * SAME_PITCH_ATTACK_WINDOW, which asks the different question "is there an
 * attack anywhere NEAR this boundary".
 */
const ONSET_GUARD_MATCH_WINDOW = 0.02;

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
 * A note is a whole-note 2nd-harmonic lock when at least this fraction of its
 * confident (non-warmup) frames carry the octave-up flag. A genuine
 * mid-register note only trips the per-frame spectral test on its 1–2 attack
 * frames (broadband onset energy leaking into the odd-half bins), so its
 * flagged fraction stays well under half; a real lock carries the flag on
 * essentially every frame. 0.6 sits in the empty gap between the two.
 */
const OCTAVE_UP_LOCK_MIN_FRACTION = 0.6;
/**
 * Don't judge a lock on scant evidence — a note needs at least this many
 * confident frames before the flagged-fraction vote can drop it an octave.
 */
const OCTAVE_UP_LOCK_MIN_FRAMES = 3;

/**
 * Drop a whole note an octave when a strong majority of its frames are flagged
 * as a 2nd-harmonic (octave-up) lock (see `isOctaveUpLock` in pitch-frame.ts).
 *
 * This is the whole-note complement to `mergeOctaveBoundariesWithoutAttack`:
 * that pass needs a correctly-detected lower-octave segment ADJACENT to the
 * locked one to collapse toward, so it can't help when the ENTIRE note locks to
 * the 2nd harmonic and no fundamental segment ever forms — the failure mode of a
 * low note whose fundamental radiates almost nothing (the 2026-07-29 Sixth–Octave
 * Lift fixture: a concert E3 detected as E4 across all 93 frames).
 *
 * Deciding at the note level — rather than rewriting each frame in pitch-frame —
 * is what makes it safe: the per-frame test misfires on a note's attack
 * transient, but those blips are a small minority of a genuine note's frames and
 * never a majority, so the fraction gate ignores them. Cents is octave-invariant
 * (deviation from the nearest semitone), so it carries over unchanged.
 */
export function mergeWholeNoteOctaveUpLocks(
	notes: DetectedNote[],
	readings: PitchReading[]
): DetectedNote[] {
	if (notes.length === 0 || readings.length === 0) return notes;
	// Notes and readings are both time-sorted and notes don't overlap, so a
	// single moving read pointer keeps this O(n) rather than rescanning all
	// readings per note (tune-practice recordings run to thousands of frames).
	let ri = 0;
	return notes.map((note) => {
		const end = note.onsetTime + note.duration;
		while (ri < readings.length && readings[ri].time < note.onsetTime) ri++;
		let confident = 0;
		let flagged = 0;
		for (let k = ri; k < readings.length && readings[k].time < end; k++) {
			const r = readings[k];
			if (r.warmup) continue;
			confident++;
			// Only count a flag whose reported octave still MATCHES this note. An
			// earlier octave-collapse pass (mergeOctaveBoundariesWithoutAttack /
			// collapseSandwichArtifacts) may already have dropped a masked-fundamental
			// note to its true octave while its time range still holds the flagged
			// higher-octave frames; without this guard those stale flags would form a
			// majority and drop the already-correct note a SECOND octave (E3 → E2).
			if (r.octaveUp && r.midi === note.midi) flagged++;
		}
		if (confident < OCTAVE_UP_LOCK_MIN_FRAMES) return note;
		if (flagged / confident < OCTAVE_UP_LOCK_MIN_FRACTION) return note;
		return { ...note, midi: note.midi - 12 };
	});
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
 * Slow-bloom acceptance for the same short-gap tier. The step-up test above
 * compares the three frames straight after the hole (50 ms) against the three
 * before it, which assumes the re-attack is already at full level when pitch
 * tracking resumes. A reed attack BLOOMS: it takes 100–200 ms to pass the
 * level the previous note was dying at, so whenever the hole swallows the
 * whole attack transient the tier measures the wrong 50 ms and the note is
 * lost.
 *
 * Reference: the 2026-08-01 "flat-five-chromatic-down" fixture (concert Bb,
 * 105 BPM). The third note's attack lands under the metronome's DOWNBEAT KICK
 * — a MembraneSynth thump sweeping ~2 kHz → 33 Hz over 40 ms with a 200 ms
 * decay, an order of magnitude more disruptive than the ride clicks the
 * earlier fixtures cover — which blanks pitch tracking for 100 ms. On
 * resumption the new note reads 0.84× the pre-gap mean (step-up test: 0.89,
 * rejected) and only peaks at 1.20× it 170 ms later. Saved score 0.655 with
 * the third note MISSED.
 *
 * So the bloom path asks for the full V instead of an instantaneous step:
 *
 *   TROUGH  the hole ends BELOW where the note was (≤ 0.95× the pre-gap
 *           mean) — a stop, not a swell. This is what keeps a crescendo
 *           through a dropout from fabricating a note: a swell has no dip.
 *   RISE    the peak within BLOOM_WINDOW of resumption stands ≥ 1.25× above
 *           the resumption level — energy is climbing, i.e. something is
 *           being attacked rather than tracked back on.
 *   EXCEED  and that peak also clears the pre-gap mean by ≥ 1.10× — the
 *           climb overtakes the previous note rather than merely recovering
 *           to it.
 *
 * The counterexample the three gates are measured against is the kick-induced
 * 117 ms hole in the same day's "down-to-the-third" fixture, mid-way through a
 * genuinely held Db: trough 0.96 (passes), rise 1.03, exceed 0.99 — the note
 * never climbs, because there is no attack. Measured margins on the two
 * fixtures are 14% (rise) and 9% (exceed).
 *
 * This is an additional acceptance path, not a replacement: a sharp re-attack
 * that IS at full level on resumption still passes through the step-up test
 * above, which every fixture predating this one relies on.
 */
const RE_ARTICULATION_GAP_BLOOM_WINDOW = 0.2;
const RE_ARTICULATION_GAP_BLOOM_TROUGH = 0.95;
const RE_ARTICULATION_GAP_BLOOM_RISE = 1.25;
const RE_ARTICULATION_GAP_BLOOM_EXCEED = 1.1;

/**
 * Envelope-floor gate the clarity dip-and-recover pass applies when a reading
 * gap sits inside its span — see the block comment at that gate. A tongue stop
 * silences the horn, so the ~11.6 ms `rmsMin` floor collapses well under the
 * pre-gap floor; a click blanks tracking without touching the tone underneath,
 * so the floor barely moves. Measured across an identical 117 ms hole:
 * 2026-05-20 "blues-curl-up" (real tongue) 0.45, 2026-08-01
 * "down-to-the-third" (downbeat kick on a held Db) 0.82.
 */
const RE_ARTICULATION_GAP_SPAN_FLOOR = 0.6;

/** Instrument-band floor gate for `bandFloorDips` — see that function. */
const BAND_FLOOR_DIP_RATIO = 0.9;
const BAND_FLOOR_CONTEXT_FRAMES = 8;

/**
 * Gates for `bandFloorDips`' second acceptance shape: the tongue stop that
 * PRECEDES the spike. The in-span test above assumes the dip and the spike
 * coincide within window resolution (2026-08-01 "down-to-the-third": both on
 * the same frames). But the stop physically comes first — and when the attack
 * transient also blanks pitch tracking, the spike frames don't appear until
 * tracking resumes AFTER the re-attack, so the dip sits entirely in the
 * frames BEFORE the span. The in-span test then measures its baseline from
 * exactly the dipped frames and sees a floor that only ever RISES.
 *
 * Reference: 2026-08-11 "curl-to-the-floor" (concert G, 105 BPM, metronome).
 * Second of two tongued C4 eighths: band floor collapses 0.080 → 0.020
 * (0.25×) over the ~120 ms before the spike, the re-attack's tongue noise
 * spikes hfRms at the resumption frame, and the span floor recovers to 0.046
 * (2.3× the collapse). A click 219 ms earlier put the spike inside the
 * suppression window and the in-span test failed to rescue it, so the two
 * C4s merged and the second was scored MISSED.
 *
 * The stop gate reuses the 0.6 tongue-vs-click cut established for
 * RE_ARTICULATION_GAP_SPAN_FLOOR (real tongue stops measure ≤ 0.47 against
 * their pre-stop level, clicks on held notes ≥ 0.82 — and in the instrument
 * band a click contributes nothing at all). The recovery gates are what
 * exclude the one impostor the stop gate alone would admit — a note
 * DECAYING toward silence under a click: its floor keeps falling, so it
 * neither climbs back over the collapse (curl-to-the-floor measures 2.3×
 * against the 1.5 gate; a monotone decay sits ≤ ~1.0) nor back toward the
 * pre-stop sustain level (0.57× measured, against the 0.4 gate — this is
 * the gate a shallow stop-and-keep-falling shape can't fake, since ratios
 * off the collapse bottom say nothing about where the note ended up).
 *
 * All three are ratios, so at noise-floor levels they'd be satisfied by
 * measurement jitter alone — a bare ride measures ~0.004 in this band, and
 * jitter around that clears 0.6×/1.5× trivially. The absolute sustain
 * minimum is the ENV_MIN_LEVEL analog that keeps the shape anchored to a
 * note that was actually SOUNDING in-band before the stop: 0.02 sits 4×
 * over the ride/noise level and 4× under curl-to-the-floor's measured
 * 0.080 sustain. Below it the click keeps its suppression — the
 * conservative direction, and where a quiet-playing fixture would tune.
 */
const BAND_FLOOR_STOP_RATIO = 0.6;
const BAND_FLOOR_STOP_RECOVER = 1.5;
const BAND_FLOOR_STOP_RECOVER_TO_SUSTAIN = 0.4;
const BAND_FLOOR_STOP_MIN_SUSTAIN = 0.02;

/**
 * Energy-sustain floor for the bare-gap (≥ 150 ms) re-articulation tier.
 * The tier's premise — "a sustained reed note never loses pitch tracking
 * that long except at a tongue stop" — turned out to have a counterexample:
 * a metronome click landing on a DECAYING note wipes out McLeod clarity for
 * 150 ms+ (2026-07-25 "blue-step-down": click at 2.10 s on the fading final
 * C → 167 ms hole, post/pre RMS 0.67 and still falling), which fabricated a
 * re-articulation and split the held note. A real tongue stop ends in a
 * fresh attack, so energy is sustained across the hole: the 2026-05-22
 * curl-up fixtures (real ≥ 200 ms tongue stops) measure post/pre at 0.94
 * and 0.97. The floor sits at 0.85 — comfortably below every measured true
 * re-attack, comfortably above the decaying-note counterexample.
 */
const RE_ARTICULATION_GAP_SUSTAIN = 0.85;

/**
 * Broken-entry acceptance for the short-gap tier: the tongue that DAMPS the
 * reed before the hole. The step-up and bloom paths both read the energy
 * envelope, and a player who crescendos through the articulation defeats
 * both: the 2026-08-18 "blues-curl-up" fixture (concert D, 105 BPM, repeated
 * F4 tongued ON the beat) measures 1.12 across the hole — exactly the
 * mid-sustain-dropout ceiling the 1.2 step-up floor was cut against
 * (blue-note-climb's 1.883 s dropout: 1.120) — and its resumption level sits
 * ABOVE the pre-gap mean, so the bloom trough can never form. The energy
 * envelope is simply the wrong instrument for this articulation.
 *
 * What the tongue does leave is a waveform-shape collapse on the frames
 * BEFORE the hole, while pitch is still tracked: damping is progressive, so
 * shapeBreak falls to 0.06/0.17 across the last TWO stable readings (clarity
 * 0.88/0.84 — dipped but confident) before the stop+attack transient blanks
 * tracking. Both frames must be that deep:
 *
 *   DEPTH  every impulsive contaminant measured in the corpus that leaves a
 *          TRACKED reading sits at ≥ 0.33 (Blue Monk thump 0.33, root-frame
 *          click 0.54, pent-run click edge 0.69, blue-note-climb 0.75 s
 *          anomaly 0.37, curl-to-the-floor's post-collapse turbulence
 *          0.40–0.46) — a click or thump superimposes on an intact tone and
 *          only partially decorrelates it, while the tongue collapses the
 *          periodic waveform itself. The 0.25 ceiling sits between this
 *          fixture's 0.17 and the 0.41 turbulence impostor.
 *   TWO FRAMES  an impulse abrupt enough to blank tracking gets at most ONE
 *          tracked straddling window before the blank — down-to-the-third's
 *          downbeat kick measures −0.18 preceded by 0.99. The one measured
 *          contaminant with two deep tracked frames (the Blue Monk thump,
 *          0.07/0.08) sits behind a warmup-BRIDGED hole, which the tier's
 *          silence gate already rejects — this path lives strictly on the
 *          true-silence branch.
 *   SUSTAIN  energy must hold across the hole at the bare-gap tier's
 *          true-re-attack floor (RE_ARTICULATION_GAP_SUSTAIN, 0.85): a
 *          release flutter or decaying note that happens to break shape
 *          loses energy through its hole (corpus non-re-attacks with a deep
 *          pre-edge frame: 0.69–0.82).
 *
 * The scheduled-click schedule is deliberately NOT consulted: this take's
 * click arrives ~5 ms after the shape break (the player re-attacked on the
 * beat), and the suppression-window edge misses the break time by 1 ms —
 * evidence-order, not schedule geometry, is what separates the two here.
 */
const RE_ARTICULATION_BROKEN_ENTRY_SHAPE = 0.25;

/**
 * Energy floor the bare-gap tier demands instead when a scheduled click sits
 * INSIDE the hole — the note must have got louder across it, not merely held.
 *
 * `RE_ARTICULATION_GAP_SUSTAIN` separates a click-wiped sustain from a real
 * tongue stop by how much energy survives the hole, and the two populations it
 * was cut between are close: the decaying-note counterexample measured 0.67,
 * true re-attacks 0.94 and 0.97. The 2026-08-10 pent-run capture landed
 * between them at ~0.85 — a metronome click on a *held* (not decaying) G, so
 * the note neither faded enough to be vetoed nor stepped up like an attack.
 * It split the held G in two, and the phantom note restored the count to four,
 * which let DTW find a clean 1:1 diagonal one position off and turn a single
 * missed note into three wrong ones.
 *
 * Rather than squeeze the floor further into that gap, the click supplies an
 * orthogonal fact the ratio cannot: a click only ever ADDS energy and masks
 * tracking — it can never make the note louder. So when one lands in the hole,
 * demand the same genuine step-up the short-gap tier requires
 * (`RE_ARTICULATION_GAP_ATTACK_RISE`). A real tongue re-attack on the beat
 * still clears it; a masked sustain cannot.
 *
 * Blast radius, measured across the fixture corpus: exactly one recording has
 * a scheduled click inside a bare gap — the pent run this was written for.
 */
const RE_ARTICULATION_GAP_CLICK_RISE = RE_ARTICULATION_GAP_ATTACK_RISE;

/**
 * Allowance for a click that lands just before the last reading of a run.
 *
 * Readings are timestamped at the END of their analyser window
 * (`windowAnchor: 'end'`), so a click arriving slightly ahead of the final
 * clean reading is already inside that window and is still what wiped the
 * tracking that follows. One bleed-latency floor is enough to cover it.
 */
const GAP_CLICK_LEAD_ALLOWANCE = BLEED_LATENCY_MIN;

/** Whether a scheduled bleed event lands inside a reading hole. */
function hasBleedInsideGap(sortedBleed: number[], gapStart: number, gapEnd: number): boolean {
	const from = gapStart - GAP_CLICK_LEAD_ALLOWANCE;
	for (const t of sortedBleed) {
		if (t > gapEnd) return false;
		if (t >= from) return true;
	}
	return false;
}

/**
 * Suppression window for HF-tier candidates around a scheduled audible
 * event (metronome click). The recorder mixes the metronome into the
 * captured audio, and a click is a broadband burst that perturbs the
 * McLeod pitch estimate — at the reading level it is indistinguishable
 * from the softest legato tongue (hfRms spike + ~0.1 st fundamental
 * wobble + sustained energy; the 2026-07-25 "root-frame" click matches
 * every HF-tier gate). Scheduled click times are the one discriminator
 * the signal itself cannot fake. The window is asymmetric: each reading's
 * analysis window looks ~93 ms ahead (so readings BEFORE the click carry
 * its burst), and the click's own bleed/latency can land it up to ~200 ms
 * after its scheduled time.
 */
const HF_BLEED_SUPPRESS_BEFORE = 0.10;
const HF_BLEED_SUPPRESS_AFTER = 0.28;

/**
 * Envelope dip-recover re-articulation tier. A tongue stop interrupts the
 * airflow, dipping the raw envelope sharply (20–60 ms) before the re-attack
 * restores it. The window-level `rms` (~93 ms average) smooths these dips
 * out of existence — the 2026-07-25 "blue-note-step-up" tongue dips the raw
 * envelope 45% while window RMS moves only 17%, under every existing tier's
 * threshold. The per-reading `rmsMin` (min 128-sample-block RMS inside the
 * analysis window, added 2026-07-25) preserves the true dip floor, so this
 * pass detects: a same-MIDI run frame whose rmsMin falls below
 * ENV_DIP_RATIO × the trailing local RMS level, recovering to
 * ENV_RECOVER_RATIO × that level within a few frames.
 *
 * Two corroborators keep it specific — a bare amplitude dip also matches a
 * breath pulse or diaphragm wobble on a held note (the 2026-07-23 Blue Monk
 * held E contains a 42%/25 ms dip at ~4.0 s that must NOT split):
 *   - a broadband burst (hfRms ≥ ENV_HF_CORROBORATION × run median: tongue
 *     noise), OR
 *   - a fundamental perturbation ≥ ENV_PITCH_PERTURB semitones against the
 *     trailing local median (the reed resetting) — the 2026-07-25
 *     "blue-step-down" tongue is nearly silent in hfRms but wobbles the
 *     fundamental 0.12 st.
 * A metronome click can fabricate the perturbation but never the dip
 * (clicks ADD energy), so the pass is click-immune by construction.
 *
 * Dips that coincide with a reading gap ≥ READING_GAP_SPLIT_THRESHOLD are
 * left to the gap tiers (they own that evidence class; double-firing here
 * would bypass their warmup-bridge and sustain gates).
 */
const ENV_DIP_RATIO = 0.72;
const ENV_RECOVER_RATIO = 0.9;
const ENV_MAX_SPAN_FRAMES = 12;
const ENV_RECOVER_WINDOW = 0.2;
const ENV_LOCAL_FRAMES = 8;
const ENV_MIN_LEVEL = 0.03;
const ENV_HF_CORROBORATION = 2.0;
const ENV_PITCH_PERTURB = 0.08;

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

/**
 * Shape-corroborated "feather tongue" acceptance for the HF tier — the third
 * tongue signature, after the in-span band-floor dip (down-to-the-third) and
 * the pre-spike stop-and-recover (curl-to-the-floor): a doodle tongue so
 * light the airflow never falters. It leaves no band-floor dent for
 * `bandFloorDips` to find and may not wobble the fundamental at all, so both
 * the click-suppression rescue and the reed-reset corroborator reject it —
 * the 2026-08-13 repeated-Eb pair (slide-back-down / blue-note-roll-off)
 * merged on exactly those two gates (the first suppressed at 0.133 st
 * perturbation, the second's perturbation only 0.064 st).
 *
 * What it does leave is the shape tier's signature at a depth that tier's
 * SHAPE_MIN_PERIODICITY floor refuses: the reed is damped and restarts, so
 * cycle-to-cycle similarity dips SHALLOWLY and recovers, while the airflow
 * (rms, band floor) holds. The acceptance is a band, not a threshold,
 * because both neighbours are impostors — measured across every HF spike
 * span in the fixture corpus (2026-08-13):
 *
 *   metronome clicks (root-frame, step-up, blue-step-down)  null (tracking lost)
 *   thumps, octave flips, releases, hard tongue stops ....  0.30 – 0.65
 *   flat-five held-Eb wobble (must NOT split) ............  0.762
 *   blues-curl-down true tongue ..........................  0.804
 *   slide-back-down / blue-note-roll-off true tongues ....  0.848 / 0.877
 *   tied-E shallow flicker (must NOT split, 1 frame) .....  0.956
 *
 * A click is disqualified twice over: its burst destroys period tracking
 * (shapeBreak null on the spike frames — every measured click) or, when
 * tracking survives, drives similarity deep. Hence: every span frame must
 * carry a measurable shapeBreak, the minimum must land inside
 * [FLOOR, CEILING], the span must be ≥ MIN_FRAMES (single-frame residues —
 * pent-run attack tail 0.79, tied-E 0.956 — are categorically out), and the
 * run's own shape baseline must clear SHAPE_CLEAN_BASELINE (the shape
 * signal's precision precondition; breathy tones measure noise, not reeds).
 *
 * Energy floor for this path is RE_ARTICULATION_GAP_SUSTAIN (0.85), the
 * established true-re-attack vs decaying-note cut, not the perturbation
 * path's 0.9: slide-back-down measures 0.89 (the swung eighth decays a
 * little before the tap), and the decay impostors this floor exists for
 * measure ≤ 0.78 — all of them already outside the shape band anyway.
 */
const HF_SHAPE_TONGUE_FLOOR = 0.8;
const HF_SHAPE_TONGUE_CEILING = 0.92;
const HF_SHAPE_TONGUE_MIN_FRAMES = 2;

/** Whether the HF spike span [from, to) carries the feather-tongue shape signature. */
function feathersTongueShape(stable: PitchReading[], from: number, to: number): boolean {
	if (to - from < HF_SHAPE_TONGUE_MIN_FRAMES) return false;
	const runShapes: number[] = [];
	for (const r of stable) {
		if (r.shapeBreak != null) runShapes.push(r.shapeBreak);
	}
	if (runShapes.length === 0 || median(runShapes) < SHAPE_CLEAN_BASELINE) return false;
	let minShape = Infinity;
	for (let p = from; p < to; p++) {
		const s = stable[p].shapeBreak;
		if (s == null) return false;
		if (s < minShape) minShape = s;
	}
	return minShape >= HF_SHAPE_TONGUE_FLOOR && minShape <= HF_SHAPE_TONGUE_CEILING;
}

/**
 * Waveform-shape ("reed reset") re-articulation tier — the last resort, for a
 * legato tongue that leaves NO energy evidence whatsoever.
 *
 * Every tier above measures energy: a reading gap, an envelope dip, a
 * high-frequency burst. The 2026-07-30 "Climb to Five" G3 pair defeats all of
 * them because the player never interrupted the airflow. Across the second
 * attack the period-synchronous envelope does not dip at all — it is still
 * RISING (rms ×1.23) — brightness climbs smoothly over 130 ms instead of
 * spiking, and the tracker never drops a frame. What the ear hears is purely
 * timbral: the reed is damped and restarts, so the cycle-to-cycle waveform
 * shape breaks for a few milliseconds and then settles into a new, brighter
 * shape. `shapeBreak` (pitch-frame.ts) is the only reading-level signal that
 * sees it — here 0.981 → 0.957.
 *
 * Four gates make it specific. They are not independent knobs; each rejects a
 * distinct impostor that the others let through:
 *
 *   1. SHAPE_CLEAN_BASELINE — the run's own similarity floor must be high.
 *      This is a precision instrument: on a breathy or noisy tone (the
 *      "upper-neighbor-on-root" sustained C sits at 0.81, "sixth-octave-lift"
 *      at 0.91) its measurement noise is larger than the effect, so it must
 *      not be trusted there at all.
 *   2. SHAPE_MIN_DROP — the dip must stand clear of that floor.
 *   3. SHAPE_MIN_PERIODICITY — and it must NOT go deeper than this. The
 *      inversion is the crux: an impulsive contaminant (a metronome click, a
 *      key click, a thump) ADDS an uncorrelated signal and drives similarity
 *      towards zero, while a legato tongue only reshapes an oscillation that
 *      never stops, so it barely moves. Every false positive in the fixture
 *      corpus is DEEP — Blue Monk's held E at 4.50 s 0.33, the root-frame
 *      click 0.54, "third-fifth-rise" 0.86 — and both true legato tongues are
 *      shallow (0.957, 0.961). Anything that destroys periodicity is either
 *      contamination or a pitch instability, and belongs to another tier.
 *   4. SHAPE_SETTLE_TIME — the tone must have been sounding steadily for this
 *      long, measured from the run start AND from the most recent onset any
 *      other tier emitted. A note's own attack settles over 100–200 ms
 *      (Blue Monk's breathy G blooms until 1.39 s, 170 ms in) and reads as a
 *      shape break; so does the tail of a re-attack another tier already
 *      found ("blues-curl-down" 90 ms after its 0.481 s tongue).
 *
 * Plus energy sustain (SHAPE_MIN_SUSTAIN: a re-attack holds or adds energy —
 * a release does not) and the same scheduled-click suppression the HF tier
 * uses, as defence in depth.
 *
 * Tempo caveat, as for RE_ARTICULATION_READING_GAP: SHAPE_SETTLE_TIME is
 * physical, not beat-relative. It admits the swung-eighth pair this tier was
 * built for (0.34 s at 105 BPM) but not straight sixteenths at fast tempos.
 * That is the intended conservatism for a last-resort tier — a re-articulation
 * that fast will disturb the envelope enough for the tiers above to see it.
 */
const SHAPE_CLEAN_BASELINE = 0.975;
const SHAPE_MIN_DROP = 0.015;
const SHAPE_MIN_PERIODICITY = 0.9;
const SHAPE_SETTLE_TIME = 0.2;
const SHAPE_MIN_SUSTAIN = 1.0;
const SHAPE_EDGE_GUARD = 0.1;
const SHAPE_MIN_TRAILING_FRAMES = 2;

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
	baseOnsets: number[],
	bleedOnsets?: number[]
): number[] {
	if (readings.length === 0) return [];

	const sortedBleed =
		bleedOnsets && bleedOnsets.length > 0 ? [...bleedOnsets].sort((a, b) => a - b) : [];

	const sortedBase = [...baseOnsets].sort((a, b) => a - b);

	const onsets: number[] = [];
	const runs = findSameMidiRuns(readings);
	for (const run of runs) {
		// Pass the FULL reading stream so the gap pass can distinguish a true
		// detector silence from a warmup-bridged hole (findSameMidiRuns drops
		// warmup frames, which can manufacture a phantom gap inside a run).
		// `sortedBase` lets the shape pass treat an attack the baseline already
		// found inside this run as the start of a settle window.
		onsets.push(
			...findReArticulationsInSegment(
				run.readings,
				run.start,
				run.end,
				readings,
				sortedBleed,
				sortedBase
			)
		);
	}

	// Articulation onsets that coincide with an existing baseline onset (within
	// ATTACK_DEDUP_WINDOW) don't create a new boundary, but we keep them in the
	// output because the caller uses the list as attack evidence so the merge
	// pass keeps the split — duplicates are harmless once sorted.
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

/**
 * Does the INSTRUMENT-band envelope floor dip across `stable[from..to)`?
 *
 * This is the one question a scheduled click cannot answer for itself. A click
 * only ever ADDS energy, so it can raise the floor or leave it flat — it can
 * never pull it down. In the full band it can also FILL a dip in, which is how
 * a genuine tongue stop that lands on the beat disappears; `bandRmsMin`
 * (250–5000 Hz, see pitch-frame.ts) removes that masking because nothing the
 * metronome emits lives in that band.
 *
 * Measured across the corpus, floor against its own trailing median:
 *
 *   2026-07-25 root-frame, ride on a genuinely held G ......... 0.98  (flat)
 *   2026-08-01 down-to-the-third, Eb tongued on a ride ........ 0.82  (dip)
 *   2026-07-25 blue-note-step-up, soft tongue on a ride ....... 0.47
 *   2026-05-20 / 05-22 blues-curl-up, tongue .................. 0.42 / 0.45
 *
 * The gate sits at 0.90 — clear of the flat control, clear of every tongue.
 *
 * Scope note: this only ever runs on HF-tier spikes inside a click window, and
 * those are always CYMBAL clicks. The downbeat kick sweeps ~2 kHz → 33 Hz and
 * so does contaminate the instrument band, which would make this measurement
 * untrustworthy — but a kick cannot reach the HF tier in the first place:
 * measured against each run's own hfRms median, the corpus's kicks come in at
 * 0.95×–1.56×, nowhere near the 3× the tier requires. Rides, whose 8 kHz
 * noise burst is exactly what that tier keys on, are 25 dB down in this band.
 *
 * Returns false when the readings carry no `bandRmsMin` (pre-2026-08-01
 * diagnostic JSON), which preserves the unconditional suppression those
 * payloads were measured under.
 */
function bandFloorDips(stable: PitchReading[], from: number, to: number): boolean {
	const preStart = Math.max(0, from - BAND_FLOOR_CONTEXT_FRAMES);
	const pre: number[] = [];
	for (let i = preStart; i < from; i++) {
		const v = stable[i].bandRmsMin;
		if (v != null) pre.push(v);
	}
	if (pre.length === 0) return false;

	let spanFloor = Infinity;
	for (let i = from; i < to; i++) {
		const v = stable[i].bandRmsMin;
		if (v != null && v < spanFloor) spanFloor = v;
	}
	if (spanFloor === Infinity) return false;

	const baseline = median(pre);
	if (baseline > 0 && spanFloor < baseline * BAND_FLOOR_DIP_RATIO) return true;

	// Second shape: the stop PRECEDED the spike (see BAND_FLOOR_STOP_RATIO).
	// The dip lives in the pre-span frames, measured against the sustain
	// level before THEM; the span floor must climb back over the collapse,
	// which a decaying note under a click never does.
	const earlyStart = Math.max(0, preStart - BAND_FLOOR_CONTEXT_FRAMES);
	const early: number[] = [];
	for (let i = earlyStart; i < preStart; i++) {
		const v = stable[i].bandRmsMin;
		if (v != null) early.push(v);
	}
	if (early.length === 0) return false;

	const stopFloor = Math.min(...pre);
	const sustain = median(early);
	// The sustain-relative recovery gate also keeps the collapse-relative one
	// meaningful when the collapse bottomed out at or near zero — a ratio
	// against zero proves nothing on its own.
	return (
		sustain >= BAND_FLOOR_STOP_MIN_SUSTAIN &&
		stopFloor < sustain * BAND_FLOOR_STOP_RATIO &&
		spanFloor >= stopFloor * BAND_FLOOR_STOP_RECOVER &&
		spanFloor >= sustain * BAND_FLOOR_STOP_RECOVER_TO_SUSTAIN
	);
}

function findReArticulationsInSegment(
	readings: PitchReading[],
	segStart: number,
	segEnd: number,
	allReadings: PitchReading[],
	sortedBleed: number[] = [],
	sortedBaseOnsets: number[] = []
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
	// recovered). A bare gap ≥ RE_ARTICULATION_READING_GAP fires when energy
	// is sustained across the hole (a fresh attack — see
	// RE_ARTICULATION_GAP_SUSTAIN); a shorter gap (≥
	// READING_GAP_SPLIT_THRESHOLD, where the segmenter already splits) fires
	// only when the RMS clearly steps up across it, which marks a re-attack
	// and rules out a mid-sustain dropout. Anchor at the resumption of the
	// gap, minus the attack-latency adjustment used elsewhere.
	for (let g = 1; g < stable.length; g++) {
		const gap = stable[g].time - stable[g - 1].time;
		if (gap < READING_GAP_SPLIT_THRESHOLD) continue;
		if (gap >= RE_ARTICULATION_READING_GAP) {
			// Bare-gap tier: a ≥ 150 ms hole is a tongue stop ONLY when the
			// energy on the far side is consistent with a fresh attack. A
			// metronome click on a decaying note wipes tracking just as long,
			// but the note keeps fading — see RE_ARTICULATION_GAP_SUSTAIN.
			const preRms = meanRms(stable, g - RE_ARTICULATION_GAP_RMS_FRAMES, g);
			const postRms = meanRms(stable, g, g + RE_ARTICULATION_GAP_RMS_FRAMES);
			// When a click lands in the hole ITSELF the ratio can't settle it,
			// so demand a real step-up — see RE_ARTICULATION_GAP_CLICK_RISE.
			const energyFloor = hasBleedInsideGap(sortedBleed, stable[g - 1].time, stable[g].time)
				? RE_ARTICULATION_GAP_CLICK_RISE
				: RE_ARTICULATION_GAP_SUSTAIN;
			if (preRms <= 0 || postRms < preRms * energyFloor) {
				continue;
			}
		} else {
			// A genuine soft-tongue re-attack the worklet missed produces a
			// true detector silence — no frames of any kind across the hole.
			// If warmup frames bridge it, the gap is a stabilizer-reset
			// artifact (findSameMidiRuns skipped them, manufacturing a phantom
			// gap), not a missed attack, so the corroborated step-up tier must
			// not fire. (The ≥ 150 ms bare-gap tier above skips this silence
			// check: a long enough hole is meaningful even when the stabilizer
			// re-warms as the new note blooms — it requires energy sustain
			// across the hole instead.)
			if (hasReadingInOpenInterval(allReadings, stable[g - 1].time, stable[g].time)) {
				continue;
			}
			const preRms = meanRms(stable, g - RE_ARTICULATION_GAP_RMS_FRAMES, g);
			const postRms = meanRms(stable, g, g + RE_ARTICULATION_GAP_RMS_FRAMES);
			if (preRms <= 0) continue;
			const stepsUp = postRms >= preRms * RE_ARTICULATION_GAP_ATTACK_RISE;
			// Slow-bloom path: the attack transient fell inside the hole, so the
			// step-up window lands on a note still climbing. See the
			// RE_ARTICULATION_GAP_BLOOM_* block comment.
			let blooms = false;
			if (!stepsUp) {
				const resumeRms = stable[g].rms;
				let bloomMax = resumeRms;
				for (
					let k = g + 1;
					k < stable.length &&
					stable[k].time - stable[g].time <= RE_ARTICULATION_GAP_BLOOM_WINDOW;
					k++
				) {
					if (stable[k].rms > bloomMax) bloomMax = stable[k].rms;
				}
				blooms =
					resumeRms > 0 &&
					resumeRms <= preRms * RE_ARTICULATION_GAP_BLOOM_TROUGH &&
					bloomMax >= resumeRms * RE_ARTICULATION_GAP_BLOOM_RISE &&
					bloomMax >= preRms * RE_ARTICULATION_GAP_BLOOM_EXCEED;
			}
			// Broken-entry path: the reed was audibly damped on the way INTO the
			// hole — see the RE_ARTICULATION_BROKEN_ENTRY_SHAPE block comment.
			let brokenEntry = false;
			if (!stepsUp && !blooms && g >= 2) {
				const s1 = stable[g - 1].shapeBreak;
				const s2 = stable[g - 2].shapeBreak;
				brokenEntry =
					s1 != null &&
					s2 != null &&
					s1 <= RE_ARTICULATION_BROKEN_ENTRY_SHAPE &&
					s2 <= RE_ARTICULATION_BROKEN_ENTRY_SHAPE &&
					postRms >= preRms * RE_ARTICULATION_GAP_SUSTAIN;
			}
			if (!stepsUp && !blooms && !brokenEntry) continue;
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
				// A scheduled click's broadband burst clears every gate below —
				// hfRms spike, fundamental perturbation (the burst corrupts the
				// McLeod estimate by the same ~0.1 st a reed reset does), and
				// energy sustain — so the schedule is the only usable
				// discriminator. Discard spikes inside a click's contamination
				// window (see HF_BLEED_SUPPRESS_*). The 2026-07-25 "root-frame"
				// diagnostic is the reference: the click at 2.74 s on the held G
				// split it in two and dropped a clean take to "try-again".
				// Two rescues, for two tongue shapes a click cannot fake: a
				// band-floor dip (the stop silenced the horn — bandFloorDips)
				// and a shallow-banded shape break (the feather tongue that
				// never stops the air — feathersTongueShape).
				const shapeTongue = feathersTongueShape(stable, k, j);
				if (
					sortedBleed.length > 0 &&
					sortedBleed.some(
						(b) =>
							stable[k].time <= b + HF_BLEED_SUPPRESS_AFTER &&
							stable[j - 1].time >= b - HF_BLEED_SUPPRESS_BEFORE
					) &&
					!bandFloorDips(stable, k, j) &&
					!shapeTongue
				) {
					k = j;
					continue;
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
				// The shape-corroborated path accepts the RE_ARTICULATION_GAP_SUSTAIN
				// true-re-attack floor instead — see HF_SHAPE_TONGUE_FLOOR.
				const featherSustains =
					preRms > 0 && postRms >= preRms * RE_ARTICULATION_GAP_SUSTAIN;
				if (
					(maxPerturb >= HF_RE_ARTICULATION_MIN_PITCH_PERTURB && sustainsEnergy) ||
					(shapeTongue && featherSustains)
				) {
					const onsetTime = stable[peak].time - RE_ARTICULATION_ATTACK_LATENCY;
					if (onsetTime > segStart + RE_ARTICULATION_ONSET_GUARD) {
						onsets.push(onsetTime);
					}
				}
				k = j; // skip past this spike
			}
		}
	}

	// Envelope dip-recover pass (see the ENV_DIP_RATIO block comment). Uses
	// the per-reading rmsMin sub-window floor, so it only runs on readings
	// that carry it (2026-07-25+); older diagnostic JSON skips this pass.
	if (stable.some((r) => r.rmsMin != null)) {
		const runHf = median(stable.map((r) => r.hfRms ?? 0));
		let e = ENV_LOCAL_FRAMES;
		while (e < stable.length) {
			const local = median(
				stable.slice(Math.max(0, e - ENV_LOCAL_FRAMES), e).map((r) => r.rms)
			);
			if (local < ENV_MIN_LEVEL || (stable[e].rmsMin ?? Infinity) >= local * ENV_DIP_RATIO) {
				e++;
				continue;
			}
			// Span the contiguous dip evidence. Successive readings' analysis
			// windows overlap the same physical dip, so a 20–30 ms dip shows
			// up on several consecutive frames.
			let j = e;
			while (j < stable.length && (stable[j].rmsMin ?? Infinity) < local * ENV_DIP_RATIO) j++;

			// Reading gaps in or around the span belong to the gap tiers —
			// firing here too would bypass their warmup-bridge and energy
			// gates. A span much longer than the dip evidence a tongue stop
			// can produce is a fade or a bend, not an articulation.
			let hasGap = false;
			for (let k = Math.max(1, e - 1); k <= Math.min(stable.length - 1, j); k++) {
				if (stable[k].time - stable[k - 1].time >= READING_GAP_SPLIT_THRESHOLD) {
					hasGap = true;
					break;
				}
			}
			if (hasGap || j - e > ENV_MAX_SPAN_FRAMES) {
				e = j + 1;
				continue;
			}

			// Recovery: window-level RMS back near the pre-dip level shortly
			// after the span. A note fading out (or ending) never recovers.
			let recoveryIdx = -1;
			for (
				let k = j;
				k < stable.length && stable[k].time - stable[j - 1].time <= ENV_RECOVER_WINDOW;
				k++
			) {
				if (stable[k].rms >= local * ENV_RECOVER_RATIO) {
					recoveryIdx = k;
					break;
				}
			}
			if (recoveryIdx === -1) {
				e = j + 1;
				continue;
			}

			// Corroborator: tongue noise (hfRms burst over the run baseline)
			// or a reed reset (fundamental perturbation against the trailing
			// local median). A breath pulse on a held note has neither.
			let corroborated = false;
			if (runHf > 0) {
				for (let k = e; k < j && !corroborated; k++) {
					if ((stable[k].hfRms ?? 0) >= runHf * ENV_HF_CORROBORATION) corroborated = true;
				}
			}
			if (!corroborated) {
				const localMf = median(
					stable.slice(Math.max(0, e - ENV_LOCAL_FRAMES), e).map((r) => r.midiFloat)
				);
				for (let k = e; k < j && !corroborated; k++) {
					if (Math.abs(stable[k].midiFloat - localMf) >= ENV_PITCH_PERTURB) corroborated = true;
				}
			}
			if (!corroborated) {
				e = j + 1;
				continue;
			}

			const onsetTime = stable[recoveryIdx].time - RE_ARTICULATION_ATTACK_LATENCY;
			if (onsetTime > segStart + RE_ARTICULATION_ONSET_GUARD) {
				onsets.push(onsetTime);
			}
			e = recoveryIdx + 1;
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

		// Across a reading gap the clarity trigger is uninformative: tracking
		// was LOST, which says nothing about whether the tone stopped. Any
		// impulsive contaminant hands this pass a free trigger that way, and
		// the RMS dip it then pairs with may be up to PAIR_WINDOW (200 ms)
		// later — far enough to reach an unrelated trough. 2026-08-01
		// "down-to-the-third": the metronome's downbeat kick at 2.190 s blanks
		// 117 ms mid-way through a held Db whose envelope ripples ~4 Hz
		// throughout; the pass married the two into a phantom onset at 2.28
		// that split the note and slid DTW by one for the rest of the phrase.
		//
		// So when a gap sits in or around the span, fall back on the one piece
		// of evidence a click cannot fake: a click only ADDS energy, so the
		// note underneath keeps sounding, while a tongue stop drives the
		// short-window envelope FLOOR (`rmsMin`, ~11.6 ms) toward silence.
		// Measured against the pre-window floor: 2026-05-20 "blues-curl-up",
		// a real tongue stop behind an identical 117 ms hole, collapses to
		// 0.45; the down-to-the-third kick only reaches 0.82.
		//
		// Readings restored from pre-2026-07-25 diagnostic JSON carry no
		// `rmsMin`; those keep the historical behaviour rather than being
		// blocked on evidence they cannot supply.
		let spanHasGap = false;
		for (let k = Math.max(1, i - 1); k <= Math.min(stable.length - 1, rmsMinIdx); k++) {
			if (stable[k].time - stable[k - 1].time >= READING_GAP_SPLIT_THRESHOLD) {
				spanHasGap = true;
				break;
			}
		}
		if (spanHasGap) {
			const preFloors: number[] = [];
			for (let k = preStart; k < i; k++) {
				if (stable[k].rmsMin != null) preFloors.push(stable[k].rmsMin as number);
			}
			let spanFloor = Infinity;
			for (let k = i; k <= rmsMinIdx; k++) {
				const f = stable[k].rmsMin;
				if (f != null && f < spanFloor) spanFloor = f;
			}
			const preFloor = median(preFloors);
			if (
				preFloors.length > 0 &&
				spanFloor !== Infinity &&
				preFloor > 0 &&
				spanFloor > preFloor * RE_ARTICULATION_GAP_SPAN_FLOOR
			) {
				i = rmsMinIdx + 1;
				continue;
			}
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

	// Waveform-shape ("reed reset") pass — see the SHAPE_* block comment. Runs
	// LAST so its settle gate can see every onset the tiers above emitted for
	// this run: a shape break in the wake of an attack one of them already
	// found is that attack settling, not a second articulation. Gated on
	// `shapeBreak` being present, so readings restored from pre-2026-07-30
	// diagnostic JSON simply skip it.
	if (stable.some((r) => r.shapeBreak != null)) {
		const breakTime = (r: PitchReading): number => r.time + (r.shapeBreakAt ?? 0);
		// A reading whose analysis window straddles the run's start or end
		// measures the neighbouring note's transition, not this note — exclude
		// those from both the baseline and the candidates.
		//
		// The END exclusion counts READINGS, not seconds, because it must hold
		// under either window anchor. `breakTime` is a true audio time in both
		// paths, but `segStart`/reading times are not: replay stamps a window by
		// its start (so breakTime runs AHEAD of r.time) and the live path by its
		// end (so breakTime runs ~93 ms BEHIND). A `breakTime <= lastReadingTime`
		// test would therefore exclude nothing live, leaving the run's exit
		// transition a candidate on exactly the path the fixtures don't cover.
		// Reading index is anchor-free. The START gates below stay in seconds —
		// they are physical (an attack blooms for 100–200 ms regardless of frame
		// rate), and the anchor makes them STRICTER live, which is the safe
		// direction: at worst a re-articulation waits for the authoritative
		// rescore to be credited.
		const lastCandidate = stable.length - 1 - SHAPE_MIN_TRAILING_FRAMES;
		const interior = stable.filter(
			(r, k) =>
				r.shapeBreak != null &&
				breakTime(r) >= segStart + SHAPE_EDGE_GUARD &&
				k <= lastCandidate
		);
		const baseline = median(interior.map((r) => r.shapeBreak ?? 1));
		if (interior.length >= RE_ARTICULATION_PRE_CONTEXT_FRAMES && baseline >= SHAPE_CLEAN_BASELINE) {
			const settledAfter = [...onsets, ...sortedBaseOnsets].sort((a, b) => a - b);
			let c = 0;
			while (c < interior.length) {
				if ((interior[c].shapeBreak ?? 1) > baseline - SHAPE_MIN_DROP) {
					c++;
					continue;
				}
				// Successive readings' windows overlap the same physical break,
				// so span the contiguous evidence and judge its deepest frame.
				let end = c;
				let deepest = c;
				while (end < interior.length && (interior[end].shapeBreak ?? 1) <= baseline - SHAPE_MIN_DROP) {
					if ((interior[end].shapeBreak ?? 1) < (interior[deepest].shapeBreak ?? 1)) deepest = end;
					end++;
				}
				const candidate = interior[deepest];
				const t = breakTime(candidate);
				c = end;

				// Periodicity survived → a reed reset. Destroyed → impulsive
				// contamination or a pitch instability; not this tier's business.
				if ((candidate.shapeBreak ?? 1) < SHAPE_MIN_PERIODICITY) continue;

				// The tone must have been steady this long — since the run began
				// and since any attack the tiers above already found.
				if (t < segStart + SHAPE_SETTLE_TIME) continue;
				if (settledAfter.some((o) => o < t && t - o < SHAPE_SETTLE_TIME)) continue;

				// Enough same-MIDI readings must follow for this to be a
				// re-attack rather than the run's exit transition. Counted by
				// index for the anchor reason above; the `interior` filter
				// already enforces it, and this keeps the requirement explicit
				// at the point it is relied on.
				const idx = stable.indexOf(candidate);
				if (stable.length - 1 - idx < SHAPE_MIN_TRAILING_FRAMES) continue;

				// A re-attack holds or adds energy; a release loses it.
				const preRms = meanRms(stable, idx - RE_ARTICULATION_PRE_CONTEXT_FRAMES, idx);
				const postRms = meanRms(stable, idx + 2, idx + 2 + RE_ARTICULATION_PRE_CONTEXT_FRAMES);
				if (preRms <= 0 || postRms < preRms * SHAPE_MIN_SUSTAIN) continue;

				// A reading gap around the break is the gap tiers' evidence.
				if (
					idx > 0 &&
					(stable[idx].time - stable[idx - 1].time >= READING_GAP_SPLIT_THRESHOLD ||
						(idx + 1 < stable.length &&
							stable[idx + 1].time - stable[idx].time >= READING_GAP_SPLIT_THRESHOLD))
				) {
					continue;
				}

				// Defence in depth: a scheduled click is broadband contamination.
				// SHAPE_MIN_PERIODICITY already rejects every click measured in
				// the corpus, but the schedule is free and unambiguous.
				if (
					sortedBleed.some(
						(b) => t <= b + HF_BLEED_SUPPRESS_AFTER && t >= b - HF_BLEED_SUPPRESS_BEFORE
					)
				) {
					continue;
				}

				onsets.push(t);
			}
		}
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
