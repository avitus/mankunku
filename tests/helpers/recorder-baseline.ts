import { readFileSync } from 'node:fs';
import { INSTRUMENTS, type InstrumentId } from '$lib/types/instruments';
import { concertKeyToWritten, concertToWritten } from '$lib/music/transposition';
import { midiToDisplayName } from '$lib/music/notation';
import { estimateRecorderEdits } from './recorder-edit-effort';
import { previousRecorderRhythm, quantizeRecorderRhythm } from '$lib/audio/recorder-rhythm';
import { detectKey, quantizeNotes } from '$lib/audio/quantizer';
import { PITCH_CLASSES, type Note, type PitchClass } from '$lib/types/music';
import { replayFromAudioBuffer } from '$lib/audio/replay';
import type { BoundaryEvidence } from '$lib/audio/recorder-boundaries';
import { transcribeTakeWithKey } from '$lib/audio/record-transcription';
import { loadWavFixture, makeFakeAudioBuffer } from './audio-fixtures';

export interface RecorderCase {
	lickId: string;
	name: string;
	instrumentId: InstrumentId;
	file: string;
	key: PitchClass;
	tempo: number;
	sessionId: string;
	recordedAt: number;
	practiceScore: number;
	candidateCount: number;
	expected: (Note & { pitch: number })[];
}

export const corpus = new URL('../fixtures/recorder-baseline/', import.meta.url);
export const cases: RecorderCase[] = JSON.parse(readFileSync(new URL('takes.json', corpus), 'utf8'));

export async function replayTake(take: Pick<RecorderCase, 'file' | 'tempo'>) {
	const { channel, sampleRate } = loadWavFixture(`recorder-baseline/${take.file}`);
	const replay = await replayFromAudioBuffer(makeFakeAudioBuffer(channel, sampleRate), {
		windowAnchor: 'end'
	});
	let segmented!: BoundaryEvidence;
	const result = transcribeTakeWithKey({
		pcm: { samples: channel, sampleRate },
		readings: replay.readings,
		weakReadings: replay.weakReadings,
		workletOnsets: replay.onsets,
		anchorOffset: 0,
		tempo: take.tempo
	}, evidence => { segmented = evidence; });
	return result && { ...result, segmented };
}

/** Spell note details in the same written register and key signature as the staff. */
export function writtenNoteName(midi: number, concertKey: PitchClass, instrumentId: InstrumentId) {
	const instrument = INSTRUMENTS[instrumentId];
	return midiToDisplayName(concertToWritten(midi, instrument), concertKeyToWritten(concertKey, instrument));
}

/** Apply each recorder version to the same segmentation and its own key rule. */
export function recorderComparisons(take: RecorderCase, result: Awaited<ReturnType<typeof replayTake>>) {
	const detected = result?.detected ?? [];
	const priorKey = detectKey(detected);
	const shift = PITCH_CLASSES.indexOf(priorKey);
	const prior = previousRecorderRhythm(detected, take.tempo);
	const normalize = (notes: Note[], delta: number) => notes.map(note =>
		({ ...note, pitch: note.pitch === null ? null : note.pitch - delta }));
	const previous = normalize(prior.notes, shift);
	const beatLocal = normalize(quantizeNotes(detected, take.tempo, [4, 4]), shift);
	const aligned = normalize(quantizeNotes(detected.map(n => ({ ...n, onsetTime: n.onsetTime - prior.phaseSeconds })), take.tempo, [4, 4]), shift);
	const effort = (notes: Note[]) => estimateRecorderEdits(notes, take.expected, take.key);
	// Replay the immediately preceding recorder without changing its acoustic
	// decisions, clock fit or key rule. This also separates key-only improvement.
	const lastVersion = result && quantizeRecorderRhythm(result.segmented.notes, take.tempo, result.segmented.skipCosts);
	const lastNotes = normalize(lastVersion?.notes ?? [], result ? PITCH_CLASSES.indexOf(result.detectedKey) : 0);
	let priorPerformed = lastVersion?.notes ?? [];
	let priorCollisions = lastVersion?.collisions ?? 0;
	if (result?.octaveCorrections.length) {
		const candidates = result.segmented.notes.map(note => ({ ...note }));
		for (const { index, originalMidi } of result.octaveCorrections) candidates[index].midi = originalMidi;
		const priorFit = quantizeRecorderRhythm(candidates, take.tempo, result.segmented.skipCosts);
		priorPerformed = priorFit.notes;
		priorCollisions = priorFit.collisions;
	}
	const priorNotes = normalize(priorPerformed, shift);
	return {
		lastNotes, lastCollisions: lastVersion?.collisions ?? 0, lastEdits: effort(lastNotes),
		priorKey, priorNotes, priorCollisions, priorEdits: effort(priorNotes),
		keyOnlyEdits: effort(normalize(priorPerformed, result ? PITCH_CLASSES.indexOf(result.detectedKey) : 0)),
		previous, oldEdits: effort(previous), alignedEdits: effort(aligned), legacyEdits: effort(beatLocal),
		edits: effort(result?.phrase.notes ?? []), withKey: effort(normalize(result?.performedNotes ?? [], PITCH_CLASSES.indexOf(take.key))),
		oldCollisions: prior.collisions, collisions: result?.collisions ?? 0,
		omissions: result?.omitted ?? 0
	};
}

// Frozen before comparing the new model against the archive. Two contain
// actual triplet groups; split by lick so transposed takes cannot leak.
export const rhythmHoldout = new Set([
	'user-1777416884800-8khg', 'user-1775775003144-sc5m',
	'user-1776795260698-n3y7', 'user-1779235892015-kp0v'
]);
