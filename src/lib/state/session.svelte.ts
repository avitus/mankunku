import type { Phrase } from '$lib/types/music';
import type { AudioEngineState, MicPermissionState, DetectedNote } from '$lib/types/audio';
import type { Score, BleedFilterLog } from '$lib/types/scoring';

export const session = $state<{
	phrase: Phrase | null;
	engineState: AudioEngineState;
	tempo: number;
	isLoadingInstrument: boolean;
	micPermission: MicPermissionState;
	inputLevel: number;
	currentPitchMidi: number | null;
	currentPitchCents: number;
	currentClarity: number;
	isDetecting: boolean;
	isRecording: boolean;
	recordedNotes: DetectedNote[];
	lastScore: Score | null;
	bleedFilterLog: BleedFilterLog | null;
}>({
	phrase: null,
	engineState: 'uninitialized',
	tempo: 100,
	isLoadingInstrument: false,
	micPermission: 'prompt',
	inputLevel: 0,
	currentPitchMidi: null,
	currentPitchCents: 0,
	currentClarity: 0,
	isDetecting: false,
	isRecording: false,
	recordedNotes: [],
	lastScore: null,
	bleedFilterLog: null
});
