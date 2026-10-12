/** Provider-neutral contracts. Pixels and printed pitches enter; no concert transposition or persistence here. */
import type { BarMelody } from './system-bar-validation';

export type Clef = 'treble' | 'bass' | 'alto' | 'tenor';
export interface RecognitionContext {
	fifths: number | null;
	clef: Clef | null;
	timeSignature: [number, number] | null;
}
export interface RecognizedBar {
	startRepeat: boolean;
	endRepeat: boolean;
	ending: number | null;
	pickup: boolean;
	pickupBeats?: number;
	melody: BarMelody;
}
export interface NoteheadEvidence {
	count: number;
	letters: string[];
}
export type Harmony = Array<Array<[number, string]>>;
export interface SystemRecognitionInput {
	image: string;
	barCount: number;
	timeSignature: [number, number];
	first?: boolean;
	context?: RecognitionContext;
	barImages?: string[];
	/** Unannotated measure crops including the chord row, for isolated harmony recovery. */
	harmonyImages?: string[];
	barEvidence?: Array<NoteheadEvidence | null>;
	/** Separate harmony pass for a system with no usable PDF text chords. */
	readHarmony?: boolean;
	/** Two independent printed-symbol observations, aligned by complete notehead evidence. */
	readAccidentals?: boolean;
	/** Cheap header-only observation, before concurrent music recognition. */
	contextOnly?: boolean;
	/** OMR already supplied melody; read only the missing harmony. */
	harmonyOnly?: boolean;
}
export interface SystemRecognitionResult {
	keySignature: { fifths: number } | null;
	clef?: Clef | null;
	timeSignature: [number, number] | null;
	bars: RecognizedBar[];
	harmony?: Harmony;
	warnings: string[];
}
/** Replaceable service boundary for future local OMR or hosted providers. */
export interface SystemRecognizer {
	readonly id: string;
	recognize(
		input: SystemRecognitionInput,
		signal: AbortSignal,
		onAttempt?: () => void
	): Promise<SystemRecognitionResult>;
}
