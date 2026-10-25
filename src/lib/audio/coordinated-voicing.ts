import type { PitchClass, ChordQuality } from '$lib/types/music';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { PITCH_CLASSES } from '$lib/types/music';
import { rootlessVoicingA, rootlessVoicingB, shellVoicing, drop2Voicing, quartalVoicing, guideToneVoicing, type VoicingFn } from './voicings';

export type CoordinatedVoicingFamily = 'rootless-a' | 'rootless-b' | 'shell' | 'drop2' | 'quartal' | 'guide';
export interface CoordinatedVoicingMemory {
	readonly version: 1;
	readonly chord: { readonly root: PitchClass; readonly quality: ChordQuality };
	readonly notes: readonly number[];
}
export interface CoordinatedVoicingDecision {
	readonly requestedFamily: CoordinatedVoicingFamily;
	readonly resolvedFamily: CoordinatedVoicingFamily;
	readonly correction: 'none' | 'defining_tones' | 'family_unavailable';
	readonly guideMotion: number | null;
	readonly commonTones: readonly number[];
	readonly totalMovement: number;
	readonly registerDistance: number;
	readonly candidateCount: number;
}
const builders = { 'rootless-a': rootlessVoicingA, 'rootless-b': rootlessVoicingB, shell: shellVoicing, drop2: drop2Voicing, quartal: quartalVoicing, guide: guideToneVoicing };
/** Preserve the caller's existing seeded family choice without another draw. */
export function coordinatedVoicingFamily(builder: VoicingFn): CoordinatedVoicingFamily {
	const match = Object.entries(builders).find(([, candidate]) => candidate === builder);
	if (!match) throw new Error('Unknown coordinated voicing builder');
	return match[0] as CoordinatedVoicingFamily;
}
type Chord = { readonly root: PitchClass; readonly quality: ChordQuality };
const pc = (note: number) => ((note % 12) + 12) % 12;
const mean = (notes: readonly number[]) => notes.reduce((sum, note) => sum + note, 0) / notes.length;
function validChord(chord: Chord): boolean { return Boolean(chord && PITCH_CLASSES.includes(chord.root) && Object.hasOwn(CHORD_DEFINITIONS, chord.quality)); }
function definingIntervals(chord: Chord): [number, number] {
	const intervals = CHORD_DEFINITIONS[chord.quality].intervals;
	const third = intervals.includes(4) ? 4 : intervals.includes(3) ? 3 : intervals.includes(5) ? 5 : 2;
	const other = intervals.find((interval) => interval >= 9 && interval <= 11)
		?? intervals.find((interval) => interval >= 6 && interval <= 8) ?? 7;
	return [third, other];
}
function definingPcs(chord: Chord): [number, number] {
	const root = PITCH_CLASSES.indexOf(chord.root);
	return definingIntervals(chord).map((interval) => pc(root + interval)) as [number, number];
}
function pairChoices(notes: readonly number[], chord: Chord): number[][] {
	const [first, second] = definingPcs(chord);
	return notes.filter((note) => pc(note) === first).flatMap((a) => notes.filter((note) => pc(note) === second).map((b) => [a, b]));
}
function guideMovement(previous: CoordinatedVoicingMemory | undefined, chord: Chord, notes: readonly number[], family: CoordinatedVoicingFamily): number | null {
	if (!previous || family === 'quartal') return null;
	const from = pairChoices(previous.notes, previous.chord); const to = pairChoices(notes, chord);
	if (!from.length || !to.length) return null;
	return Math.min(...from.flatMap(([a, b]) => to.map(([c, d]) => Math.min(Math.abs(a - c) + Math.abs(b - d), Math.abs(a - d) + Math.abs(b - c)))));
}
/** Minimum ordered movement, allowing a voice to enter or leave at a fixed cost. */
function totalMovement(from: readonly number[], to: readonly number[]): number {
	const costs = Array.from({ length: from.length + 1 }, () => Array<number>(to.length + 1).fill(0));
	for (let a = 0; a <= from.length; a++) for (let b = 0; b <= to.length; b++) {
		costs[a][b] = a === 0 ? b * 12 : b === 0 ? a * 12 : Math.min(
			costs[a - 1][b - 1] + Math.abs(from[a - 1] - to[b - 1]), costs[a - 1][b] + 12, costs[a][b - 1] + 12);
	}
	return costs[from.length][to.length];
}
function uniqueCandidates(candidates: number[][], maxSpan: number): number[][] {
	const seen = new Set<string>();
	return candidates.map((notes) => [...notes].sort((a, b) => a - b)).filter((notes) => {
		if (notes.length < 2 || notes.some((note) => !Number.isInteger(note) || note < 48 || note > 84) ||
			new Set(notes).size !== notes.length || notes.at(-1)! - notes[0] > maxSpan) return false;
		const key = notes.join(','); if (seen.has(key)) return false; seen.add(key); return true;
	});
}
function placements(pcs: readonly number[], family: CoordinatedVoicingFamily): number[][] {
	if (family === 'drop2') {
		const ordered = [...pcs].sort((a, b) => a - b);
		const result: number[][] = [];
		for (let inversion = 0; inversion < ordered.length; inversion++) for (let octave = 3; octave <= 6; octave++) {
			const notes = ordered.map((_, index) => ordered[(inversion + index) % ordered.length] + 12 * octave + (inversion + index >= ordered.length ? 12 : 0));
			notes[notes.length - 2] -= 12;
			result.push(notes);
		}
		return uniqueCandidates(result, 24);
	}
	// At most four tones, each with at most four MIDI placements in 48..84:
	// 4^4 proposals before legality filtering, independent of tune length.
	let candidates: number[][] = [[]];
	for (const tone of pcs) {
		const options = Array.from({ length: 37 }, (_, index) => index + 48).filter((note) => pc(note) === tone);
		candidates = candidates.flatMap((prefix) => options.map((note) => [...prefix, note]));
	}
	return uniqueCandidates(candidates, family === 'guide' ? 12 : 19);
}

/**
 * Causal placement of a caller-selected family. The caller must commit the
 * returned memory only after emitting this chord; unplayed harmony is not input.
 * Ranking is defining-tone movement, exact common notes, total movement, then
 * register distance. Quartal shapes keep their native fourth-stack identity.
 */
export function resolveCoordinatedVoicing(input: {
	chord: { root: PitchClass; quality: ChordQuality };
	family: CoordinatedVoicingFamily; registerMidi: number; previous?: CoordinatedVoicingMemory;
}): { notes: readonly number[]; memory: CoordinatedVoicingMemory; decision: CoordinatedVoicingDecision } {
	if (!validChord(input.chord) || !Object.hasOwn(builders, input.family) || !Number.isFinite(input.registerMidi) || input.registerMidi < 0 || input.registerMidi > 127) throw new Error('Invalid coordinated voicing input');
	const previous = input.previous;
	if (previous && (previous.version !== 1 || !validChord(previous.chord) || !Array.isArray(previous.notes) || previous.notes.length < 2 || previous.notes.length > 8 ||
		previous.notes.some((note, index) => !Number.isInteger(note) || note < 0 || note > 127 || (index > 0 && previous.notes[index - 1] >= note)))) {
		throw new Error('Invalid coordinated voicing memory');
	}
	const chord = { root: input.chord.root, quality: input.chord.quality };
	const root = PITCH_CLASSES.indexOf(chord.root);
	const [third, other] = definingIntervals(chord);
	let family = input.family;
	let correction: CoordinatedVoicingDecision['correction'] = 'none';
	let base = builders[family](chord.root, chord.quality, 62);
	if (!base.length || (family === 'drop2' && !CHORD_DEFINITIONS[chord.quality].intervals.some((interval) => interval >= 9 && interval <= 11))) {
		family = rootlessVoicingA(chord.root, chord.quality, 62).length ? 'rootless-a' : 'shell';
		base = builders[family](chord.root, chord.quality, 62); correction = 'family_unavailable';
	}
	let pcs = base.map(pc);
	if (family === 'guide' || family === 'shell') {
		const correct = (family === 'shell' ? [0, third, other] : [third, other]).map((interval) => pc(root + interval));
		if (correct.some((tone) => !pcs.includes(tone))) correction = 'defining_tones';
		pcs = correct;
	} else if (family === 'drop2') {
		const intervals = CHORD_DEFINITIONS[chord.quality].intervals;
		const color = chord.quality === '7b9' ? 1 : chord.quality === '7#9' ? 3
			: intervals.includes(8) ? 8 : intervals.includes(6) ? 6 : 7;
		const correct = [0, third, color, other].map((interval) => pc(root + interval));
		if (correct.some((tone) => !pcs.includes(tone))) correction = 'defining_tones';
		pcs = correct;
	}
	const candidates = family === 'quartal'
		? uniqueCandidates(Array.from({ length: 37 }, (_, offset) => quartalVoicing(chord.root, chord.quality, 48 + offset)), 19)
		: placements(pcs, family);
	if (!candidates.length) throw new Error('No legal coordinated voicing placement');
	const target = Math.max(48, Math.min(84, input.registerMidi));
	const ranked = candidates.map((notes) => ({ notes, guideMotion: guideMovement(previous, chord, notes, family),
		commonTones: previous ? notes.filter((note) => previous.notes.includes(note)) : [],
		totalMovement: previous ? totalMovement(previous.notes, notes) : 0, registerDistance: Math.abs(mean(notes) - target) }));
	ranked.sort((a, b) => (a.guideMotion ?? 0) - (b.guideMotion ?? 0) || b.commonTones.length - a.commonTones.length ||
		a.totalMovement - b.totalMovement || a.registerDistance - b.registerDistance || a.notes.reduce((difference, note, index) => difference || note - b.notes[index], 0));
	const selected = ranked[0];
	const notes = Object.freeze([...selected.notes]);
	const memory = Object.freeze({ version: 1 as const, chord: Object.freeze(chord), notes });
	const decision = Object.freeze({ requestedFamily: input.family, resolvedFamily: family, correction,
		guideMotion: selected.guideMotion, commonTones: Object.freeze([...selected.commonTones]), totalMovement: selected.totalMovement,
		registerDistance: selected.registerDistance, candidateCount: candidates.length });
	return Object.freeze({ notes, memory, decision });
}
