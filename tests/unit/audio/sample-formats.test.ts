import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
	SAMPLE_MAPS,
	DRUM_BUFFERS,
	DRUM_ARTICULATIONS,
	drumBufferForVelocity,
	layerToBuffers,
	getTuneCorrection,
	type SampleMap
} from '$lib/audio/sample-maps';

/**
 * Every shipped audio sample must be in a codec that EVERY browser we support
 * can decode through `decodeAudioData`.
 *
 * This exists because three drum samples shipped as Ogg **FLAC** while the
 * other 196 files were Ogg **Opus**. Safari/WebKit cannot decode FLAC-in-Ogg
 * via Web Audio, so the drum kit silently failed to load for every Safari user
 * — and the visible symptom was a misleading `/kick.ogg` 404, because smplr
 * falls back to `baseUrl("") + name + ".ogg"` when a buffer fails to decode.
 *
 * A unit test can't run a decoder, but it can check the codec identifier in the
 * container, which is the actual invariant that broke. The browser side is
 * proven separately in `tests/e2e/audio-sample-decode.spec.ts`.
 */

const SAMPLES_ROOT = join(process.cwd(), 'static', 'samples');

/** Codec identifiers that appear in the first Ogg page's header packet. */
const CODEC_SIGNATURES: ReadonlyArray<{ magic: Buffer; name: string }> = [
	{ magic: Buffer.from('OpusHead', 'ascii'), name: 'Opus' },
	{ magic: Buffer.from([0x7f, 0x46, 0x4c, 0x41, 0x43]), name: 'FLAC' }, // \x7fFLAC
	{ magic: Buffer.from([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]), name: 'Vorbis' }, // \x01vorbis
	{ magic: Buffer.from('Speex   ', 'ascii'), name: 'Speex' }
];

/**
 * Codecs `decodeAudioData` handles in Chromium, Firefox AND WebKit.
 * FLAC-in-Ogg is deliberately absent — that is the bug this file guards.
 */
const DECODABLE_EVERYWHERE = new Set(['Opus', 'Vorbis']);

function listOggFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...listOggFiles(full));
		else if (entry.endsWith('.ogg')) out.push(full);
	}
	return out;
}

function codecOf(file: string): string {
	const head = readFileSync(file).subarray(0, 128);
	if (head.subarray(0, 4).toString('ascii') !== 'OggS') return 'not-ogg';
	for (const { magic, name } of CODEC_SIGNATURES) {
		if (head.includes(magic)) return name;
	}
	return 'unknown';
}

describe('shipped audio samples', () => {
	const files = listOggFiles(SAMPLES_ROOT);

	it('finds the sample tree (guards against a silently-empty sweep)', () => {
		// Without this, a bad root path would make every assertion below vacuous.
		expect(files.length).toBeGreaterThan(150);
	});

	it('ships only codecs that every supported browser can decode', () => {
		const offenders = files
			.map((f) => ({ file: f.replace(`${process.cwd()}/`, ''), codec: codecOf(f) }))
			.filter(({ codec }) => !DECODABLE_EVERYWHERE.has(codec));

		expect(
			offenders,
			`Ogg files in a codec some browser cannot decode via decodeAudioData.\n` +
				`FLAC-in-Ogg fails in Safari/WebKit and takes the whole instrument down ` +
				`silently. Re-encode to Opus:\n` +
				`  ffmpeg -i in.ogg -c:a libopus -b:a 128k -vbr on -application audio out.ogg\n` +
				`(omit -ac/-ar so the source channel count and rate are preserved)`
		).toEqual([]);
	});

	it('keeps the drum kit specifically in Opus', () => {
		// Named separately so a regression on these three reports as itself
		// rather than as one entry in a list of 199.
		for (const name of ['kick', 'ride', 'hihat']) {
			expect(codecOf(join(SAMPLES_ROOT, 'drums', `${name}.ogg`)), name).toBe('Opus');
		}
	});
});

describe('sample maps', () => {
	it('every mapped URL resolves to a shipped file', () => {
		// A wrong URL is the same silent death as a bad codec: smplr falls back
		// to a misleading `/<name>.ogg` 404 and the instrument never sounds.
		const missing: string[] = [];
		const check = (url: string) => {
			if (!existsSync(join(process.cwd(), 'static', url))) missing.push(url);
		};
		for (const map of Object.values(SAMPLE_MAPS)) {
			for (const layer of [map.piano, map.forte]) {
				for (const region of Object.values(layer)) check(region.url);
			}
		}
		for (const url of Object.values(DRUM_BUFFERS)) check(url);
		expect(missing).toEqual([]);
	});

	it('piano and forte layers of every instrument cover the same notes', () => {
		for (const [id, map] of Object.entries(SAMPLE_MAPS)) {
			expect(Object.keys(map.forte), id).toEqual(Object.keys(map.piano));
		}
	});

	it('layerToBuffers keys the layer by letter note names, which smplr can parse', () => {
		const buffers = layerToBuffers({
			44: { url: '/a.ogg', tune: 0 },
			60: { url: '/b.ogg', tune: 0 },
			76: { url: '/c.ogg', tune: 0 }
		});
		expect(buffers).toEqual({ 'G#2': '/a.ogg', C4: '/b.ogg', E5: '/c.ogg' });
	});

	it('getTuneCorrection routes exactly the split velocity to the piano layer', () => {
		// velocity 100 == velocitySplit 100 is PIANO. This boundary is the one
		// the tenor layers coin-flipped across per note while the split was
		// compared against the jittered gain velocity.
		const map: SampleMap = {
			velocitySplit: 100,
			piano: { 60: { url: '/p.ogg', tune: -10 } },
			forte: { 60: { url: '/f.ogg', tune: 7 } }
		};
		expect(getTuneCorrection(map, 60, 100)).toBe(-10);
		expect(getTuneCorrection(map, 60, 101)).toBe(7);
		expect(getTuneCorrection(map, 61, 100)).toBe(0);
	});

	it('drumBufferForVelocity picks the layer whose band holds the velocity, top bound inclusive', () => {
		expect(drumBufferForVelocity('ride', 0.38)).toBe('ride_soft');
		expect(drumBufferForVelocity('ride', 0.381)).toBe('ride');
		expect(drumBufferForVelocity('ride', 0.72)).toBe('ride');
		expect(drumBufferForVelocity('ride', 0.721)).toBe('ride_acc');
		expect(drumBufferForVelocity('snare', 0.3)).toBe('snare_ghost');
		expect(drumBufferForVelocity('snare', 0.62)).toBe('snare_med');
		expect(drumBufferForVelocity('snare', 0.63)).toBe('snare_acc');
		// Past every band: the loudest layer, never undefined.
		expect(drumBufferForVelocity('ride', 1.2)).toBe('ride_acc');
	});

	it("every voice's layers ascend in maxVelocity and end at 1, so the lookup is total", () => {
		for (const [voice, layers] of Object.entries(DRUM_ARTICULATIONS)) {
			for (let i = 1; i < layers.length; i++) {
				expect(layers[i].maxVelocity, voice).toBeGreaterThan(layers[i - 1].maxVelocity);
			}
			expect(layers[layers.length - 1].maxVelocity, voice).toBe(1);
		}
	});
});
