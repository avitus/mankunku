/**
 * Queryable backing track schedule. Two consumers:
 *
 * - The pitch-based bleed filter asks "what MIDI notes are active at
 *   Transport time T?" (`activeMidiAt`) to reject mic-captured backing
 *   audio from the detected notes.
 * - The note segmenter asks "when do backing transients land inside this
 *   recording window?" (`bleedEventsIn`) — the backing replaces the
 *   metronome as the audible time source once the synth click is count-in
 *   only, so its onsets (bass, comp AND drums) take over the click grid's
 *   role as computed — never logged — bleed evidence.
 *
 * Loop-aware: in loop mode the Tone.Parts replay one generated pass every
 * `loopTicks`, so queries wrap modulo the loop period. Without the wrap,
 * coverage silently ended after the first pass of a looped recording.
 */

export interface BackingScheduleNote {
	midi: number;
	/** Transport-relative start time in seconds */
	startSeconds: number;
	/** Duration in seconds */
	durationSeconds: number;
	source: 'bass' | 'comp';
}

export interface BackingTrackSchedule {
	notes: BackingScheduleNote[];
	/** Return MIDI numbers active at the given Transport time (within tolerance). */
	activeMidiAt(transportSeconds: number, tolerance?: number): number[];
	/**
	 * Every audible transient start (bass + comp + drums) of the first
	 * pass, absolute Transport seconds, sorted, deduped within 30 ms —
	 * a ride+kick+comp downbeat is one bleed event at the mic.
	 */
	transientOnsets: number[];
	/** Loop period in seconds when the parts loop, else null. */
	loopSeconds: number | null;
	/**
	 * Backing transient onsets inside a recording window, recording-relative
	 * seconds, loop-aware, with the same 250 ms pre-recording lookback the
	 * metronome grid used (speaker→mic propagation of a hit just before
	 * capture still lands inside the window).
	 */
	bleedEventsIn(recordingTransportSeconds: number, recordingDuration: number): number[];
}

interface BassEventLike {
	time: string;
	midi: number;
	duration: number;
}

interface CompEventLike {
	time: string;
	notes: number[];
	duration: number;
}

interface DrumEventLike {
	time: string;
}

/** Two hits inside this window read as one transient at the mic. */
const ONSET_DEDUPE_SECONDS = 0.03;

/** Mirror of getMetronomeBleedOnsets' pre-recording lookback. */
const PRE_RECORDING_LOOKBACK = 0.25;

/**
 * Build a queryable schedule from the generated events.
 *
 * @param bassEvents - Walking bass events with tick-based `time` strings (e.g. "480i")
 * @param compEvents - Comping events with tick-based `time` strings
 * @param drumEvents - Drum events (onset evidence only — unpitched, never in `notes`)
 * @param tickOffset - Count-in bar offset in ticks (events are shifted by this amount)
 * @param ppq - Pulses per quarter note (Transport.PPQ)
 * @param tempo - BPM
 * @param loopTicks - Loop period in ticks when the parts loop, else null
 */
export function buildSchedule(
	bassEvents: BassEventLike[],
	compEvents: CompEventLike[],
	drumEvents: DrumEventLike[],
	tickOffset: number,
	ppq: number,
	tempo: number,
	loopTicks: number | null = null
): BackingTrackSchedule {
	const secondsPerTick = 60 / (tempo * ppq);
	const offsetSeconds = tickOffset * secondsPerTick;
	const loopSeconds = loopTicks !== null && loopTicks > 0 ? loopTicks * secondsPerTick : null;
	const notes: BackingScheduleNote[] = [];

	for (const e of bassEvents) {
		const ticks = parseInt(e.time) + tickOffset;
		notes.push({
			midi: e.midi,
			startSeconds: ticks * secondsPerTick,
			durationSeconds: e.duration,
			source: 'bass'
		});
	}

	for (const e of compEvents) {
		const ticks = parseInt(e.time) + tickOffset;
		const startSeconds = ticks * secondsPerTick;
		for (const midi of e.notes) {
			notes.push({
				midi,
				startSeconds,
				durationSeconds: e.duration,
				source: 'comp'
			});
		}
	}

	notes.sort((a, b) => a.startSeconds - b.startSeconds);

	// All transient starts of the first pass, deduped: pitched events plus
	// every drum hit (a broadband stick attack is onset evidence regardless
	// of having no MIDI pitch to reject).
	const rawOnsets = [
		...notes.map((n) => n.startSeconds),
		...drumEvents.map((e) => (parseInt(e.time) + tickOffset) * secondsPerTick)
	].sort((a, b) => a - b);
	const transientOnsets: number[] = [];
	for (const t of rawOnsets) {
		const last = transientOnsets[transientOnsets.length - 1];
		if (last === undefined || t - last > ONSET_DEDUPE_SECONDS) transientOnsets.push(t);
	}

	/**
	 * Map an absolute Transport time onto the first generated pass. Times
	 * before the loop body started (count-in) pass through unchanged.
	 */
	function wrapToFirstPass(transportSeconds: number): number {
		if (loopSeconds === null || transportSeconds < offsetSeconds) return transportSeconds;
		return offsetSeconds + ((transportSeconds - offsetSeconds) % loopSeconds);
	}

	return {
		notes,
		transientOnsets,
		loopSeconds,
		activeMidiAt(transportSeconds: number, tolerance: number = 0.15): number[] {
			const wrapped = wrapToFirstPass(transportSeconds);
			// A note ringing across the loop seam (started near the end of the
			// previous pass) is caught by also probing one period later.
			const probes =
				loopSeconds !== null && wrapped !== transportSeconds
					? [wrapped, wrapped + loopSeconds]
					: [wrapped];
			const result: number[] = [];
			for (const probe of probes) {
				for (const n of notes) {
					const start = n.startSeconds - tolerance;
					const end = n.startSeconds + n.durationSeconds + tolerance;
					if (probe >= start && probe <= end) {
						result.push(n.midi);
					}
					// Early exit: notes are sorted, skip once past the window
					if (n.startSeconds > probe + tolerance) break;
				}
			}
			return [...new Set(result)];
		},
		bleedEventsIn(recordingTransportSeconds: number, recordingDuration: number): number[] {
			if (recordingDuration <= 0) return [];
			const windowStart = recordingTransportSeconds - PRE_RECORDING_LOOKBACK;
			const windowEnd = recordingTransportSeconds + recordingDuration;
			const out: number[] = [];

			if (loopSeconds === null) {
				for (const t of transientOnsets) {
					if (t > windowEnd) break;
					if (t >= windowStart) out.push(t - recordingTransportSeconds);
				}
				return out;
			}

			// Loop mode: onsets repeat every loopSeconds after offsetSeconds.
			// Walk whole passes overlapping the window.
			const relOnsets = transientOnsets
				.filter((t) => t >= offsetSeconds)
				.map((t) => t - offsetSeconds);
			const preLoop = transientOnsets.filter((t) => t < offsetSeconds);
			for (const t of preLoop) {
				if (t >= windowStart && t <= windowEnd) out.push(t - recordingTransportSeconds);
			}
			const firstPass = Math.max(0, Math.floor((windowStart - offsetSeconds) / loopSeconds));
			const lastPass = Math.max(0, Math.floor((windowEnd - offsetSeconds) / loopSeconds));
			for (let pass = firstPass; pass <= lastPass; pass++) {
				for (const rel of relOnsets) {
					const t = offsetSeconds + pass * loopSeconds + rel;
					if (t > windowEnd) break;
					if (t >= windowStart) out.push(t - recordingTransportSeconds);
				}
			}
			// Dedupe across loop seams: an onset just before loop end and one
			// just after the next pass's start can land within the same 30 ms
			// mic window even though each pass was deduped on its own.
			const deduped: number[] = [];
			for (const t of out) {
				const last = deduped[deduped.length - 1];
				if (last === undefined || t - last > ONSET_DEDUPE_SECONDS) deduped.push(t);
			}
			return deduped;
		}
	};
}
