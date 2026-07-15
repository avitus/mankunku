import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPhraseEndTicks } from '$lib/audio/playback';
import { BLUES_BLUE_NOTE_LICKS } from '$lib/data/licks';
import type { Phrase } from '$lib/types/music';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Regression test for the listening-window handoff in ear training.
 *
 * Diagnostic: 2026-07-08-four-to-five.{json,wav} — "Four to Five" (bbn-004)
 * at 105 BPM on tenor sax. The lick's melody ends at beat 5 (bar 2 beat 2)
 * but its harmony is a 2-bar blues vamp, and playPhrase's end-of-phrase
 * notification derived the end tick from getPhraseBars (max of melody and
 * harmony extents, rounded up to whole bars) + 1 beat. The app therefore
 * kept "playing" silence for 3 extra beats after the last note, and the
 * listening window opened ~0.7 s AFTER the user's natural echo entry at
 * the next bar downbeat. The recording caught only the last 2 of 4 notes
 * (first onset 0.5 s in), scoring 1/4 notes hit.
 *
 * The fix: ear training passes resolveAtMelodyEnd, ending the wait 1 beat
 * after the melody's last note instead of after the harmony vamp.
 */

interface Diagnostic {
	context: { phraseId: string; tempo: number };
}

function loadDiagnostic(): Diagnostic {
	const path = resolve(__dirname, '..', 'fixtures', 'recordings', '2026-07-08-four-to-five.json');
	return JSON.parse(readFileSync(path, 'utf8'));
}

const PPQ = 192; // Tone.js default transport PPQ
// enterAwaitingInput cooldown before the pitch detector restarts (see
// src/routes/ear-training/+page.svelte)
const COOLDOWN_S = 0.15;

describe('ear-training listening window opens before the natural echo entry', () => {
	const diag = loadDiagnostic();
	const lickId = diag.context.phraseId.replace(/_[A-G][b#]?$/, '');
	const lick = BLUES_BLUE_NOTE_LICKS.find((l: Phrase) => l.id === lickId)!;

	const secondsPerTick = 60 / (diag.context.tempo * PPQ);
	const barTicks = lick.timeSignature[0] * PPQ;
	// The user echoes a 2-bar call starting at the next bar downbeat:
	// count-in bar + 2 vamp bars after the melody began.
	const naturalEntryS = 3 * barTicks * secondsPerTick;

	it('fixture matches the diagnostic session', () => {
		expect(lick).toBeDefined();
		expect(lick.id).toBe('bbn-004');
		expect(diag.context.tempo).toBe(105);
	});

	it('the old bars-based window opened after the user started playing (the bug)', () => {
		const oldEndTick = barTicks + getPhraseEndTicks(lick, PPQ);
		const oldOpenS = oldEndTick * secondsPerTick + COOLDOWN_S;
		expect(oldOpenS).toBeGreaterThan(naturalEntryS);
	});

	it('the melody-based window opens before the user starts playing', () => {
		const endTick = barTicks + getPhraseEndTicks(lick, PPQ, true);
		const openS = endTick * secondsPerTick + COOLDOWN_S;
		// At least half a second of headroom before the natural entry.
		expect(openS).toBeLessThan(naturalEntryS - 0.5);
	});
});
