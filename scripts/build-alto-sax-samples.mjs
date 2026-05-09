#!/usr/bin/env node
/**
 * Extract alto saxophone samples from the MTG.SoloSax SFZ library and convert
 * to OGG/Opus 48kbps mono for web playback. Mirrors the (undocumented) workflow
 * used to produce the existing tenor sax samples in static/samples/tenor-sax/.
 *
 * Prerequisites:
 *   1. Clone the upstream once:
 *        git clone https://github.com/sfzinstruments/MTG.SoloSax.git ~/MTG.SoloSax
 *   2. ffmpeg with libopus must be on PATH (`ffmpeg -codecs | grep opus`).
 *
 * Usage:
 *   node scripts/build-alto-sax-samples.mjs                   # uses ~/MTG.SoloSax
 *   node scripts/build-alto-sax-samples.mjs --repo <path>     # custom checkout
 *   node scripts/build-alto-sax-samples.mjs --dry-run         # just print the snippet
 *
 * Output:
 *   - 64 OGG files at static/samples/alto-sax/{p,f}_<midi>.ogg (MIDI 49–80)
 *   - TypeScript snippet for ALTO_SAX_SAMPLES printed to stdout
 *
 * Source: MTG.SoloSax (CC-BY 4.0).  https://github.com/sfzinstruments/MTG.SoloSax
 */

import { mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// MIDI range for the alto sax voice (concert pitch).  Matches
// src/lib/types/instruments.ts:48-49 (concertRangeLow=49, concertRangeHigh=80).
// The upstream SFZ covers 49–81 inclusive; we drop 81 to stay within the
// configured instrument range (smplr will pitch-shift the top sample if needed).
const MIDI_LOW = 49;
const MIDI_HIGH = 80;

// SFZ velocity layer split — `<group> hivel=100` for piano, `<group> lovel=101`
// for forte.  Matches src/lib/audio/sample-maps.ts velocitySplit (100).
const DYNAMICS = /** @type {const} */ (['p', 'f']);

// ── Argument parsing ───────────────────────────────────────────
const args = process.argv.slice(2);
let repoPath = join(homedir(), 'MTG.SoloSax');
let dryRun = false;
for (let i = 0; i < args.length; i++) {
	if (args[i] === '--repo') repoPath = resolve(args[++i] ?? '');
	else if (args[i] === '--dry-run') dryRun = true;
	else if (args[i] === '--help' || args[i] === '-h') {
		console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 21).join('\n').replace(/^ \*\s?/gm, ''));
		process.exit(0);
	} else {
		console.error(`[build-alto-sax-samples] Unknown argument: ${args[i]}`);
		process.exit(1);
	}
}

const SAX_ROOT = join(repoPath, 'MTG Solo Saxophones');
const DATA_DIR = join(SAX_ROOT, 'Data');
const SAMPLES_DIR = join(SAX_ROOT, 'Samples');
const OUT_DIR = resolve(REPO_ROOT, 'static/samples/alto-sax');

if (!existsSync(SAX_ROOT)) {
	console.error(`[build-alto-sax-samples] Cannot find MTG Solo Saxophones at: ${SAX_ROOT}`);
	console.error('Pass --repo <path-to-MTG.SoloSax> or clone to ~/MTG.SoloSax');
	process.exit(1);
}

// ── ffmpeg availability check ──────────────────────────────────
if (!dryRun) {
	const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
	if (probe.status !== 0) {
		console.error('[build-alto-sax-samples] ffmpeg not found on PATH');
		process.exit(1);
	}
}

// ── Parse SFZ region file ──────────────────────────────────────
/**
 * Read one SFZ regions file (e.g., alt_p_rr1.txt) and extract per-key sample
 * index and tuning-cents value.  Returns a Map<midi, { sampleIndex, tune }>
 * filtered to the configured MIDI range.
 *
 * Region line format:
 *   <region> region_label=NN_rr1 seq_position=1 key=KK sample=alt_<dyn>_NN.$EXT [volume=V] [tune=T]
 *
 * `tune` is omitted when zero (see e.g. alt_p_rr1.txt key=70).  Default to 0
 * in that case to match the SFZ semantics.
 */
function parseRegions(dynamic) {
	const path = join(DATA_DIR, `alt_${dynamic}_rr1.txt`);
	if (!existsSync(path)) {
		console.error(`[build-alto-sax-samples] Missing SFZ data file: ${path}`);
		process.exit(1);
	}
	const text = readFileSync(path, 'utf8');
	const map = new Map();
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('<region>')) continue;
		const keyMatch = trimmed.match(/key=(-?\d+)/);
		const sampleMatch = trimmed.match(new RegExp(`sample=alt_${dynamic}_(\\d+)\\.`));
		const tuneMatch = trimmed.match(/tune=(-?\d+)/);
		if (!keyMatch || !sampleMatch) continue;
		const midi = Number(keyMatch[1]);
		if (midi < MIDI_LOW || midi > MIDI_HIGH) continue;
		map.set(midi, {
			sampleIndex: sampleMatch[1], // keep zero-padding from SFZ
			tune: tuneMatch ? Number(tuneMatch[1]) : 0
		});
	}
	return map;
}

// ── Convert one FLAC to OGG/Opus ───────────────────────────────
function convert(flacPath, oggPath) {
	const result = spawnSync(
		'ffmpeg',
		['-y', '-i', flacPath, '-ac', '1', '-c:a', 'libopus', '-b:a', '48k', oggPath],
		{ stdio: ['ignore', 'ignore', 'pipe'] }
	);
	if (result.status !== 0) {
		console.error(`[build-alto-sax-samples] ffmpeg failed for ${flacPath}`);
		console.error(result.stderr?.toString());
		process.exit(1);
	}
}

// ── Main pipeline ──────────────────────────────────────────────
if (!dryRun) mkdirSync(OUT_DIR, { recursive: true });

const layers = {};

for (const dynamic of DYNAMICS) {
	const regions = parseRegions(dynamic);
	const layerName = dynamic === 'p' ? 'piano' : 'forte';
	const entries = [];

	for (let midi = MIDI_LOW; midi <= MIDI_HIGH; midi++) {
		const region = regions.get(midi);
		if (!region) {
			console.warn(`[build-alto-sax-samples] Missing SFZ region for ${dynamic} MIDI ${midi}`);
			continue;
		}
		const flacPath = join(SAMPLES_DIR, `alt_${dynamic}_${region.sampleIndex}.flac`);
		const oggPath = join(OUT_DIR, `${dynamic}_${midi}.ogg`);

		if (!existsSync(flacPath)) {
			console.error(`[build-alto-sax-samples] Missing source sample: ${flacPath}`);
			process.exit(1);
		}

		if (!dryRun) {
			convert(flacPath, oggPath);
			const size = statSync(oggPath).size;
			console.log(`[build-alto-sax-samples] ${dynamic}_${midi}.ogg  ${size.toString().padStart(6)} bytes  tune=${region.tune}`);
		}
		entries.push({ midi, tune: region.tune });
	}
	layers[layerName] = entries;
}

// ── Emit TypeScript snippet ────────────────────────────────────
function formatLayer(name, entries) {
	const lines = entries.map(({ midi, tune }) => `\t\t${midi}: { url: '/samples/alto-sax/${name === 'piano' ? 'p' : 'f'}_${midi}.ogg', tune: ${tune} }`);
	return `\t${name}: {\n${lines.join(',\n')}\n\t}`;
}

const snippet = `/**
 * Alto saxophone sample map.
 *
 * 32 chromatic samples (MIDI 49–80, Db3–G#5 concert pitch) at 2 velocity layers.
 * Tuning corrections from the MTG SFZ mappings compensate for the original
 * A=442 Hz recording pitch and per-note intonation variance.
 */
export const ALTO_SAX_SAMPLES: SampleMap = {
\tvelocitySplit: 100,
${formatLayer('piano', layers.piano)},
${formatLayer('forte', layers.forte)}
};`;

console.log('\n// ─── paste into src/lib/audio/sample-maps.ts below TENOR_SAX_SAMPLES ───\n');
console.log(snippet);
console.log('\n// then update SAMPLE_MAPS:\n');
console.log(`export const SAMPLE_MAPS: Record<string, SampleMap> = {\n\t'tenor-sax': TENOR_SAX_SAMPLES,\n\t'alto-sax': ALTO_SAX_SAMPLES\n};`);

if (!dryRun) {
	console.log(`\n[build-alto-sax-samples] Wrote ${layers.piano.length + layers.forte.length} files to ${OUT_DIR}`);
}
