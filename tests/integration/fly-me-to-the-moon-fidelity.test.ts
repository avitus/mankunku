/**
 * Import fidelity against the DEV DATA LAYER: "Fly Me to the Moon".
 *
 * The ground truth is the user's own sheet exported from the dev
 * environment's storage (fly-me-to-the-moon.entered.json, 2026-07-22,
 * bar-4 melody fix included): harmony imported from Band-in-a-Box, melody
 * hand-entered from the printed tenor chart. Each importer is validated
 * against it at the full fidelity its source carries:
 *
 *  - Band-in-a-Box (.SGU): chords + form only. Must match the dev layer
 *    EXACTLY — the dev harmony came from this very file.
 *  - MuseScore (.mscz): melody + chords. Melody must match note-for-note
 *    (concert pitch, rhythms, ties). Harmony matches modulo the spots where
 *    the ENGRAVED CHART genuinely differs from the BIAB grid — enumerated
 *    below as named edits, so any NEW divergence fails the test.
 *  - PDF (recorded claude-opus-4-8 extraction + the Bb source transform):
 *    chords at print fidelity (same two print edits), melody at extraction
 *    fidelity (opening phrase exact; rhythm drifts mid-form, which is why
 *    the flow mandates human review).
 *
 * The print-vs-BIAB divergences (verified bar by bar against the chart):
 *  1. Bar 12 of A prints a single A7 on the downbeat where the BIAB grid
 *     has Em7 / A7 split on beats 1 and 3.
 *  2. The print has no final-bar turnaround in B (the BIAB grid adds
 *     Bm7b5 / E7b9 in bar 16); the closing Cmaj7 runs out the form.
 *  3. MuseScore anchors bar 8's second chord to its melody note (beat 4),
 *     not the printed visual beat 3 — the .mscz stores it there.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMuseScoreFile } from '$lib/leadsheets/import/musescore';
import { parseBiabFile } from '$lib/leadsheets/import/biab';
import { claudeJsonToLeadSheet } from '$lib/leadsheets/import/claude-pdf';
import { writtenSheetToConcert } from '$lib/leadsheets/source-transposition';
import { INSTRUMENTS } from '$lib/types/instruments';
import { fractionToFloat } from '$lib/music/intervals';
import type { Tune } from '$lib/types/tune';

const fixture = (name: string): string =>
	fileURLToPath(new URL(`../fixtures/leadsheets/${name}`, import.meta.url));

const DEV = JSON.parse(readFileSync(fixture('fly-me-to-the-moon.entered.json'), 'utf8')) as Tune;

type Section = Tune['sections'][number];

/** Melody in comparable form: concert pitch, exact fractions, tie flags. */
const melody = (sec: Section) =>
	sec.notes.map((n) => ({
		pitch: n.pitch,
		duration: n.duration,
		offset: n.offset,
		tied: n.tied ?? false
	}));

/** Harmony as change points: start/end beats (in whole notes) + chord identity. */
interface Change {
	at: number;
	until: number;
	root: string;
	quality: string;
}
const changes = (sec: Section): Change[] =>
	sec.harmony.map((h) => ({
		at: fractionToFloat(h.startOffset),
		until: fractionToFloat(h.startOffset) + fractionToFloat(h.duration),
		root: h.chord.root,
		quality: h.chord.quality
	}));

// ─── The named print-vs-BIAB edits (see header) ─────────────────────────

/** Edit 1: bar 12 of A prints one A7 on the downbeat, not Em7/A7. */
const bar12SingleA7 = (cs: Change[]): Change[] =>
	cs
		.filter((c) => !(c.at === 11 && c.quality === 'min7'))
		.map((c) => (c.at === 11.5 ? { ...c, at: 11 } : c));

/** Edit 2: the print's B section has no bar-16 turnaround. */
const noFinalTurnaround = (cs: Change[]): Change[] =>
	cs.filter((c) => c.at < 15).map((c) => (c.until === 15 ? { ...c, until: 16 } : c));

/** Edit 3: the .mscz anchors bar 8's second chord at its melody note (beat 4). */
const bar8AtBeat4 = (cs: Change[]): Change[] =>
	cs.map((c) => (c.at === 7.5 ? { ...c, at: 7.75 } : c.until === 7.5 ? { ...c, until: 7.75 } : c));

// ─── Band-in-a-Box: exact data-layer equality ───────────────────────────

describe('BIAB .SGU vs the dev data layer', () => {
	const sheet = parseBiabFile(new Uint8Array(readFileSync(fixture('fly-me-to-the-moon.sgu')))).sheets[0];

	it('reproduces the form exactly: sections, bars, chorus repeat', () => {
		expect(
			sheet.sections.map((s) => [s.label, s.bars, s.repeatStart ?? false, s.repeatEnd ?? false])
		).toEqual(DEV.sections.map((s) => [s.label, s.bars, s.repeatStart ?? false, s.repeatEnd ?? false]));
		expect(sheet.key).toBe(DEV.key);
		expect(sheet.timeSignature).toEqual(DEV.timeSignature);
		expect(sheet.style).toBe(DEV.style);
	});

	it('reproduces every chord change with its exact beat and duration', () => {
		for (let i = 0; i < DEV.sections.length; i++) {
			expect(changes(sheet.sections[i])).toEqual(changes(DEV.sections[i]));
		}
	});

	it('carries no melody (.SGU is a chord grid; the melody was entered by hand)', () => {
		for (const sec of sheet.sections) expect(sec.notes).toEqual([]);
	});
});

// ─── MuseScore: melody-lossless, harmony at print fidelity ──────────────

describe('MuseScore .mscz vs the dev data layer', () => {
	async function parseMscz(): Promise<Tune> {
		const bytes = new Uint8Array(readFileSync(fixture('fly-me-to-the-moon.mscz')));
		return (await parseMuseScoreFile({ name: 'fly-me-to-the-moon.mscz', bytes })).sheets[0];
	}

	it('matches the melody note-for-note in both sections', async () => {
		const sheet = await parseMscz();
		expect(melody(sheet.sections[0])).toEqual(melody(DEV.sections[0]));
		expect(melody(sheet.sections[1])).toEqual(melody(DEV.sections[1]));
	});

	it('matches the harmony modulo the three named print divergences', async () => {
		const sheet = await parseMscz();
		expect(changes(sheet.sections[0])).toEqual(bar8AtBeat4(bar12SingleA7(changes(DEV.sections[0]))));
		expect(changes(sheet.sections[1])).toEqual(bar8AtBeat4(noFinalTurnaround(changes(DEV.sections[1]))));
	});

	it('matches key and meter at concert pitch', async () => {
		const sheet = await parseMscz();
		expect(sheet.key).toBe(DEV.key);
		expect(sheet.timeSignature).toEqual(DEV.timeSignature);
	});
});

// ─── PDF: recorded extraction through the Bb source transform ───────────

describe('PDF extraction (Bb source) vs the dev data layer', () => {
	const RESPONSE = JSON.parse(
		readFileSync(fixture('fly-me-to-the-moon.claude-response.json'), 'utf8')
	);
	const sheet = writtenSheetToConcert(
		claudeJsonToLeadSheet(RESPONSE).sheet!,
		'Bb',
		INSTRUMENTS['tenor-sax']
	);

	it('matches the harmony modulo the two print divergences (bar 8 at the printed beat 3)', () => {
		expect(changes(sheet.sections[0])).toEqual(bar12SingleA7(changes(DEV.sections[0])));
		expect(changes(sheet.sections[1])).toEqual(noFinalTurnaround(changes(DEV.sections[1])));
	});

	it('matches the opening phrase at concert pitch', () => {
		const dev = melody(DEV.sections[0]);
		const imported = melody(sheet.sections[0]);
		// First three notes are exact; the fourth leads into a tied
		// anticipation the extraction simplifies to an on-beat value — the
		// documented rhythmic-drift class human review exists to correct.
		expect(imported.slice(0, 3)).toEqual(dev.slice(0, 3));
		expect(imported[3].pitch).toBe(dev[3].pitch);
		expect(imported[3].offset).toEqual(dev[3].offset);
	});

	it('matches key and form at concert pitch', () => {
		expect(sheet.key).toBe(DEV.key);
		expect(sheet.sections.map((s) => [s.label, s.bars])).toEqual([
			['A', 16],
			['B', 16]
		]);
	});
});
