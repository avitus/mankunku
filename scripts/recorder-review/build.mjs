// Generate a portable, offline review page from the same replay used by the regression test.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../../', import.meta.url));
// SSR-only analysis must not invalidate a running dev server's browser cache.
const config = {
	root, configFile: false, cacheDir: resolve(root, 'node_modules/.vite-recorder-review'),
	optimizeDeps: { noDiscovery: true, entries: [] },
	resolve: { alias: { $lib: resolve(root, 'src/lib') } }
};
const server = await createServer({ ...config, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
try {
	await build();
} finally {
	await server.close();
}

async function build() {
	const load = path => server.ssrLoadModule('/' + path);
	const { cases, corpus, replayTake, recorderComparisons, writtenNoteName } = await load('tests/helpers/recorder-baseline.ts');
	const { leadSheetTuneFor, leadSheetAbcOptions } = await load('src/lib/music/lead-sheet.ts');
	const { tuneToAbc } = await load('src/lib/music/tune-notation.ts');
	const { concertKeyToWritten } = await load('src/lib/music/transposition.ts');
	const { INSTRUMENTS } = await load('src/lib/types/instruments.ts');
	const { PITCH_CLASSES } = await load('src/lib/types/music.ts');

	function score(instrumentId, notes, key, shift = 0) {
		const instrument = INSTRUMENTS[instrumentId];
		const writtenKey = concertKeyToWritten(key, instrument);
		if (!notes.some(n => n.pitch !== null)) return { abc: '', events: [], key: writtenKey };
		const phrase = {
			id: '', timeSignature: [4, 4], key, harmony: [],
			notes: notes.map(n => ({ ...n, pitch: n.pitch === null ? null : n.pitch + shift }))
		};
		const { tune } = leadSheetTuneFor(phrase, Infinity);
		return {
			key: writtenKey,
			abc: tuneToAbc(tune, instrument, leadSheetAbcOptions(phrase, 2)),
			events: phrase.notes.map(n => [
				n.pitch === null ? 'Rest' : writtenNoteName(n.pitch, key, instrumentId),
				n.offset.join('/'), n.duration.join('/')
			])
		};
	}

	const takes = [];
	for (const take of cases) {
		const result = await replayTake(take);
		const inferred = result?.detectedKey;
		const notes = result?.phrase.notes ?? [];
		const comparison = recorderComparisons(take, result);
		const concertShift = inferred ? PITCH_CLASSES.indexOf(inferred) : 0;
		const ending = take.expected.at(-1);
		const endingTime = ending.offset[0] / ending.offset[1] * 4 * 60 / take.tempo + (result?.phaseSeconds ?? 0);
		takes.push({
			id: take.lickId, name: take.name, instrument: INSTRUMENTS[take.instrumentId].name, tempo: take.tempo,
			recordedAt: take.recordedAt, practiceScore: take.practiceScore, candidateCount: take.candidateCount,
			edits: comparison.edits, oldEdits: comparison.lastEdits, endingTime,
			boundaries: [...(result?.omittedBoundaries ?? []),
				...(result?.recoveredNotes ?? []).map(n => ({ time: n.onsetTime, midi: n.midi, reason: 'recovered passing note' }))
			].sort((a, b) => a.time - b.time).map(n => ({
				time: n.time, reason: n.reason, note: writtenNoteName(n.midi, inferred, take.instrumentId)
			})),
			oldCollisions: comparison.lastCollisions, collisions: comparison.collisions,
			editorTooLong: (result?.phrase.difficulty.lengthBars ?? 0) > 4,
			audio: (await readFile(new URL(take.file, corpus))).toString('base64'),
			performed: [
				score(take.instrumentId, notes, inferred ?? 'C', concertShift),
				score(take.instrumentId, comparison.lastNotes, inferred ?? 'C', concertShift),
				score(take.instrumentId, take.expected, take.key)
			],
			saved: [
				score(take.instrumentId, notes, 'C'), score(take.instrumentId, comparison.lastNotes, 'C'),
				score(take.instrumentId, take.expected, 'C', -PITCH_CLASSES.indexOf(take.key))
			]
		});
	}

	const template = await readFile(new URL('page.html', import.meta.url), 'utf8');
	const abcjs = await readFile(resolve(root, 'node_modules/abcjs/dist/abcjs-basic-min.js'), 'utf8');
	const license = await readFile(resolve(root, 'node_modules/abcjs/dist/abcjs-basic-min.js.LICENSE'), 'utf8');
	const font = await readFile(resolve(root, 'static/fonts/fraunces-latin.woff2'));
	const fontLicense = await readFile(resolve(root, 'static/fonts/fraunces.license.txt'), 'utf8');
	const output = resolve(process.argv[2] ?? 'recorder-review.html');
	const html = template.replace('/* ABCJS */', () => '/*' + license.replaceAll('*/', '* /') + '*/\n' + abcjs.replaceAll('</script', '<\\/script'))
		.replace('/* FONT_LICENSE */', () => '/*' + fontLicense.replaceAll('*/', '* /') + '*/')
		.replace('FONT_DATA', () => font.toString('base64'))
		.replace('TAKE_DATA', () => JSON.stringify(takes).replaceAll('<', '\\u003c'));
	await writeFile(output, html);
	console.log(`Wrote ${takes.length} takes to ${output}`);
}
