/** Joint pitch planning for a two-bar walk into an explicitly following chorus. */
import { createRng, seedFrom } from './generation-rng';

export type BassTurnaroundReason = 'planned' | 'short_chorus' | 'non_walking' | 'reserved_space'
	| 'response_reserved' | 'arrival_reserved' | 'missing_start_anchor' | 'missing_arrival_anchor'
	| 'unsupported_harmony' | 'no_entry' | 'variation_rest' | 'no_directional_path' | 'unsupported_meter';

/** The accepted notes are a score for realization, not a record of audio playback. */
export interface BassTurnaroundTrace {
	readonly startBar: number;
	readonly arrivalBar: number;
	readonly status: 'planned' | 'skipped';
	readonly reason: BassTurnaroundReason;
	readonly direction: 'ascending' | 'descending' | null;
	readonly targetMidi: number | null;
	readonly notes: readonly { readonly absBeat: number; readonly midi: number }[];
}

export interface BassTurnaroundBeat {
	readonly absBeat: number;
	readonly chordPcs: readonly number[];
	readonly scalePcs: readonly number[];
	readonly harmonicChange: boolean;
}

/** Restore immutable evidence after serialized cache recovery. */
export function freezeBassTurnaroundTrace(trace: readonly BassTurnaroundTrace[]): readonly BassTurnaroundTrace[] {
	for (const entry of trace) {
		for (const note of entry.notes) Object.freeze(note);
		Object.freeze(entry.notes);
		Object.freeze(entry);
	}
	return Object.freeze(trace);
}

/** An explicit opportunity that retained the ordinary walking line. */
export function skippedBassTurnaround(startBar: number, arrivalBar: number, reason: BassTurnaroundReason): BassTurnaroundTrace {
	return { startBar, arrivalBar, status: 'skipped', reason, direction: null, targetMidi: null, notes: [] };
}

type Path = { notes: number[]; cost: number; contrary: number };
const pc = (midi: number): number => (midi % 12 + 12) % 12;

/**
 * Search the complete path, retaining strong harmonic anchors. The opening
 * downbeat is fixed, so the preceding segment's approach still resolves to the
 * note it planned. The destination keeps its existing arc-planned root octave,
 * so the launch does not strand the next bar in an incompatible register.
 */
export function planBassTurnaround(input: {
	phraseId: string; tempo: number; startBar: number; arrivalBar: number;
	entryMidi: number; startMidi: number; targetMidi: number;
	beats: readonly BassTurnaroundBeat[];
}): BassTurnaroundTrace {
	const { phraseId, tempo, startBar, arrivalBar, entryMidi, startMidi, targetMidi, beats } = input;
	const skip = (reason: BassTurnaroundReason) => skippedBassTurnaround(startBar, arrivalBar, reason);
	if (Math.abs(startMidi - entryMidi) > 7 || startMidi === entryMidi) return skip('no_entry');
	if (beats.length !== 8 || arrivalBar !== startBar + 2 ||
		beats.some((beat, i) => beat.absBeat !== startBar * 4 + i)) return skip('unsupported_harmony');
	const rng = createRng(seedFrom(phraseId, tempo, 'bass-turnaround', arrivalBar));
	if (!rng.chance(0.7)) return skip('variation_rest');
	const direction = Math.sign(targetMidi - startMidi);
	const distance = Math.abs(targetMidi - startMidi);
	if (targetMidi < 28 || targetMidi > 55 || distance < 6 || distance > 14) return skip('no_directional_path');
	let states: Path[] = [{ notes: [startMidi], contrary: 0, cost: 0 }];
	for (let index = 1; index <= 8 && states.length; index++) {
		const next = new Map<string, Path>();
		for (const state of states) {
			const previous = state.notes.at(-1)!;
			for (let midi = index === 8 ? targetMidi : 28; midi <= (index === 8 ? targetMidi : 55); midi++) {
				const interval = midi - previous;
				if (!interval || Math.abs(interval) > (index === 8 ? 2 : 5)) continue;
				const contrary = state.contrary + Number(interval * direction < 0);
				if (contrary > 1) continue;
				if (index < 8) {
					const beat = beats[index];
					if (beat.harmonicChange || beat.absBeat % 2 === 0) {
						if (!beat.chordPcs.includes(pc(midi))) continue;
					} else if (!beat.scalePcs.includes(pc(midi)) && !(index === 7 && Math.abs(midi - targetMidi) === 1)) continue;
				}
				const ideal = startMidi + (targetMidi - startMidi) * index / 8;
				const leap = Math.abs(interval);
				const cost = state.cost + Math.abs(midi - ideal) * 0.5 + (leap <= 2 ? leap * 0.1 : leap - 2)
					+ (interval * direction < 0 ? 4 : 0);
				const key = `${midi}:${contrary}`;
				if (!next.has(key) || next.get(key)!.cost > cost) next.set(key, { notes: [...state.notes, midi], contrary, cost });
			}
		}
		states = [...next.values()];
	}
	const best = states.reduce<Path | undefined>((best, state) => !best || state.cost < best.cost ? state : best, undefined);
	if (!best) return skip('no_directional_path');
	return {
		startBar, arrivalBar, status: 'planned', reason: 'planned',
		direction: direction === 1 ? 'ascending' : 'descending', targetMidi,
		notes: best.notes.map((midi, index) => ({ absBeat: startBar * 4 + index, midi }))
	};
}
