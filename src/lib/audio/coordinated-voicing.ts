import type { PhraseDialogue } from './backing-phrase-dialogue';
import type { EnsembleColor } from './backing-ensemble-colors';
import type { PhraseColor } from './backing-phrase-colors';
import type { TrioConversation } from './backing-trio-conversation';
import type { KeyboardLineRequest } from './backing-keyboard-line';
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
 readonly fourthStack?: Extract<PhraseDialogue,{kind:'fourth-stack'}>;
 readonly spreadVoicing?: Extract<EnsembleColor,{kind:'drop3'}>;
 readonly upperStructure?: Extract<PhraseColor,{kind:'upper-structure'}>;
	readonly keyboardColor?: Extract<TrioConversation, {kind: 'dominant-b9'}>;
	readonly keyboardSuspension?: {
		/** Absent on the original 0.9 fourth-to-third cell. */
		readonly kind?: '9-1' | '13-5';
		readonly chordRoot?: PitchClass;
		readonly phase: 'suspension' | 'resolution';
		readonly fromMidi: number; readonly toMidi: number;
		readonly suspensionAbsBeat: number; readonly resolutionAbsBeat: number;
	};
	readonly keyboardContraryMotion?: {
		readonly status: 'changed' | 'retained' | 'unavailable' | 'family_ineligible';
		readonly previousNotes: readonly number[]; readonly ordinaryNotes: readonly number[]; readonly actualNotes: readonly number[];
		readonly topFromMidi: number | null; readonly topToMidi: number;
		readonly voiceIndex?: number; readonly fromMidi?: number; readonly toMidi?: number;
		readonly guideDetour: number; readonly movementDetour: number;
	};
	readonly keyboardArticulation?: { readonly instrument: 'piano' | 'organ'; readonly profile: string; readonly durationBeats: number; readonly durationSeconds: number; readonly originalDurationBeats: number };
	readonly keyboardLine?: {
		readonly status: 'connected' | 'retained' | 'bounded_fallback' | 'family_ineligible';
		readonly contour: KeyboardLineRequest['contour']; readonly targetMidi: number; readonly anchorMidi: number;
		readonly actualMidi: number; readonly ordinaryMidi: number; readonly distance: number; readonly ordinaryDistance: number;
		readonly guideDetour: number; readonly movementDetour: number; readonly maxTopLeap: number;
	};
	readonly requestedFamily: CoordinatedVoicingFamily;
	readonly resolvedFamily: CoordinatedVoicingFamily;
	readonly correction: 'none' | 'defining_tones' | 'family_unavailable';
	readonly guideMotion: number | null;
	readonly commonTones: readonly number[];
	readonly totalMovement: number;
	readonly registerDistance: number;
	readonly candidateCount: number;
	/** A tie-breaking phrase objective, not a claim that the target was reached. */
	readonly topLine?: { readonly targetMidi: number; readonly actualMidi: number; readonly distance: number; readonly eligible: boolean };
	/** The phrase request; spacing and rootlessTexture below report actual realization. */
	readonly keyboardTexture?: { readonly profile: 'light' | 'compact' | 'open'; readonly phraseStartBar: number; readonly source: 'phrase' | 'answer' };
	readonly spacing?: { readonly request: 'compact' | 'open'; readonly applied: 'compact' | 'open' | 'unchanged'; readonly reason: 'applied' | 'voice_leading' | 'family_ineligible' | 'unavailable'; readonly spanSemitones: number };
	/** 'full' retains the selected family; it does not imply four notes. */
	readonly rootlessTexture?: {
		readonly request: 'two' | 'three' | 'full';
		readonly applied: 'two' | 'three' | 'full';
		readonly eligible: boolean;
		readonly noteCount: number;
	};
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

/** Reassess an authored complete cell against what it actually sounds. */
export function describeCoordinatedPlacement(chord: Chord, notes: readonly number[], family: CoordinatedVoicingFamily,
	registerMidi: number, previous?: CoordinatedVoicingMemory) {
	return { guideMotion: guideMovement(previous, chord, notes, family),
		commonTones: Object.freeze(previous ? notes.filter(note => previous.notes.includes(note)) : []),
		totalMovement: previous ? totalMovement(previous.notes, notes) : 0,
		registerDistance: Math.abs(mean(notes) - Math.max(48, Math.min(84, registerMidi))) };
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

interface VoicingGeometry {
	readonly family: CoordinatedVoicingFamily;
	readonly correction: CoordinatedVoicingDecision['correction'];
	readonly textureEligible: boolean;
	readonly three: boolean;
	readonly two: boolean;
	readonly pcs: readonly number[];
	readonly candidates: readonly (readonly number[])[];
}
// Geometry depends only on chord/family/texture, never on accepted history, register
// or melodic preferences. Bound retention for long sessions traversing many keys.
const GEOMETRY_CACHE_LIMIT = 256;
const geometryCache = new Map<string, VoicingGeometry>();
function canReduceRootlessGeometry(chord: Chord, family: CoordinatedVoicingFamily): boolean {
	return (family === 'rootless-a' || family === 'rootless-b') && ['maj7', 'min7', '7'].includes(chord.quality);
}

/**
 * Prepare only legal pitch geometry from the known chart before playback. All
 * six families remain available to each style's own selection policy; neither
 * family selection nor history/register/line ranking happens here. Only plain
 * rootless sevenths need separate two/three/full geometry.
 *
 * Limit the warm set to complete chords fitting the existing cache. A larger
 * chart keeps ordinary lazy resolution beyond that prefix rather than spending
 * setup time enumerating geometry this same preparation would immediately evict.
 */
export function prepareCoordinatedVoicings(chords: readonly Chord[]): void {
	const unique = new Set<string>();
	const prepared: Chord[] = [];
	let entries = 0;
	let full = false;
	for (const chord of chords) {
		if (!validChord(chord)) throw new Error('Invalid coordinated preparation chord');
		const key = `${chord.root}:${chord.quality}`;
		if (full || unique.has(key)) continue;
		const cost = canReduceRootlessGeometry(chord, 'rootless-a') ? 10 : 6;
		if (entries + cost > GEOMETRY_CACHE_LIMIT) { full = true; continue; }
		unique.add(key); entries += cost; prepared.push(chord);
	}
	for (const chord of prepared) for (const family of Object.keys(builders) as CoordinatedVoicingFamily[]) {
		voicingGeometry(chord, family, 'full');
		if (canReduceRootlessGeometry(chord, family)) {
			voicingGeometry(chord, family, 'two');
			voicingGeometry(chord, family, 'three');
		}
	}
}

function voicingGeometry(chord: Chord, requestedFamily: CoordinatedVoicingFamily,
	texture: 'two' | 'three' | 'full' | undefined): VoicingGeometry {
	// Ineligible texture requests resolve to the full family already. Reuse that
	// same geometry instead of allocating duplicate cache entries for each label.
	const geometryTexture = canReduceRootlessGeometry(chord, requestedFamily) ? texture ?? 'full' : 'full';
	const key = `${chord.root}:${chord.quality}:${requestedFamily}:${geometryTexture}`;
	const cached = geometryCache.get(key);
	if (cached) {
		geometryCache.delete(key); geometryCache.set(key, cached);
		return cached;
	}
	const root = PITCH_CLASSES.indexOf(chord.root);
	const [third, other] = definingIntervals(chord);
	let family = requestedFamily;
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
	const textureEligible = canReduceRootlessGeometry(chord, requestedFamily) && family === requestedFamily;
	const three = texture === 'three' && textureEligible;
	const two = texture === 'two' && textureEligible;
	if (two) {
		// Spec P19: keep the third and seventh of the accepted harmony.
		// Reduce the selected family's pitch set before placement, not its output.
		pcs = [third, other].map((interval) => pc(root + interval));
	} else if (three) {
		// Spec P20: select defining tones plus one color before placement:
		// 9, or 13 for a dominant B shape. Do not truncate placed notes.
		const color = family === 'rootless-b' && chord.quality === '7' ? 9 : 2;
		pcs = [third, other, color].map((interval) => pc(root + interval));
	}
	const candidates = family === 'quartal'
		? uniqueCandidates(Array.from({ length: 37 }, (_, offset) => quartalVoicing(chord.root, chord.quality, 48 + offset)), 19)
		: placements(pcs, family);
	if (!candidates.length) throw new Error('No legal coordinated voicing placement');
	const geometry = Object.freeze({ family, correction, textureEligible, three, two,
		pcs: Object.freeze(pcs), candidates: Object.freeze(candidates.map(notes => Object.freeze(notes))) });
	if (geometryCache.size >= GEOMETRY_CACHE_LIMIT) geometryCache.delete(geometryCache.keys().next().value!);
	geometryCache.set(key, geometry);
	return geometry;
}

/**
 * Causal placement of a caller-selected family. The caller must commit the
 * returned memory only after emitting this chord; unplayed harmony is not input.
 * Ranking is defining-tone movement, exact common notes, total movement, optional
 * top-note target distance, then register distance. Quartal shapes keep their
 * native fourth-stack identity. The optional keyboard line can improve the upper
 * connection before those tie-breaks, within its bounded movement detour.
 */
export function resolveCoordinatedVoicing(input: {
	chord: { root: PitchClass; quality: ChordQuality };
	family: CoordinatedVoicingFamily; registerMidi: number; previous?: CoordinatedVoicingMemory;
	rootlessTexture?: 'two' | 'three' | 'full';
	targetTopMidi?: number;
	/** Optional admission of a compact or open rootless placement before ordinary voice-leading ranking. */
	spacing?: 'compact' | 'open';
	/** A melodic preference admitted only within the current spacing and explicit motion bounds. */
	keyboardLine?: KeyboardLineRequest;
	/** Seek bounded opposite inner motion; prefer the selected upper note, never worsen the line target. */
	keyboardContraryMotion?: true;
}): { notes: readonly number[]; memory: CoordinatedVoicingMemory; decision: CoordinatedVoicingDecision } {
	if (!validChord(input.chord) || !Object.hasOwn(builders, input.family) || !Number.isFinite(input.registerMidi) || input.registerMidi < 0 || input.registerMidi > 127 ||
		(input.spacing !== undefined && !['compact', 'open'].includes(input.spacing)) ||
		(input.rootlessTexture !== undefined && !['two', 'three', 'full'].includes(input.rootlessTexture)) ||
		(input.targetTopMidi !== undefined && (!Number.isInteger(input.targetTopMidi) || input.targetTopMidi < 48 || input.targetTopMidi > 84))) throw new Error('Invalid coordinated voicing input');
	const previous = input.previous;
	if (previous && (previous.version !== 1 || !validChord(previous.chord) || !Array.isArray(previous.notes) || previous.notes.length < 2 || previous.notes.length > 8 ||
		previous.notes.some((note, index) => !Number.isInteger(note) || note < 0 || note > 127 || (index > 0 && previous.notes[index - 1] >= note)))) {
		throw new Error('Invalid coordinated voicing memory');
	}
	const line = input.keyboardLine;
	if (line && (!previous || line.anchorMidi !== previous.notes.at(-1) || !Number.isInteger(line.targetMidi) || line.targetMidi < 48 || line.targetMidi > 84 ||
		line.maxGuideDetour !== 2 || line.maxMovementDetour !== 4 || ![3,4,5].includes(line.maxTopLeap))) throw new Error('Invalid keyboard line request');
	const chord = { root: input.chord.root, quality: input.chord.quality };
	const { family, correction, textureEligible, three, two, pcs, candidates } = voicingGeometry(chord, input.family, input.rootlessTexture);
	const target = Math.max(48, Math.min(84, input.registerMidi));
	let ranked = candidates.map((notes) => ({ notes, guideMotion: guideMovement(previous, chord, notes, family),
		commonTones: previous ? notes.filter((note) => previous.notes.includes(note)) : [],
		totalMovement: previous ? totalMovement(previous.notes, notes) : 0, registerDistance: Math.abs(mean(notes) - target) }));
	let spacingReason: NonNullable<CoordinatedVoicingDecision['spacing']>['reason'] = 'family_ineligible';
	let spacingApplied: NonNullable<CoordinatedVoicingDecision['spacing']>['applied'] = 'unchanged';
	if (input.spacing && textureEligible && pcs.length >= 3) {
		const matching = ranked.filter(candidate => {
			const span = candidate.notes.at(-1)! - candidate.notes[0];
			return input.spacing === 'compact' ? span <= 12 : span >= 14;
		});
		const bestMotion = Math.min(...ranked.map(candidate => candidate.guideMotion ?? 0));
		// Texture must not force an octave-scale detour in the defining voices.
		// Preserve the ordinary pool if its requested spacing costs over four
		// additional semitones relative to the best available guide connection.
		if (!matching.length) spacingReason = 'unavailable';
		else if (Math.min(...matching.map(candidate => candidate.guideMotion ?? 0)) > bestMotion + 4) spacingReason = 'voice_leading';
		else { ranked = matching; spacingApplied = input.spacing; spacingReason = 'applied'; }
	}
	const contourEligible = !['guide', 'quartal'].includes(input.family) && !['guide', 'quartal'].includes(family);
	const topDistance = (notes: readonly number[]) => input.targetTopMidi !== undefined && contourEligible ? Math.abs(notes.at(-1)! - input.targetTopMidi) : 0;
	ranked.sort((a, b) => (a.guideMotion ?? 0) - (b.guideMotion ?? 0) || b.commonTones.length - a.commonTones.length ||
		a.totalMovement - b.totalMovement || topDistance(a.notes) - topDistance(b.notes) || a.registerDistance - b.registerDistance || a.notes.reduce((difference, note, index) => difference || note - b.notes[index], 0));
	const ordinary = ranked[0];
	let selected = ordinary;
	let lineStatus: NonNullable<CoordinatedVoicingDecision['keyboardLine']>['status'] = 'family_ineligible';
	if (line && contourEligible) {
		const distance = (notes: readonly number[]) => Math.abs(notes.at(-1)! - line.targetMidi);
		const ordinaryDistance = distance(ordinary.notes);
		// Spacing admission has already happened. A line may trade a small
		// amount of inner movement for a better upper connection, never select
		// an excluded spacing, change chord tones, or force an octave leap.
		const bounded = ranked.filter(candidate =>
			(candidate.guideMotion ?? 0) <= (ordinary.guideMotion ?? 0) + line.maxGuideDetour &&
			candidate.totalMovement <= ordinary.totalMovement + line.maxMovementDetour &&
			Math.abs(candidate.notes.at(-1)! - line.anchorMidi) <= line.maxTopLeap);
		// ranked is already in historical preference order; stable sorting
		// only puts the bounded melodic objective ahead of that ordering.
		bounded.sort((a,b) => distance(a.notes)-distance(b.notes));
		if (bounded.length && distance(bounded[0].notes) < ordinaryDistance) {
			selected = bounded[0]; lineStatus = 'connected';
		} else lineStatus = ordinaryDistance === 0 ? 'retained' : 'bounded_fallback';
	}


	const beforeContrary = selected;
	let contraryStatus: NonNullable<CoordinatedVoicingDecision['keyboardContraryMotion']>['status'] = 'family_ineligible';
	let contraryVoice: number | undefined;
	if (input.keyboardContraryMotion && contourEligible) {
		contraryStatus = 'unavailable';
		// Sorted rank is an unambiguous, non-crossing voice correspondence only
		// when both chords have the same number of voices. New/removed voices
		// never count as contrary motion.
		if (previous && previous.notes.length === selected.notes.length && selected.notes.length >= 3) {
			const top = selected.notes.at(-1)!;
			const topStep = top - previous.notes.at(-1)!;
			const oppositeVoice = (candidate: typeof selected): number | undefined => {
				for (let index = 1; index < candidate.notes.length - 1; index++) {
					const step = candidate.notes[index] - previous.notes[index];
					const upperStep = candidate.notes.at(-1)! - previous.notes.at(-1)!;
					if (step * upperStep < 0 && Math.abs(step) <= 5) return index;
				}
			};
			contraryVoice = oppositeVoice(selected);
			if (contraryVoice !== undefined) contraryStatus = 'retained';
			else if (topStep !== 0) {
				const alternatives = ranked.filter(candidate =>
					(candidate.notes.at(-1) === top || line &&
						Math.abs(candidate.notes.at(-1)! - line.targetMidi) === Math.abs(top - line.targetMidi) &&
						Math.abs(candidate.notes.at(-1)! - line.anchorMidi) <= line.maxTopLeap) &&
					(candidate.guideMotion ?? 0) <= (beforeContrary.guideMotion ?? 0) + 2 &&
					candidate.totalMovement <= beforeContrary.totalMovement + 4 &&
					// A connected-line claim must still satisfy its original bounds.
					(!line || lineStatus !== 'connected' ||
						(candidate.guideMotion ?? 0) <= (ordinary.guideMotion ?? 0) + line.maxGuideDetour &&
						candidate.totalMovement <= ordinary.totalMovement + line.maxMovementDetour) &&
					oppositeVoice(candidate) !== undefined);
				// Keep the 0.7 upper note whenever that admits contrary motion;
				// otherwise an equally close line target may change the upper pitch.
				const alternative = alternatives.find(candidate => candidate.notes.at(-1) === top) ?? alternatives[0];
				if (alternative) { selected = alternative; contraryVoice = oppositeVoice(selected); contraryStatus = 'changed'; }
			}
		}
	}

	const notes = Object.freeze([...selected.notes]);
	const memory = Object.freeze({ version: 1 as const, chord: Object.freeze(chord), notes });
	const decision = Object.freeze({ requestedFamily: input.family, resolvedFamily: family, correction,
		guideMotion: selected.guideMotion, commonTones: Object.freeze([...selected.commonTones]), totalMovement: selected.totalMovement,
		registerDistance: selected.registerDistance, candidateCount: ranked.length,
		...(input.keyboardContraryMotion ? { keyboardContraryMotion: Object.freeze({ status: contraryStatus,
			previousNotes: Object.freeze([...(previous?.notes ?? [])]), ordinaryNotes: Object.freeze([...beforeContrary.notes]), actualNotes: notes,
			topFromMidi: previous?.notes.at(-1) ?? null, topToMidi: notes.at(-1)!,
			...(contraryVoice !== undefined ? { voiceIndex: contraryVoice, fromMidi: previous!.notes[contraryVoice], toMidi: notes[contraryVoice] } : {}),
			guideDetour: (selected.guideMotion ?? 0) - (beforeContrary.guideMotion ?? 0), movementDetour: selected.totalMovement - beforeContrary.totalMovement }) } : {}),
		...(line ? { keyboardLine: Object.freeze({ status: lineStatus, contour: line.contour, targetMidi: line.targetMidi,
			anchorMidi: line.anchorMidi, actualMidi: notes.at(-1)!, ordinaryMidi: ordinary.notes.at(-1)!,
			distance: Math.abs(notes.at(-1)! - line.targetMidi), ordinaryDistance: Math.abs(ordinary.notes.at(-1)! - line.targetMidi),
			guideDetour: (selected.guideMotion ?? 0) - (ordinary.guideMotion ?? 0), movementDetour: selected.totalMovement - ordinary.totalMovement,
			maxTopLeap: line.maxTopLeap }) } : {}),

		...(input.spacing ? { spacing: Object.freeze({ request: input.spacing, applied: spacingApplied, reason: spacingReason, spanSemitones: notes.at(-1)! - notes[0] }) } : {}),
		...(input.targetTopMidi !== undefined ? { topLine: Object.freeze({ targetMidi: input.targetTopMidi, actualMidi: notes.at(-1)!,
			distance: Math.abs(notes.at(-1)! - input.targetTopMidi), eligible: contourEligible }) } : {}),
		...(input.rootlessTexture ? { rootlessTexture: Object.freeze({ request: input.rootlessTexture,
			applied: two ? 'two' as const : three ? 'three' as const : 'full' as const, eligible: textureEligible, noteCount: notes.length }) } : {}) });
	return Object.freeze({ notes, memory, decision });
}
