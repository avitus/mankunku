import type { DetectedNote } from './audio.ts';
import type { Note } from './music.ts';

export type Grade = 'perfect' | 'great' | 'good' | 'fair' | 'try-again';

export interface NoteResult {
	/** Expected note from the phrase */
	expected: Note;
	/** Matched detected note, null if missed */
	detected: DetectedNote | null;
	pitchScore: number;
	rhythmScore: number;
	/** True if the expected note was not played */
	missed: boolean;
	/** True if this is an extra note not in the phrase */
	extra: boolean;
}

export interface Score {
	pitchAccuracy: number;
	rhythmAccuracy: number;
	overall: number;
	grade: Grade;
	noteResults: NoteResult[];
	/** Number of notes that were correctly identified */
	notesHit: number;
	/** Total expected notes */
	notesTotal: number;
}

export interface AlignmentPair {
	expectedIndex: number | null;
	detectedIndex: number | null;
	cost: number;
}
