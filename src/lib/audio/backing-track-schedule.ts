/**
 * Queryable backing track schedule: answers "what MIDI notes are active
 * at Transport time T?" Used by the bleed filter to reject mic-captured
 * backing track audio from the detected notes.
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

/**
 * Build a queryable schedule from the generated bass and comp events.
 *
 * @param bassEvents - Walking bass events with tick-based `time` strings (e.g. "480i")
 * @param compEvents - Comping events with tick-based `time` strings
 * @param tickOffset - Count-in bar offset in ticks (events are shifted by this amount)
 * @param ppq - Pulses per quarter note (Transport.PPQ)
 * @param tempo - BPM
 */
export function buildSchedule(
	bassEvents: BassEventLike[],
	compEvents: CompEventLike[],
	tickOffset: number,
	ppq: number,
	tempo: number
): BackingTrackSchedule {
	const secondsPerTick = 60 / (tempo * ppq);
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

	return {
		notes,
		activeMidiAt(transportSeconds: number, tolerance: number = 0.15): number[] {
			const result: number[] = [];
			for (const n of notes) {
				const start = n.startSeconds - tolerance;
				const end = n.startSeconds + n.durationSeconds + tolerance;
				if (transportSeconds >= start && transportSeconds <= end) {
					result.push(n.midi);
				}
				// Early exit: notes are sorted, skip once past the window
				if (n.startSeconds > transportSeconds + tolerance) break;
			}
			return result;
		}
	};
}
