/**
 * Regenerate the golden MuseScore-import fixtures for the whole corpus.
 * Run after an INTENTIONAL importer change, then review the diff:
 *   npx tsx tests/helpers/record-musescore-fixtures.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMuseScoreFile } from '../../src/lib/leadsheets/import/musescore';
import { writtenSheetToConcert } from '../../src/lib/leadsheets/source-transposition';
import { INSTRUMENTS } from '../../src/lib/types/instruments';
import { CORPUS, CORPUS_INSTRUMENT } from './leadsheet-corpus';

const root = fileURLToPath(new URL('../..', import.meta.url));

for (const chart of CORPUS) {
	const bytes = new Uint8Array(readFileSync(`${root}/Leadsheets/Musescore/${chart.mscz}`));
	const { sheets, warnings, declaredTransposition } = await parseMuseScoreFile(
		{ name: chart.mscz, bytes },
		CORPUS_INSTRUMENT
	);
	if (sheets.length !== 1) throw new Error(`${chart.slug}: expected 1 sheet, got ${sheets.length}`);
	// The verified app flow: a file DECLARING a transposing part is already
	// concert after parsing; a file claiming concert pitch is treated as a
	// written Bb chart for the tenor user and shifted to concert.
	const sheet =
		declaredTransposition !== 0
			? sheets[0]
			: writtenSheetToConcert(sheets[0], 'Bb', INSTRUMENTS['tenor-sax']);
	const out = `${root}/tests/fixtures/leadsheets/pdf-vs-musescore/${chart.slug}.musescore-import.json`;
	writeFileSync(out, JSON.stringify(sheet, null, 1) + '\n');
	console.log(
		`${chart.slug}: key ${sheet.key}, ${sheet.sections.reduce((n, s) => n + s.bars, 0)} bars, declared ${declaredTransposition}, warnings: ${warnings.length ? warnings.join('; ') : 'none'}`
	);
}
