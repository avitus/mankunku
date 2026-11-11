import type { DetectedNote } from '$lib/types/audio';
import type { PitchReading } from './pitch-frame';

export type BoundaryReason = 'brief pitch excursion' | 'unstable octave' | 'continuous tone' | 'sample discontinuity';

export interface BoundaryEvidence {
	notes: DetectedNote[];
	/** Cost of reading this attack as a continuation. Infinity protects it. */
	skipCosts: number[];
	reasons: (BoundaryReason | null)[];
}

export interface RecorderSignal {
	samples: Float32Array;
	sampleRate: number;
	/** Index time of the scheduled entrance, in seconds from sample zero. */
	anchorOffset: number;
}

/** A missing microphone packet can insert a short run of exact zeros. Only
 * identify a digital pause if both cut edges are loud and the waveform
 * resumes the value and slope it had immediately before the missing packet.
 * A fading release or a new attack fails that continuity check. */
function hasMissingPacket(samples: Float32Array, start: number, end: number, sampleRate: number) {
	for (let i = start; i < end; i++) {
		if (samples[i] !== 0) continue;
		const left = i;
		while (i < end && samples[i] === 0) i++;
		const length = i - left;
		if (length < 0.002 * sampleRate || length > 0.025 * sampleRate || i + 1 >= end) continue;
		const last = samples[left - 1];
		const first = samples[i];
		const level = Math.min(Math.abs(last), Math.abs(first));
		const slope = last - samples[left - 2];
		if (level > 0.015 && Math.abs(first - last - slope) < level * 0.04 &&
			Math.abs(samples[i + 1] - first - slope) < level * 0.08) return true;
	}
	return false;
}

/** A stream clock can splice two samples in a held note. The resulting click
 * disturbs pitch periodicity just like a tongue. Look for the two adjacent
 * curvature outliers of a waveform step, surrounded by a steady envelope.
 * Musical attacks and fades carry energy over many more samples. */
function hasSampleDiscontinuity(signal: RecorderSignal, onset: number): boolean {
	const { samples, sampleRate, anchorOffset } = signal;
	const center = Math.round((onset + anchorOffset) * sampleRate);
	const radius = Math.round(0.08 * sampleRate);
	const start = center - radius;
	const end = center + radius;
	if (start < 2 || end >= samples.length) return false;
	if (hasMissingPacket(samples, Math.max(2, start - Math.round(sampleRate * 0.025)), end, sampleRate)) return true;
	const curvature = (i: number) => Math.abs(samples[i] - 2 * samples[i - 1] + samples[i - 2]);
	let peak = start;
	for (let i = start + 1; i <= end; i++) {
		if (curvature(i) > curvature(peak)) peak = i;
	}
	const spike = curvature(peak);
	const block = Math.round(0.02 * sampleRate);
	if (spike < 0.01 || peak - 3 * block < 2 || peak + 3 * block >= samples.length) return false;
	let minPower = Infinity;
	let maxPower = 0;
	for (let j = -3; j < 3; j++) {
		let power = 0;
		for (let i = peak + j * block; i < peak + (j + 1) * block; i++) {
			if (Math.abs(i - peak) > 2 && curvature(i) * 16 > spike) return false;
			power += samples[i] ** 2;
		}
		minPower = Math.min(minPower, power);
		maxPower = Math.max(maxPower, power);
	}
	return minPower >= 0.85 * maxPower && spike >= 0.10 * Math.sqrt(maxPower / block);
}

/** Use pitch windows as independent evidence for the recorder's candidate notes.
 * The scoring segmenter keeps its own interpretation. Frame times here are
 * window ENDS, as supplied by live capture and the recorder's PCM replay. */
export function recorderBoundaries(input: DetectedNote[], readings: PitchReading[], tempo: number, signal?: RecorderSignal): BoundaryEvidence {
	const frames = readings.map(r => ({ r, t: r.time - (r.analysisWindowSeconds ?? 0.086) / 2 }));
	const beat = 60 / tempo;
	const notes = input.map(n => ({ ...n }));
	const skipCosts = input.map(() => Infinity);
	const reasons = input.map((): BoundaryReason | null => null);
	for (const [i, note] of input.entries()) {
		const prev = input[i - 1];
		const next = input[i + 1];
		const end = note.onsetTime + note.duration;
		const inside = frames.filter(f => f.t >= note.onsetTime && f.t < end);
		const matching = inside.filter(f => (f.r.midi - note.midi) % 12 === 0);
		// An early click or an onset on the previous pitch can lead the
		// instrument. Anchor to the first pitched window when the gap is
		// appreciable, allowing half a window for the physical attack.
		if (!prev || prev.midi % 12 !== note.midi % 12) {
			const left = Math.max(note.onsetTime - 0.14, prev ? (prev.onsetTime + note.onsetTime) / 2 : 0);
			const near = frames.filter(f => f.t >= left && f.t < Math.min(end, note.onsetTime + 0.22));
			const stable = near.find((f, j) => (f.r.midi - note.midi) % 12 === 0 &&
				j + 1 < near.length && (near[j + 1].r.midi - note.midi) % 12 === 0 &&
				near[j + 1].t - f.t < 0.04);
			if (stable && Math.abs(stable.t - note.onsetTime) >= 0.065 &&
				(!next || stable.t < (note.onsetTime + next.onsetTime) / 2)) {
				notes[i].onsetTime = stable.t;
				notes[i].duration = end - stable.t;
			}
		}
		// The last segment can extend to a much later click or file end.
		// A sustained note still has pitched energy near that end; a long
		// empty tail is silence, irrespective of the notation prior.
		if (matching.length >= 3) {
			const peak = Math.max(...matching.map(f => f.r.rms));
			const last = matching.filter(f => f.r.rms >= 0.10 * peak).at(-1);
			if (last && end - last.t > Math.max(0.30, beat * 0.70)) {
				notes[i].duration = Math.max(0.01, last.t + 0.025 - notes[i].onsetTime);
			}
		}
		if (prev && next && !note.ghost && note.duration < Math.min(0.23, beat * 0.34) &&
			inside.length >= 2 && matching.length <= 1) {
			// A short pitch excursion with almost no windows on that pitch can
			// explain a transition. A real short note with a stable pitch wins.
			skipCosts[i] = 0.015;
			reasons[i] = 'brief pitch excursion';
		}
		if (prev && next && !note.ghost && note.duration < Math.min(0.28, beat * 0.38) &&
			(Math.abs(prev.midi - note.midi) === 12 || Math.abs(next.midi - note.midi) === 12)) {
			const exact = inside.filter(f => f.r.midi === note.midi);
			const otherOctave = matching.length - exact.length;
			if ((otherOctave >= 2 && otherOctave > exact.length) ||
				(exact.length >= 2 && exact.at(-1)!.r.rms < 0.6 * exact[0].r.rms && note.clarity < 0.95)) {
				skipCosts[i] = 0.025;
				reasons[i] = 'unstable octave';
			}
		}
		if (note.ghost || !prev || prev.midi !== note.midi) continue;
		const near = frames.filter(f => Math.abs(f.t - note.onsetTime) <= 0.095);
		if (near.length < 6 || near.some((f, j) => j && f.t - near[j - 1].t > 0.038)) continue;
		// A tracked, continuously periodic tone through the boundary can be
		// one note. Never make a gap, tongue disturbance, or energy stop
		// optional solely because two adjacent notes share a pitch.
		if (signal && near.every(f => f.r.midi === note.midi) && hasSampleDiscontinuity(signal, note.onsetTime)) {
			// The exact sample discontinuity is positive evidence for a single
			// note, even when its click happens to land on a legal grid slot.
			skipCosts[i] = -0.12;
			reasons[i] = 'sample discontinuity';
			continue;
		}
		const floors = near.map(f => f.r.bandRmsMin);
		if (floors.some(v => v == null) || near.some(f =>
			(f.r.midi - note.midi) % 12 !== 0 || (f.r.shapeBreak ?? 0) < 0.90)) continue;
		const middle = near.filter(f => Math.abs(f.t - note.onsetTime) < 0.035);
		const before = near.filter(f => f.t < note.onsetTime - 0.035);
		const after = near.filter(f => f.t > note.onsetTime + 0.035);
		if (!middle.length || !before.length || !after.length) continue;
		// A bright transient followed by a persistently brighter tone is an
		// audible reed reset even if its envelope stays level.
		const brightness = (part: typeof frames) => {
			const values = part.flatMap(f => f.r.brightness == null ? [] : [f.r.brightness]);
			return values.reduce((a, b) => a + b, 0) / values.length;
		};
		if (near.some(f => (f.r.brightnessLift ?? 0) >= 4.25) && brightness(after) - brightness(before) >= 3.6) continue;
		const valley = Math.min(...middle.map(f => f.r.bandRmsMin!));
		const shoulders = Math.min(Math.max(...before.map(f => f.r.bandRmsMin!)),
			Math.max(...after.map(f => f.r.bandRmsMin!)));
		if (valley >= 0.70 * shoulders) {
			reasons[i] = 'continuous tone';
			skipCosts[i] = near.every(f => (f.r.shapeBreak ?? 0) >= 0.95) ? 0.015 : 0.045;
		}
	}
	return { notes, skipCosts, reasons };
}
