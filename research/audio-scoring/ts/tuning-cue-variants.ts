/**
 * Research-only copy of `createTuningMonitor` with hysteresis knobs, so the
 * cue's on/off rule can be measured over production runs before one ships.
 * `{ enter: 12, hold: 12, carryShort: false }` is the 2026-10-10 rule;
 * `{ enter: 12, hold: 8, carryShort: true }` is the app's rule since
 * 2026-10-20, asserted take for take in tuning-cue.test.ts.
 */
import { cleanTuningSamples } from '$lib/scoring/tuning';
import type { NoteResult } from '$lib/types/scoring';

export interface CueVariant {
	label: string;
	/** Window centre the cue turns ON at. */
	enter: number;
	/** Window centre the cue stays on at once it is on. */
	hold: number;
	/** Keep the previous verdict through a take with fewer than 2 clean notes. */
	carryShort: boolean;
	/** While on, the latest take need only lean this far (0 = merely not the other way). Default LEAN_CENTS. */
	latestHold?: number;
}

interface PcSample { pitchClass: number; cents: number }

const WINDOW_TAKES = 5, MIN_TAKES = 3, MIN_NOTES_PER_TAKE = 2, MIN_PITCH_CLASSES = 3;
const LEAN_CENTS = 5, MIN_AGREEMENT = 0.8, MAX_MEDIAN_SPREAD = 10;

function median(values: number[]): number {
	const s = [...values].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const takeLean = (t: PcSample[]): number => (t.length >= MIN_NOTES_PER_TAKE ? median(t.map(s => s.cents)) : 0);

export function createVariantMonitor(v: CueVariant): { record: (notes: NoteResult[]) => number | null; windowCentre: () => number | null; reason: () => string } {
	let takes: PcSample[][] = [];
	let on: number | null = null;
	let lastCentre: number | null = null;
	let lastReason = '';
	function verdict(current: PcSample[]): number | null {
		lastCentre = null;
		lastReason = 'on';
		const latest = takeLean(current);
		if (current.length < MIN_NOTES_PER_TAKE) { lastReason = 'short take'; return null; }
		const latestGate = on !== null ? (v.latestHold ?? LEAN_CENTS) : LEAN_CENTS;
		const sign = on !== null && latestGate < LEAN_CENTS ? Math.sign(on) : Math.sign(latest);
		if (latest * sign < latestGate || latest === 0) { lastReason = 'latest lean'; return null; }
		const reliable = takes.filter(t => t.length >= MIN_NOTES_PER_TAKE);
		if (reliable.length < MIN_TAKES) { lastReason = 'too few takes'; return null; }
		if (reliable.filter(t => takeLean(t) * sign >= LEAN_CENTS).length * 2 <= reliable.length) { lastReason = 'take majority'; return null; }
		const byPc = new Map<number, number[]>();
		for (const s of reliable.flat()) byPc.set(s.pitchClass, [...(byPc.get(s.pitchClass) ?? []), s.cents]);
		if (byPc.size < MIN_PITCH_CLASSES) { lastReason = 'pitch classes'; return null; }
		const meds = [...byPc.values()].map(median);
		const centre = median(meds);
		lastCentre = centre;
		const gate = on !== null && Math.sign(on) === Math.sign(centre) ? v.hold : v.enter;
		if (Math.abs(centre) < gate) { lastReason = 'centre'; return null; }
		const s = Math.sign(centre);
		const agreement = meds.filter(c => c * s >= LEAN_CENTS).length / meds.length;
		const spread = median(meds.map(c => Math.abs(c - centre)));
		if (agreement < MIN_AGREEMENT) { lastReason = 'class agreement'; return null; }
		if (spread > MAX_MEDIAN_SPREAD) { lastReason = 'spread'; return null; }
		if (s !== sign) { lastReason = 'sign'; return null; }
		return centre;
	}
	return {
		record(notes) {
			const current = cleanTuningSamples(notes).map(({ midi, cents }) => ({ pitchClass: ((midi % 12) + 12) % 12, cents }));
			takes = [...takes, current].slice(-WINDOW_TAKES);
			if (v.carryShort && current.length < MIN_NOTES_PER_TAKE) return on;
			on = verdict(current);
			return on;
		},
		windowCentre: () => lastCentre,
		reason: () => lastReason
	};
}
