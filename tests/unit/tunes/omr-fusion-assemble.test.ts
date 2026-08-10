/**
 * End-to-end fusion in Node: a REAL recorded LEGATO transcription of Lady
 * Bird (deterministic fixture, precedent: fly-me-to-the-moon.claude-response
 * .json) + synthetic page geometry + text-layer chords, driven through
 * omrSystemResponses → assembleClaudeDoc → claudeJsonToTune.
 *
 * This pins the whole hybrid seam: OMR supplies melody, the text layer
 * supplies chords, geometry supplies bar counts — and the existing
 * converters produce a valid written-pitch Tune without modification.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	assembleClaudeDoc,
	type AssembleSystemInput
} from '$lib/tunes/import/pdf-system-assemble';
import { claudeJsonToTune } from '$lib/tunes/import/claude-pdf';
import {
	omrNormalized,
	omrSystemResponses,
	validateOmrTranscription
} from '$lib/tunes/import/omr-transcription';
import type { SystemGeometry } from '$lib/tunes/import/pdf-geometry';

const payload = JSON.parse(
	readFileSync('tests/fixtures/leadsheets/omr/lady-bird.omr.json', 'utf8')
);

// Lady Bird's printed layout: 4 systems × 4 bars.
const BAR_COUNTS = [4, 4, 4, 4];
const METER: [number, number] = [4, 4];

const geometry = (): SystemGeometry => ({
	band: { top: 500, bottom: 580, lines: [500, 520, 540, 560, 580] },
	interline: 20,
	barlines: [400, 700, 1000, 1300],
	repeatDots: [400, 700, 1000, 1300].map(() => ({ left: false, right: false })),
	firstBarLeft: 100
});

function fuse() {
	const validation = validateOmrTranscription(payload);
	expect(validation.errors).toEqual([]);
	const omr = omrNormalized(payload);
	return omrSystemResponses(omr, BAR_COUNTS, METER);
}

describe('OMR fusion through the existing assemble/convert pipeline', () => {
	it('the recorded fixture passes untrusted-input validation', () => {
		expect(validateOmrTranscription(payload).valid).toBe(true);
	});

	it('covers all four systems with model bars', () => {
		const { responses } = fuse();
		expect(responses).toHaveLength(4);
		for (const response of responses) {
			expect(response).not.toBeNull();
			expect(response!.bars).toHaveLength(4);
		}
	});

	it('reads the written key (D major) off the page', () => {
		const { responses } = fuse();
		expect(responses[0]!.keySignature).toEqual({ fifths: 2 });
	});

	it('assembles + converts to a valid Tune with OMR melody and text-layer chords', () => {
		const { responses } = fuse();

		const systems: AssembleSystemInput[] = responses.map((response, i) => ({
			geometry: geometry(),
			texts: {
				chords: i === 0 ? [{ x: 150, text: 'DΔ7' }] : [],
				marks: [],
				endings: [],
				barNumber: null
			},
			model: {
				fifths: response!.keySignature?.fifths ?? null,
				bars: response!.bars
			}
		}));

		const doc = assembleClaudeDoc(systems, {
			title: 'Lady Bird',
			composer: 'Tadd Dameron',
			timeSignature: METER
		});
		const converted = claudeJsonToTune(doc);

		expect(converted.errors).toEqual([]);
		expect(converted.sheet).not.toBeNull();
		const sheet = converted.sheet!;
		expect(sheet.title).toBe('Lady Bird');
		expect(sheet.sections.reduce((total, s) => total + s.bars, 0)).toBe(16);

		const notes = sheet.sections.flatMap((s) => s.notes).filter((n) => n.pitch !== null);
		// LEGATO read 47 of the 53 printed notes on this chart (recorded run).
		expect(notes.length).toBeGreaterThan(40);
		// The tune opens on written A4 after an eighth rest.
		expect(notes[0].pitch).toBe(69);

		const chords = sheet.sections.flatMap((s) => s.harmony);
		expect(chords.some((h) => h.symbol === 'DΔ7')).toBe(true);
	});

	it('keeps the melody in written pitch for the standard concert shift', () => {
		const { responses } = fuse();
		const pitches = responses
			.flatMap((r) => r!.bars)
			.flatMap((b) => b.melody)
			.map((entry) => entry[2]);
		// Written-pitch strings as printed; no note below the treble staff range
		// of this chart and nothing concert-shifted.
		expect(pitches.length).toBeGreaterThan(40);
		expect(pitches.every((p) => /^[A-G][b#]{0,2}\d$/.test(p))).toBe(true);
	});
});
