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
import { parseMuseScoreFile } from '$lib/tunes/import/musescore';
import type { Tune } from '$lib/types/tune';
import { CORPUS, CORPUS_INSTRUMENT, resolveConcertSheet } from '../helpers/leadsheet-corpus';
import { sheet, section, seg } from '../helpers/tune-fixtures';

const root = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Independent check of the corpus concert-pitch rule with hand-computed
 * values. The golden fixtures were RECORDED through resolveConcertSheet, so
 * the corpus test below cannot catch a wrong branch or interval baked into
 * both sides — this one can.
 */
describe('resolveConcertSheet', () => {
	const written = sheet({
		key: 'Bb',
		sections: [
			section({
				bars: 1,
				notes: [{ pitch: 70, duration: [1, 1], offset: [0, 1] }], // written Bb4
				harmony: [seg('C', '7', [0, 1], [1, 1], 'C7')]
			})
		]
	});

	it('shifts a zero-declaration file to concert as a written Bb tenor chart (−14 semitones)', () => {
		const concert = resolveConcertSheet(written, 0);
		expect(concert.key).toBe('Ab'); // Bb down a major 2nd (pitch class of 14)
		expect(concert.sections[0].notes[0].pitch).toBe(56); // written Bb4 → concert Ab3
		expect(concert.sections[0].harmony[0].chord.root).toBe('Bb');
		expect(concert.sections[0].harmony[0].symbol).toBe('Bb7');
	});

	it('leaves a file that declares a transposing part unchanged (already concert)', () => {
		expect(resolveConcertSheet(written, 14)).toBe(written);
	});
});

describe.each(CORPUS)('MuseScore corpus — $slug', ({ slug, mscz }) => {
	it('imports exactly as verified (golden fixture match)', async () => {
		const bytes = new Uint8Array(readFileSync(`${root}/Leadsheets/Musescore/${mscz}`));
		const { sheets, declaredTransposition } = await parseMuseScoreFile(
			{ name: mscz, bytes },
			CORPUS_INSTRUMENT
		);
		expect(sheets).toHaveLength(1);
		const sheet = resolveConcertSheet(sheets[0], declaredTransposition);
		const golden = JSON.parse(
			readFileSync(
				`${root}/tests/fixtures/leadsheets/pdf-vs-musescore/${slug}.musescore-import.json`,
				'utf8'
			)
		) as Tune;
		expect(sheet).toEqual(golden);
	});
});
