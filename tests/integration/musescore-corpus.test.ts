/**
 * MuseScore import fidelity — the whole verified corpus.
 *
 * Each chart in `Leadsheets/Musescore/` was imported through the app flow
 * and VERIFIED correct by the user in the dev environment; the golden
 * fixtures capture that output exactly. The import must stay flawless: any
 * drift from a golden is a regression, not tuning noise (unlike the PDF
 * pipeline, this path is deterministic).
 *
 * After an INTENTIONAL importer change, regenerate and review:
 *   npx tsx tests/helpers/record-musescore-fixtures.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMuseScoreFile } from '$lib/leadsheets/import/musescore';
import { writtenSheetToConcert } from '$lib/leadsheets/source-transposition';
import { INSTRUMENTS } from '$lib/types/instruments';
import type { LeadSheet } from '$lib/types/lead-sheet';
import { CORPUS, CORPUS_INSTRUMENT } from '../helpers/leadsheet-corpus';

const root = fileURLToPath(new URL('../..', import.meta.url));

describe.each(CORPUS)('MuseScore corpus — $slug', ({ slug, mscz }) => {
	it('imports exactly as verified (golden fixture match)', async () => {
		const bytes = new Uint8Array(readFileSync(`${root}/Leadsheets/Musescore/${mscz}`));
		const { sheets, declaredTransposition } = await parseMuseScoreFile(
			{ name: mscz, bytes },
			CORPUS_INSTRUMENT
		);
		expect(sheets).toHaveLength(1);
		// The verified app flow: declared transposing parts are already
		// concert; concert-claiming files are written Bb charts for the
		// tenor user.
		const sheet =
			declaredTransposition !== 0
				? sheets[0]
				: writtenSheetToConcert(sheets[0], 'Bb', INSTRUMENTS['tenor-sax']);
		const golden = JSON.parse(
			readFileSync(
				`${root}/tests/fixtures/leadsheets/pdf-vs-musescore/${slug}.musescore-import.json`,
				'utf8'
			)
		) as LeadSheet;
		expect(sheet).toEqual(golden);
	});
});
