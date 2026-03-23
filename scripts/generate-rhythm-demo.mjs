#!/usr/bin/env node
/**
 * Generate a WAV file demonstrating the new rhythm scoring formula.
 *
 * Plays a click track at 120 BPM with a melody note at various offsets
 * from the beat, so you can hear what "half a beat off" etc. actually
 * sounds like — and see the old vs new scores.
 *
 * Usage:  node scripts/generate-rhythm-demo.mjs
 * Output: scripts/rhythm-demo.wav
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Audio constants ──────────────────────────────────────
const SAMPLE_RATE = 44100;
const TEMPO = 120;
const BEAT_DUR = 60 / TEMPO; // 0.5s
const NUM_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

// ── Scoring formulas ─────────────────────────────────────
function oldScore(timingErrorBeats) {
	return Math.max(0, 1.0 - timingErrorBeats * 1.5);
}
function newScore(timingErrorBeats, tempo = TEMPO) {
	const penalty = Math.min(1.0, 0.5 + tempo / 300);
	return Math.max(0, 1.0 - timingErrorBeats * penalty);
}

// ── Synthesis helpers ────────────────────────────────────
function sine(freq, duration, amplitude = 0.4) {
	const samples = Math.floor(duration * SAMPLE_RATE);
	const buf = new Float64Array(samples);
	const fadeLen = Math.min(Math.floor(0.005 * SAMPLE_RATE), samples); // 5ms fade
	for (let i = 0; i < samples; i++) {
		buf[i] = amplitude * Math.sin(2 * Math.PI * freq * i / SAMPLE_RATE);
		// fade in
		if (i < fadeLen) buf[i] *= i / fadeLen;
		// fade out
		if (i >= samples - fadeLen) buf[i] *= (samples - 1 - i) / fadeLen;
	}
	return buf;
}

function click(amplitude = 0.5) {
	// Short high-pitched click: 2000 Hz, 15ms
	return sine(2000, 0.015, amplitude);
}

function melodyTone(freq = 440, duration = 0.25) {
	return sine(freq, duration, 0.45);
}

// ── Mix into buffer ──────────────────────────────────────
class AudioBuffer {
	constructor(durationSec) {
		this.length = Math.ceil(durationSec * SAMPLE_RATE);
		this.data = new Float64Array(this.length);
	}
	mix(source, offsetSec) {
		const start = Math.floor(offsetSec * SAMPLE_RATE);
		for (let i = 0; i < source.length && start + i < this.length; i++) {
			if (start + i >= 0) {
				this.data[start + i] += source[i];
			}
		}
	}
	toWav() {
		// Clamp and convert to 16-bit PCM
		const pcm = new Int16Array(this.length);
		for (let i = 0; i < this.length; i++) {
			const s = Math.max(-1, Math.min(1, this.data[i]));
			pcm[i] = s < 0 ? s * 32768 : s * 32767;
		}
		const dataSize = pcm.length * 2;
		const header = Buffer.alloc(44);
		header.write('RIFF', 0);
		header.writeUInt32LE(36 + dataSize, 4);
		header.write('WAVE', 8);
		header.write('fmt ', 12);
		header.writeUInt32LE(16, 16); // chunk size
		header.writeUInt16LE(1, 20);  // PCM
		header.writeUInt16LE(NUM_CHANNELS, 22);
		header.writeUInt32LE(SAMPLE_RATE, 24);
		header.writeUInt32LE(SAMPLE_RATE * NUM_CHANNELS * BITS_PER_SAMPLE / 8, 28);
		header.writeUInt16LE(NUM_CHANNELS * BITS_PER_SAMPLE / 8, 32);
		header.writeUInt16LE(BITS_PER_SAMPLE, 34);
		header.write('data', 36);
		header.writeUInt32LE(dataSize, 40);
		return Buffer.concat([header, Buffer.from(pcm.buffer)]);
	}
}

// ── Demo sections ────────────────────────────────────────
// Each section: 1 bar of clicks + melody note at a specific offset
// Then 1 beat of silence before next section.

const sections = [
	{ label: 'Perfect timing',        offsetBeats: 0,     freq: 440   },
	{ label: '0.1 beats early',       offsetBeats: -0.1,  freq: 440   },
	{ label: '0.25 beats late',       offsetBeats: 0.25,  freq: 440   },
	{ label: '0.5 beats late',        offsetBeats: 0.5,   freq: 440   },
	{ label: '0.67 beats late (old 0%)', offsetBeats: 0.667, freq: 440 },
	{ label: '1.0 beat late',         offsetBeats: 1.0,   freq: 440   },
	{ label: '1.2 beats late (new 0%)', offsetBeats: 1.2,  freq: 440  },
];

// Calculate total duration: each section = 4 beats + 2 beats gap
const SECTION_BEATS = 4;
const GAP_BEATS = 2;
const totalBeats = sections.length * (SECTION_BEATS + GAP_BEATS) + 2; // extra pad
const totalDuration = totalBeats * BEAT_DUR + 2; // +2s buffer

const buf = new AudioBuffer(totalDuration);
const clickSound = click();
const tone = melodyTone(440, 0.3);

let cursor = 0; // current time in seconds
const annotations = [];

for (const section of sections) {
	const sectionStart = cursor;

	// 4 beats of clicks
	for (let beat = 0; beat < SECTION_BEATS; beat++) {
		buf.mix(clickSound, cursor + beat * BEAT_DUR);
	}

	// Melody note expected on beat 1 (the second beat, index 1)
	const expectedOnset = cursor + 1 * BEAT_DUR;
	const actualOnset = expectedOnset + section.offsetBeats * BEAT_DUR;
	buf.mix(tone, actualOnset);

	// Calculate scores
	const errBeats = Math.abs(section.offsetBeats);
	const old = oldScore(errBeats);
	const nw = newScore(errBeats);

	annotations.push({
		label: section.label,
		timingError: `${section.offsetBeats >= 0 ? '+' : ''}${section.offsetBeats.toFixed(2)} beats (${(section.offsetBeats * BEAT_DUR * 1000).toFixed(0)}ms)`,
		oldScore: `${(old * 100).toFixed(0)}%`,
		newScore: `${(nw * 100).toFixed(0)}%`,
		time: `${sectionStart.toFixed(1)}s`
	});

	cursor += (SECTION_BEATS + GAP_BEATS) * BEAT_DUR;
}

// Write WAV
const outPath = join(__dirname, 'rhythm-demo.wav');
writeFileSync(outPath, buf.toWav());

// Print summary
console.log(`\nGenerated: ${outPath}`);
console.log(`Tempo: ${TEMPO} BPM (beat = ${(BEAT_DUR * 1000).toFixed(0)}ms)\n`);
console.log('Each section: 4-beat click track, melody note expected on beat 2.\n');
console.log('Section'.padEnd(30) + 'Offset'.padEnd(22) + 'Old Score'.padEnd(12) + 'New Score');
console.log('─'.repeat(76));
for (const a of annotations) {
	console.log(
		`${a.label.padEnd(30)}${a.timingError.padEnd(22)}${a.oldScore.padEnd(12)}${a.newScore}`
	);
}
console.log('\nListen for the tone relative to the click — hear how the "old 0%" cases');
console.log('are still quite close to the beat, while the "new 0%" is clearly wrong.\n');
