/** Node 24+, local opt-in evaluation. Live runs incur provider charges; default is layout-only. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { chromium } from 'playwright';
import Anthropic from '@anthropic-ai/sdk';
import { createMelodyReplay } from './pdf-melody-replay.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
	const i = args.indexOf(name);
	return i < 0 ? fallback : args[i + 1];
};
const pdf = option('--pdf');
const out = option('--out');
if (!pdf || !out)
	throw new Error(
		'Usage: node scripts/evaluate-pdf-import.mjs --pdf chart.pdf --out new-directory [--live --reference reference.json --systems 1 --runs 3 --source Bb]'
	);
fs.mkdirSync(out, { recursive: true });
if (fs.existsSync(path.join(out, 'manifest.json')))
	throw new Error('Choose a fresh output directory; recorded evaluations are immutable.');
const hash = (data) => createHash('sha256').update(data).digest('hex');
const sourceFiles = (directory) =>
	fs.readdirSync(path.join(repo, directory), { withFileTypes: true }).flatMap((entry) => {
		const name = path.join(directory, entry.name);
		return entry.isDirectory() ? sourceFiles(name) : [name];
	});
const files = [
	'scripts/evaluate-pdf-import.mjs',
	'scripts/pdf-melody-replay.mjs',
	'package-lock.json',
	...sourceFiles('src')
].sort();
const manifest = {
	version: 1,
	createdAt: new Date().toISOString(),
	source: path.basename(pdf),
	pdfSha256: hash(fs.readFileSync(pdf)),
	commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
	files: Object.fromEntries(files.map((f) => [f, hash(fs.readFileSync(path.join(repo, f)))])),
	live: args.includes('--live'),
	replayFirstPassSha256: option('--replay-first-pass')
		? hash(fs.readFileSync(option('--replay-first-pass')))
		: null,
	node: process.version,
	dependencies: Object.fromEntries(
		['pdfjs-dist', '@anthropic-ai/sdk', 'playwright', 'typescript'].map((name) => [
			name,
			JSON.parse(fs.readFileSync(path.join(repo, 'node_modules', name, 'package.json'), 'utf8'))
				.version
		])
	)
};
const save = (name, value) =>
	fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
save('manifest.json', manifest);

// Load the same TS modules as the app, without SvelteKit or a credential-bearing server.
registerHooks({
	resolve(specifier, context, next) {
		if (specifier === '$env/dynamic/private')
			return { url: 'data:text/javascript,export const env = process.env;', shortCircuit: true };
		let candidate;
		if (specifier.startsWith('$lib/')) candidate = path.join(repo, 'src/lib', specifier.slice(5));
		else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:'))
			candidate = fileURLToPath(new URL(specifier, context.parentURL));
		if (candidate && !path.extname(candidate) && fs.existsSync(candidate + '.ts'))
			return { url: pathToFileURL(candidate + '.ts').href, shortCircuit: true };
		return next(specifier, context);
	},
	load(url, context, next) {
		if (url.startsWith('file:') && url.endsWith('.ts'))
			return {
				format: 'module',
				source: ts.transpileModule(fs.readFileSync(fileURLToPath(url), 'utf8'), {
					compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
				}).outputText,
				shortCircuit: true
			};
		return next(url, context);
	}
});
// References can be corrected without spending another model call. Preserve
// the original report and record both reference versions in the derived one.
if (option('--rescore')) {
	const originalText = fs.readFileSync(option('--rescore'), 'utf8');
	const original = JSON.parse(originalText);
	const reference = JSON.parse(fs.readFileSync(option('--reference'), 'utf8'));
	if (reference.tuneFile)
		reference.sheet = JSON.parse(
			fs.readFileSync(path.resolve(path.dirname(option('--reference')), reference.tuneFile), 'utf8')
		);
	const { claudeJsonToTune } = await import('../src/lib/tunes/import/claude-pdf.ts');
	const { measurePdfAccuracy, pdfAccuracyGate } = await import(
		'../src/lib/tunes/import/pdf-accuracy.ts'
	);
	const expected = reference.doc ? claudeJsonToTune(reference.doc).sheet : reference.sheet;
	if (!expected || !original.sheet) throw new Error('Cannot rescore absent reference or result');
	const metrics = measurePdfAccuracy(expected, original.sheet);
	const failures = pdfAccuracyGate(metrics, reference.reviewed === true);
	if (original.failures?.some((f) => f.includes('replayed')))
		failures.push('initial melody replayed; not a release evaluation');
	save('rescored.json', {
		derivedFromSha256: hash(originalText),
		previousReferenceSha256: original.referenceSha256,
		referenceSha256: hash(JSON.stringify(reference)),
		reference,
		metrics,
		failures
	});
	console.log(JSON.stringify({ metrics, failures }, null, 2));
	process.exit(failures.length ? 2 : 0);
}
const reference = option('--reference')
	? JSON.parse(fs.readFileSync(option('--reference'), 'utf8'))
	: null;
if (reference?.tuneFile)
	reference.sheet = JSON.parse(
		fs.readFileSync(path.resolve(path.dirname(option('--reference')), reference.tuneFile), 'utf8')
	);

const declaredMeter = reference?.doc?.timeSignature ?? reference?.sheet?.timeSignature ?? [4, 4];
const vendor = path.join(repo, 'node_modules/pdfjs-dist');
const server = http.createServer((request, response) => {
	try {
		const url = new URL(request.url, 'http://localhost').pathname;
		if (url === '/') return response.end('<!doctype html><title>PDF accuracy evaluation</title>');
		if (url === '/chart.pdf') {
			response.setHeader('Content-Type', 'application/pdf');
			return response.end(fs.readFileSync(pdf));
		}
		response.setHeader('Content-Type', 'application/javascript');
		if (url === '/vendor/build/pdf.mjs' || url === '/vendor/build/pdf.worker.mjs')
			return response.end(fs.readFileSync(path.join(vendor, url.slice(8))));
		if (!url.startsWith('/src/lib/')) {
			response.statusCode = 404;
			return response.end();
		}
		const file = path.join(repo, url) + (path.extname(url) ? '' : '.ts');
		const code = fs
			.readFileSync(file, 'utf8')
			.replaceAll("'pdfjs-dist'", "'/vendor/build/pdf.mjs'")
			.replaceAll("'pdfjs-dist/build/pdf.worker.mjs'", "'/vendor/build/pdf.worker.mjs'")
			.replace(/(['"])\$lib\//g, '$1/src/lib/');
		response.end(
			ts.transpileModule(code, {
				compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
			}).outputText
		);
	} catch {
		response.statusCode = 500;
		response.end('Could not serve evaluation module');
	}
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
let extraction;
try {
	const page = await browser.newPage();
	await page.goto(`http://127.0.0.1:${server.address().port}`);
	extraction = await page.evaluate(async (meter) => {
		const { extractPdfSystems } = await import('/src/lib/tunes/import/pdf-system-extract.ts');
		return extractPdfSystems(await (await fetch('/chart.pdf')).arrayBuffer(), undefined, meter);
	}, declaredMeter);
} finally {
	await browser.close();
	server.close();
}
save('layout.json', extraction);
if (!extraction) {
	console.log(
		'Layout uncertain: app would use whole-PDF recognition. No fixed skeleton evaluated.'
	);
	process.exitCode = 2;
} else {
	console.log(
		`Layout: ${extraction.systems.map((s) => s.geometry.barlines.length).join(', ')} measures per line`
	);
	if (args.includes('--live') || args.includes('--glyphs-only')) {
		if (args.includes('--live') && !process.env.ANTHROPIC_API_KEY)
			throw new Error('ANTHROPIC_API_KEY is required for --live');
		const { createAnthropicSystemRecognizer } = await import(
			'../src/lib/server/pdf-import/anthropic-system.ts'
		);
		const { embeddedHeader, embeddedSystemResult, recognizeExtractedSystem } = await import(
			'../src/lib/tunes/import/pdf-embedded.ts'
		);
		const { runContextualTranscriptions } = await import(
			'../src/lib/tunes/import/pdf-context-run.ts'
		);
		const { assembleClaudeDoc } = await import('../src/lib/tunes/import/pdf-system-assemble.ts');
		const { claudeJsonToTune } = await import('../src/lib/tunes/import/claude-pdf.ts');
		const { measurePdfAccuracy, pdfAccuracyGate } = await import(
			'../src/lib/tunes/import/pdf-accuracy.ts'
		);
		const { writtenSheetToConcert } = await import('../src/lib/tunes/source-transposition.ts');
		const { INSTRUMENTS } = await import('../src/lib/types/instruments.ts');
		if (reference) save('reference.json', reference);
		const expected = reference?.doc ? claudeJsonToTune(reference.doc).sheet : reference?.sheet;
		const systems = extraction.systems.slice(
			0,
			Number(option('--systems', extraction.systems.length))
		);
		const runs = Number(option('--runs', 1));
		if (!Number.isInteger(runs) || runs < 1 || runs > 10 || !systems.length)
			throw new Error('Use 1–10 runs and at least one system');
		const client = args.includes('--live') ? new Anthropic({ maxRetries: 0 }) : null;
		const replayPath = option('--replay-first-pass');
		const replay = replayPath ? JSON.parse(fs.readFileSync(replayPath, 'utf8')) : null;
		for (let run = 1; run <= runs; run++) {
			const replayMelody = replay ? createMelodyReplay(replay) : null;
			const raw = [],
				started = Date.now();
			const recordedClient = {
				messages: {
					stream(input, options) {
						return {
							async finalMessage() {
								const start = Date.now();
								let seed = null;
								try {
									seed = replayMelody?.(input) ?? null;
									if (seed?.error) throw new Error(seed.error);
									if (seed && !seed.response)
										throw new Error('Recorded melody attempt has no outcome');
									const response =
										seed?.response ?? (await client.messages.stream(input, options).finalMessage());
									raw.push({ input, response, replayed: !!seed, elapsedMs: Date.now() - start });
									save(`run-${run}-raw.json`, raw);
									return response;
								} catch (error) {
									raw.push({
										input,
										error: error.message,
										replayed: !!seed,
										elapsedMs: Date.now() - start
									});
									save(`run-${run}-raw.json`, raw);
									throw error;
								}
							}
						};
					}
				}
			};
			const recognizer = args.includes('--glyphs-only')
				? {
						id: 'embedded-pdf-glyphs',
						recognize() {
							throw new Error('No model calls in glyph-only evaluation');
						}
					}
				: createAnthropicSystemRecognizer(recordedClient);
			const result = await runContextualTranscriptions({
				count: systems.length,
				attempts: 1,
				initialContext: { fifths: null, clef: null, timeSignature: declaredMeter },
				readContext(index, signal) {
					const s = systems[index],
						header = embeddedHeader(s);
					if (header || args.includes('--glyphs-only')) return Promise.resolve(header);
					return recognizer.recognize(
						{
							image: s.headerImage,
							barCount: s.geometry.barlines.length,
							timeSignature: declaredMeter,
							contextOnly: true
						},
						signal
					);
				},
				transcribe(index, context, signal) {
					const s = systems[index];
					return recognizeExtractedSystem(
						s,
						context,
						args.includes('--glyphs-only')
							? undefined
							: (harmonyOnly) =>
									recognizer.recognize(
										{
											image: s.image,
											barCount: s.geometry.barlines.length,
											timeSignature: context.timeSignature ?? [4, 4],
											first: index === 0,
											context,
											barEvidence: s.evidence,
											barImages: s.barImages,
											harmonyImages: s.sourceBarImages,
											readHarmony: s.texts.chords.length === 0,
											readAccidentals: !harmonyOnly,
											harmonyOnly
										},
										signal
									),
						null,
						signal
					);
				}
			});
			const doc = assembleClaudeDoc(
				systems.map((s, i) => ({
					...s,
					model: {
						fifths: result.results[i]?.keySignature?.fifths ?? null,
						bars: result.results[i]?.bars ?? []
					},
					harmony: result.results[i]?.harmony
				})),
				{
					title: extraction.title ?? path.basename(pdf),
					timeSignature: reference?.doc?.timeSignature ?? reference?.sheet?.timeSignature ?? [4, 4]
				}
			);
			const converted = claudeJsonToTune(doc);
			const sheet =
				converted.sheet &&
				writtenSheetToConcert(converted.sheet, option('--source', 'C'), INSTRUMENTS['tenor-sax']);
			const metrics = expected && sheet ? measurePdfAccuracy(expected, sheet) : null;
			const failures = metrics
				? pdfAccuracyGate(metrics, reference.reviewed === true)
				: ['no comparable reference or output'];
			if (args.includes('--glyphs-only') && systems.some((s) => !embeddedSystemResult(s)))
				failures.push('incomplete embedded notation coverage');
			if (replay) failures.push('initial melody replayed; not a release evaluation');
			const report = {
				provider: recognizer.id,
				elapsedMs: Date.now() - started,
				result,
				sheet,
				metrics,
				failures,
				referenceSha256: reference ? hash(JSON.stringify(reference)) : null
			};
			save(`run-${run}.json`, report);
			console.log(JSON.stringify({ run, elapsedMs: report.elapsedMs, metrics, failures }, null, 2));
			if (failures.length) process.exitCode = 2;
		}
	}
}
