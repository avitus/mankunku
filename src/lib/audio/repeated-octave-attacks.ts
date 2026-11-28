import { frequencyToMidi } from '$lib/music/intervals';
import { OCTAVE_CONFIRM_FRAMES, type PitchReading } from './pitch-frame';

// A tracking gap separates attacks. The segmenter also uses 75 ms for a gap
// and 150 ms as the minimum duration of a durable octave change.
const GAP_SECONDS = 0.075;
const MAX_ATTACK_SECONDS = 0.15;

function rawMidi(reading: PitchReading): number {
	return Math.round(frequencyToMidi(reading.frequency));
}

/** Both Climb to Five attacks have a masked fundamental. Their odd/even
 * ratios fall from 1.39 to 0.16 and 0.53 to 0.16 before the octave settles.
 * Require the ratio to halve, with independent raw picks in both octaves. */
function fadesIntoOctave(attack: PitchReading[], sustain: PitchReading[]): boolean {
	const first = attack[0];
	if (attack[attack.length - 1].time - first.time >= MAX_ATTACK_SECONDS) return false;

	const lower = attack.filter(r => rawMidi(r) === first.midi);
	if (lower.length < OCTAVE_CONFIRM_FRAMES || !attack.every(r =>
		rawMidi(r) === first.midi ? r.maskedOddRank !== undefined : rawMidi(r) === first.midi + 12)) return false;
	const initialRank = lower[0].maskedOddRank!;
	const finalRank = lower[lower.length - 1].maskedOddRank!;
	return finalRank < initialRank / 2 && sustain.length === OCTAVE_CONFIRM_FRAMES &&
		sustain.every(r => !r.warmup && rawMidi(r) === r.midi);
}

/**
 * A single masked fundamental could be a genuine low note. Two consecutive
 * attacks whose odd partials fade into the same upper octave corroborate
 * each other. Across 57 recordings only the flagged Climb to Five has both.
 */
export function resolveRepeatedOctaveAttacks(readings: PitchReading[]): PitchReading[] {
	if (!readings.some(r => r.maskedOddRank !== undefined)) return readings;
	const hasGapBefore = (i: number) => readings[i].time - readings[i - 1].time >= GAP_SECONDS;
	const starts = [0];
	for (let i = 1; i < readings.length; i++) {
		if (readings[i].midi !== readings[i - 1].midi || hasGapBefore(i)) starts.push(i);
	}
	starts.push(readings.length);

	let result = readings;
	let previous: { start: number; sustainEnd: number } | undefined;
	for (let run = 0; run + 2 < starts.length; run++) {
		const start = starts[run];
		const end = starts[run + 1];
		const sustainEnd = starts[run + 2];
		const lower = readings[start].midi;
		if (hasGapBefore(end) || readings[end].midi !== lower + 12) continue;
		const sustain = readings.slice(end, Math.min(sustainEnd, end + OCTAVE_CONFIRM_FRAMES));
		if (!fadesIntoOctave(readings.slice(start, end), sustain)) continue;
		if (previous?.sustainEnd === start && !hasGapBefore(start) && readings[previous.start].midi === lower) {
			if (result === readings) result = readings.slice();
			for (let i = previous.start; i < end; i++) {
				const r = readings[i];
				if (r.midi !== lower) continue;
				const lifted = { ...r, midi: lower + 12, midiFloat: r.midiFloat + 12 };
				// Timbre and lock flags describe the originally reported register.
				delete lifted.brightness;
				delete lifted.brightnessLift;
				delete lifted.brightnessLiftAt;
				delete lifted.octaveUp;
				delete lifted.twelfthUp;
				if (rawMidi(r) !== lifted.midi) {
					delete lifted.shapeBreak;
					delete lifted.shapeBreakAt;
				}
				result[i] = lifted;
			}
		}
		previous = { start, sustainEnd };
	}
	return result;
}
