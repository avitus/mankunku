import type { TuningSample } from '$lib/scoring/tuning';

/**
 * Per-note tuning for one ear-training run, shown when the player pauses.
 *
 * Every note keeps its octave: on a horn the low D and the octave-key D are
 * different fingerings with different habits, and pooling them by pitch
 * class can turn two clusters into one median that describes neither. Only
 * notes actually played appear. Nothing here is persisted or scored.
 */

/** A note needs this many clean takes before its reading is a tendency. */
export const STEADY_TAKES = 3;
/** Within this many cents a note is in tune. */
export const IN_TUNE_CENTS = 5;
/** A note this far from the player's centre is worth naming. */
const STANDOUT_CENTS = 10;

export interface NoteTuning {
	/** Concert MIDI the note was played at. */
	midi: number;
	count: number;
	median: number;
	/** The middle half of the takes; null until the note is steady. */
	q1: number | null;
	q3: number | null;
	steady: boolean;
}

export interface TuningSummary {
	/** Notes played, low to high. */
	notes: NoteTuning[];
	/**
	 * Where the player's tuning sits as a whole: the median of the steady
	 * notes' medians, one vote per note so a much-played note can't drag it.
	 * Null until STEADY_TAKES notes are steady.
	 */
	centre: number | null;
}

/** Linear-interpolated quantile of an ascending list. */
function quantile(sorted: number[], q: number): number {
	const pos = (sorted.length - 1) * q;
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Group a run's clean notes by the exact note played (concert MIDI, so each
 * octave stands alone), low to high, and read each one's median and middle
 * half, plus the player's centre once enough notes are steady.
 */
export function summarizeTuning(samples: readonly TuningSample[]): TuningSummary {
	const byMidi = new Map<number, number[]>();
	for (const { midi, cents } of samples) {
		const list = byMidi.get(midi) ?? [];
		list.push(cents);
		byMidi.set(midi, list);
	}
	const notes = [...byMidi.entries()]
		.sort(([a], [b]) => a - b)
		.map(([midi, cents]): NoteTuning => {
			const sorted = [...cents].sort((a, b) => a - b);
			const steady = sorted.length >= STEADY_TAKES;
			return {
				midi,
				count: sorted.length,
				median: quantile(sorted, 0.5),
				q1: steady ? quantile(sorted, 0.25) : null,
				q3: steady ? quantile(sorted, 0.75) : null,
				steady
			};
		});
	const steadyMedians = notes.filter(n => n.steady).map(n => n.median).sort((a, b) => a - b);
	const centre = steadyMedians.length >= STEADY_TAKES ? quantile(steadyMedians, 0.5) : null;
	return { notes, centre };
}

/** What the player turns to move their whole tuning, by instrument id. */
const OVERALL_FIX: Record<string, string> = {
	'soprano-sax': 'a mouthpiece adjustment',
	'alto-sax': 'a mouthpiece adjustment',
	'tenor-sax': 'a mouthpiece adjustment',
	trumpet: 'a tuning-slide adjustment'
};

/**
 * One to two lines of plain advice under the faders: the overall offset
 * first (one adjustment fixes every note), then the note that stands out
 * against it (a note problem). `name` gives a concert MIDI's written name.
 */
export function tuningSummaryLines(
	summary: TuningSummary,
	instrumentId: string,
	name: (midi: number) => string
): string[] {
	const { centre } = summary;
	if (centre === null) {
		return summary.notes.some(n => n.steady)
			? ['A few more phrases will fill in the picture.']
			: [`Each note needs ${STEADY_TAKES} clean takes before it shows a tendency.`];
	}
	const lines: string[] = [];
	const cents = Math.round(Math.abs(centre));
	// The faders colour ±IN_TUNE_CENTS as in tune; the words agree.
	if (Math.abs(centre) > IN_TUNE_CENTS) {
		const fix = OVERALL_FIX[instrumentId] ?? 'an overall tuning adjustment';
		lines.push(`You're ${cents}¢ ${centre > 0 ? 'sharp' : 'flat'} overall. That's ${fix}, not a note problem.`);
	} else {
		lines.push(`Centred within ${Math.max(1, cents)}¢ of A = 440.`);
	}
	const steady = summary.notes.filter(n => n.steady);
	const worst = steady.reduce((a, b) => (Math.abs(b.median - centre) > Math.abs(a.median - centre) ? b : a));
	const off = worst.median - centre;
	if (Math.abs(off) >= STANDOUT_CENTS) {
		lines.push(`Against that, ${name(worst.midi)} sits ${Math.round(Math.abs(off))}¢ ${off > 0 ? 'high' : 'low'}.`);
	} else if (Math.abs(off) <= IN_TUNE_CENTS) {
		lines.push(`Every note sits within ${IN_TUNE_CENTS}¢ of the rest.`);
	}
	return lines;
}
