/** Reproducible, offline release gate against the existing MuseScore references. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const out = process.argv[2];
if (!out) throw new Error('Usage: node scripts/evaluate-pdf-corpus.mjs NEW_OUTPUT_DIRECTORY');
if (fs.existsSync(out))
	throw new Error('Choose a new output directory; evaluations are immutable.');
fs.mkdirSync(out, { recursive: true });
const charts = [
	['lady-bird', 'Lady Bird.pdf'],
	['all-of-me', 'All of Me.pdf'],
	['all-the-things-you-are', 'All The Things You Are (with Lyrics).pdf'],
	['autumn-leaves', 'Autumn Leaves in E.pdf'],
	['body-and-soul', 'Body and Soul.pdf'],
	['fly-me-to-the-moon', 'Fly Me to the Moon (Mankunku version)-T._Sax_(1).pdf'],
	['on-green-dolphin-street', 'On Green Dolphin Street.pdf'],
	['take-the-a-train', 'Take the A Train.pdf'],
	['there-will-never-be-another-you', 'There Will Never Be Another You.pdf']
];
const results = [];
for (const [slug, name] of charts) {
	const reference = path.join(out, slug + '.reference.json');
	fs.writeFileSync(
		reference,
		JSON.stringify({
			reviewed: true,
			tuneFile: path.resolve(
				'tests/fixtures/leadsheets/pdf-vs-musescore',
				slug + '.musescore-import.json'
			),
			referenceNote:
				'Existing MuseScore source fixture; see docs/omr/pdf-import-accuracy.md for known reference limitations.'
		})
	);
	const run = spawnSync(
		process.execPath,
		[
			'scripts/evaluate-pdf-import.mjs',
			'--pdf',
			path.join('Leadsheets/PDF', name),
			'--out',
			path.join(out, slug),
			'--glyphs-only',
			'--reference',
			reference,
			'--source',
			'Bb'
		],
		{ encoding: 'utf8' }
	);
	fs.writeFileSync(path.join(out, slug + '.log'), run.stdout + run.stderr);
	const report = path.join(out, slug, 'run-1.json');
	const result = fs.existsSync(report)
		? JSON.parse(fs.readFileSync(report, 'utf8'))
		: { metrics: null, failures: [`Evaluation failed (${run.status})`] };
	results.push({ chart: slug, metrics: result.metrics, failures: result.failures });
	console.log(`${slug}: ${result.failures.length ? result.failures.join('; ') : 'PASS'}`);
	if (run.status !== 0 || result.failures.length) process.exitCode = 2;
}
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(results, null, 2) + '\n');
