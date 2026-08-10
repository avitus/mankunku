/**
 * The verified lead-sheet corpus: every chart the user has checked in the
 * dev environment, with its MuseScore source and printed PDF under
 * `Leadsheets/`. Two integration suites iterate this manifest:
 *
 *  - musescore-corpus.test.ts — the MuseScore import must match its golden
 *    fixture EXACTLY (the import is verified correct; any drift is a
 *    regression). Regenerate goldens after an intentional importer change:
 *      npx tsx tests/helpers/record-musescore-fixtures.ts
 *  - pdf-vs-musescore.test.ts — the PDF pipeline measured against the
 *    MuseScore import, with per-chart expected-fail sets and floors.
 *    Record a PDF fixture with the live dev server (per chart, ~3-5 min):
 *      node <scratchpad>/e2e-system-import.mjs <probe-slug> \
 *        tests/fixtures/leadsheets/pdf-vs-musescore/<slug>.pdf-import.json
 *
 * TO ADD A CHART: drop the .mscz and .pdf into Leadsheets/, append an entry
 * here, record both fixtures, then tune knownDefects/floors to the first
 * recording.
 */
// Relative imports, not $lib: record-musescore-fixtures.ts runs this file
// standalone under `npx tsx`, where the alias only resolves if the generated
// .svelte-kit/tsconfig.json exists (prepare swallows a failed svelte-kit sync).
import { INSTRUMENTS } from '../../src/lib/types/instruments';
import { writtenSheetToConcert } from '../../src/lib/tunes/source-transposition';
import type { Tune } from '../../src/lib/types/tune';

export interface CorpusChart {
	/** Fixture basename under tests/fixtures/leadsheets/pdf-vs-musescore/. */
	slug: string;
	/** Filename under Leadsheets/Musescore/. */
	mscz: string;
	/** Filename under Leadsheets/PDF/. */
	pdf: string;
	/** pdf-vs-musescore strict targets currently expected to fail. */
	knownDefects: string[];
	/** Regression floors pinned just under the recorded run's quality. */
	floors: { chordSeq: number; pitchSeq: number };
	/**
	 * OMR-fused import (LEGATO melody + text-layer chords; see docs/omr/):
	 * strict targets expected to fail and floors for the recorded
	 * `<slug>.omr-import.json` fixture. Present only for charts with a
	 * committed OMR fixture. Re-record with tests/e2e's recorder flow after
	 * an intentional fusion change.
	 */
	omrKnownDefects?: string[];
	omrFloors?: { chordSeq: number; pitchSeq: number };
}

/**
 * The instrument the user's verified imports ran with — the full tenor-sax
 * config, shared by BOTH the parser (part selection) and the concert
 * conversion below so the two can never use different transposition values.
 */
export const CORPUS_INSTRUMENT = INSTRUMENTS['tenor-sax'];

/**
 * The verified app flow's concert-pitch resolution rule — shared by the
 * fixture recorder and the corpus checker so it cannot drift: a file
 * DECLARING a transposing part is already concert after parsing; a file
 * claiming concert pitch is treated as a written Bb chart for the tenor
 * user and shifted to concert.
 */
export function resolveConcertSheet(sheet: Tune, declaredTransposition: number): Tune {
	return declaredTransposition !== 0
		? sheet
		: writtenSheetToConcert(sheet, 'Bb', CORPUS_INSTRUMENT);
}

export const CORPUS: CorpusChart[] = [
	{
		slug: 'all-the-things-you-are',
		mscz: 'All The Things You Are (with Lyrics).mscz',
		pdf: 'All The Things You Are (with Lyrics).pdf',
		knownDefects: ['melody', 'pitches'],
		floors: { chordSeq: 0.95, pitchSeq: 0.4 }
	},
	{
		slug: 'all-of-me',
		mscz: 'All of Me.mscz',
		pdf: 'All of Me.pdf',
		knownDefects: ['form', 'chords', 'melody', 'pitches'],
		floors: { chordSeq: 0.8, pitchSeq: 0.5 },
		omrKnownDefects: ['form', 'chords', 'melody'],
		omrFloors: { chordSeq: 0.9, pitchSeq: 0.95 }
	},
	{
		slug: 'autumn-leaves',
		mscz: 'Autumn Leaves in E-.mscz',
		pdf: 'Autumn Leaves in E.pdf',
		knownDefects: ['chords', 'melody', 'pitches'],
		floors: { chordSeq: 0.95, pitchSeq: 0.7 }
	},
	{
		// The hardest chart in the corpus: dense ballad layout undercounts
		// bars in the geometry (14/17 — the first undercount class, next
		// tuning target), the model path runs on the content-filter
		// fallback, and the key misreads. Expectations are honest until
		// that work lands.
		slug: 'body-and-soul',
		mscz: 'Body and Soul.mscz',
		pdf: 'Body and Soul.pdf',
		knownDefects: ['key', 'bars', 'form', 'chords', 'melody', 'pitches'],
		floors: { chordSeq: 0.2, pitchSeq: 0.2 }
	},
	{
		slug: 'fly-me-to-the-moon',
		mscz: 'Fly Me to the Moon (Mankunku version).mscz',
		pdf: 'Fly Me to the Moon (Mankunku version)-T._Sax_(1).pdf',
		knownDefects: ['chords', 'melody', 'pitches'],
		floors: { chordSeq: 0.9, pitchSeq: 0.45 }
	},
	{
		slug: 'lady-bird',
		mscz: 'Lady Bird.mscz',
		pdf: 'Lady Bird.pdf',
		knownDefects: ['melody', 'pitches'],
		floors: { chordSeq: 0.9, pitchSeq: 0.55 },
		omrKnownDefects: ['melody', 'pitches'],
		omrFloors: { chordSeq: 0.95, pitchSeq: 0.85 }
	},
	{
		slug: 'on-green-dolphin-street',
		mscz: 'On Green Dolphin Street.mscz',
		pdf: 'On Green Dolphin Street.pdf',
		knownDefects: ['form', 'melody', 'pitches'],
		floors: { chordSeq: 0.9, pitchSeq: 0.45 }
	},
	{
		slug: 'take-the-a-train',
		mscz: 'Take the A Train.mscz',
		pdf: 'Take the A Train.pdf',
		knownDefects: ['melody', 'pitches'],
		floors: { chordSeq: 0.8, pitchSeq: 0.6 },
		omrKnownDefects: ['melody', 'pitches'],
		omrFloors: { chordSeq: 0.95, pitchSeq: 0.9 }
	},
	{
		slug: 'there-will-never-be-another-you',
		mscz: 'There Will Never Be Another You.mscz',
		pdf: 'There Will Never Be Another You.pdf',
		knownDefects: ['chords', 'melody', 'pitches'],
		floors: { chordSeq: 0.95, pitchSeq: 0.7 }
	}
];
