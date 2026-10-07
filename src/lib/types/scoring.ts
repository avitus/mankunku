import type { DetectedNote } from './audio';
import type { Note } from './music';

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
	/**
	 * True when an extra counted against the score (`scoring/extras.ts`):
	 * a confident, full-length note inside the line that is neither a split
	 * of its neighbour nor a short transition beside one. Absent on free
	 * extras and on every result scored before 2026-10-07.
	 */
	charged?: true;
}

export interface TimingDiagnostics {
	/** Mean signed offset in ms (negative = early, positive = late) */
	meanOffsetMs: number;
	/** Median signed offset in ms (negative = early, positive = late) */
	medianOffsetMs: number;
	/** Standard deviation of offsets in ms (consistency measure) */
	stdDevMs: number;
	/** Latency correction already applied by the scorer, in ms */
	latencyCorrectionMs: number;
	/** Per-note signed offsets in ms, parallel to noteResults (null for missed/extra) */
	perNoteOffsetMs: (number | null)[];
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
	/**
	 * Extras that counted as zeros in both accuracies (`scoring/extras.ts`).
	 * Absent on scores saved before 2026-10-07, when every extra was free.
	 */
	extrasCharged?: number;
	/** Timing diagnostics: bias, spread, and per-note offsets */
	timing: TimingDiagnostics;
}

export interface AlignmentPair {
	expectedIndex: number | null;
	detectedIndex: number | null;
	cost: number;
}

export interface BleedFilterLog {
	totalNotes: number;
	keptNotes: number;
	filteredNotes: DetectedNote[];
	unfilteredScore: Score | null;
	filteredScore: Score | null;
}
