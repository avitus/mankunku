import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TuningFaders from '$lib/components/practice/TuningFaders.svelte';
import { summarizeTuning } from '$lib/scoring/tuning-summary';
import type { TuningSample } from '$lib/scoring/tuning';

/** `count` identical takes of one note. */
const takes = (midi: number, cents: number, count: number): TuningSample[] =>
	Array.from({ length: count }, () => ({ midi, cents }));

/** Tenor sax (written = concert + 14) in written D major. */
function renderTenor(samples: TuningSample[], displayKey = 'D') {
	return render(TuningFaders, {
		props: {
			summary: summarizeTuning(samples),
			transpositionSemitones: 14,
			displayKey,
			scaleId: 'major.ionian',
			instrumentId: 'tenor-sax',
			context: 'Tenor sax · D Major'
		}
	}).body;
}

/** The channels' data-note attributes, in document order. */
const channelNotes = (body: string) => [...body.matchAll(/data-note="([^"]+)"/g)].map(m => m[1]);

describe('tuning faders', () => {
	it('gives each played note its own channel, low to high, an octave apart included', () => {
		const body = renderTenor([...takes(72, 24, 4), ...takes(60, 3, 4), ...takes(64, 8, 4)]);
		// Concert C4, E4, C5 read as written D5, F#5, D6 on tenor.
		expect(channelNotes(body)).toEqual(['D5', 'F#5', 'D6']);
	});

	it('shows nothing for scale notes that were never played', () => {
		const body = renderTenor(takes(60, 3, 4));
		expect(channelNotes(body)).toEqual(['D5']);
	});

	it('spells the written note the way the session key does', () => {
		expect(channelNotes(renderTenor(takes(61, 0, 3), 'Bb'))).toEqual(['Eb5']);
		expect(channelNotes(renderTenor(takes(61, 0, 3), 'E'))).toEqual(['D#5']);
	});

	it('labels each channel with its offset and number of takes', () => {
		const body = renderTenor([...takes(60, 22, 4), ...takes(62, -11, 3)]);
		expect(body).toContain('aria-label="D5: 22 cents sharp, 4 takes"');
		expect(body).toContain('aria-label="E5: 11 cents flat, 3 takes"');
		expect(body).toContain('+22');
		expect(body).toContain('−11');
		expect(body).toContain('×4');
	});

	it('marks a note with too few takes as not yet steady', () => {
		const body = renderTenor([...takes(60, 22, 1), ...takes(62, 4, 3)]);
		expect(body).toMatch(/data-note="D5"[^>]*data-steady="false"/);
		expect(body).toMatch(/data-note="E5"[^>]*data-steady="true"/);
		expect(body).toContain('aria-label="D5: 22 cents sharp, 1 take"');
	});

	it('reads an in-tune note as in tune', () => {
		expect(renderTenor(takes(60, 3, 4))).toContain('aria-label="D5: in tune, 4 takes"');
	});

	it('offers the centre view only once there is a centre', () => {
		// The disabled ATTRIBUTE, not the `disabled:` utility classes.
		const centreDisabled = /<button[^>]*\sdisabled(?:=""|\s|>)[^>]*>\s*Your centre/;
		expect(renderTenor(takes(60, 10, 4))).toMatch(centreDisabled);
		const many = renderTenor([...takes(60, 10, 3), ...takes(62, 12, 3), ...takes(64, 8, 3)]);
		expect(many).toContain('Your centre');
		expect(many).not.toMatch(centreDisabled);
	});

	it('measures from A = 440 until asked otherwise', () => {
		const body = renderTenor([...takes(60, 10, 3), ...takes(62, 12, 3), ...takes(64, 8, 3)]);
		expect(body).toMatch(/aria-pressed="true"[^>]*>\s*A = 440/);
		expect(body).toMatch(/aria-pressed="false"[^>]*>\s*Your centre/);
		expect(body).not.toContain('measured from your centre');
	});

	it('ends with the advice lines', () => {
		const body = renderTenor([...takes(60, 10, 3), ...takes(62, 12, 3), ...takes(64, 8, 3)]);
		expect(body).toContain("You're 10¢ sharp overall. That's a mouthpiece adjustment, not a note problem.");
	});
});
