import type { DifficultyMetadata, HarmonicSegment, Note, PitchClass } from './music';

/**
 * Lead-sheet data model.
 *
 * A lead sheet is a full song form — melody plus complete harmony — organized
 * into labeled sections (A, B, Intro, …) with repeat and ending markers.
 * Sections keep their own `notes`/`harmony` with SECTION-LOCAL offsets
 * (whole-note units, starting at [0,1]); `flattenLeadSheet` in
 * `$lib/leadsheets/flatten` produces the continuous form that the notation
 * renderer and backing-track engine consume.
 *
 * Like all phrase data, pitches and keys are CONCERT pitch — transposition to
 * written pitch happens only at display time.
 */

export type LeadSheetSource =
	| 'curated'
	| 'user'
	| 'imported-ireal'
	| 'imported-biab'
	| 'imported-pdf'
	| string;

export interface LeadSheetSection {
	/** Section label shown on the chart: 'A', 'B', 'Intro', 'Coda', … */
	label: string;
	/** Length of the section in bars. Authoritative even when melody is sparse or empty. */
	bars: number;
	/** Opens a repeat (`|:`) at the start of this section. */
	repeatStart?: boolean;
	/** Closes a repeat (`:|`) at the end of this section. */
	repeatEnd?: boolean;
	/** Marks this section as a numbered volta ending. */
	ending?: 1 | 2;
	/** Melody, offsets relative to the section start. Empty for harmony-only sheets. */
	notes: Note[];
	/** Harmony, offsets relative to the section start. */
	harmony: HarmonicSegment[];
}

export interface LeadSheet {
	id: string;
	title: string;
	composer?: string;
	/** Concert-pitch key. */
	key: PitchClass;
	timeSignature: [number, number];
	/** Feel/style label, e.g. 'Medium Swing', 'Ballad'. */
	style?: string;
	tags: string[];
	sections: LeadSheetSection[];
	source: LeadSheetSource;
	difficulty?: DifficultyMetadata;
	/**
	 * Storage path of the original imported PDF in the `lead-sheets` bucket
	 * (`{uid}/{id}.pdf`), when this sheet came from a PDF import. Round-trips
	 * through the cloud row so reconcile never clobbers it.
	 */
	pdfUrl?: string;
}
