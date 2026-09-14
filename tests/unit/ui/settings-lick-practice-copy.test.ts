/**
 * The Settings page's Lick Practice card sends the player to /lick-practice
 * for session settings. Tempo is not one of them: the setup screen has no
 * tempo control (only Deep Practice's Tempo Bump knob). Each lick keeps its
 * own tempo — a new lick starts at `NEW_LICK_DEFAULT_TEMPO` and it then moves
 * automatically with the session score (`resolveLickTempo`,
 * `computeAutoTempoAdjustment`) — so copy that lists tempo among the page's
 * settings sends the player hunting for a control that isn't there.
 *
 * A static read of the card's markup, like design-token-consistency's sweeps:
 * the page can't be rendered in Node.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NEW_LICK_DEFAULT_TEMPO } from '$lib/persistence/lick-practice-store';

const SETTINGS = fileURLToPath(new URL('../../../src/routes/settings/+page.svelte', import.meta.url));

/** The card's visible prose: its markup between the section marker and its button, tags stripped. */
function lickPracticeCardText(): string {
	const source = readFileSync(SETTINGS, 'utf8');
	const start = source.indexOf('<!-- Session config info -->');
	const end = source.indexOf('Go to Lick Practice', start);
	expect(start, 'Lick Practice card marker').toBeGreaterThan(-1);
	expect(end, 'Lick Practice card button').toBeGreaterThan(start);
	return source
		.slice(start, end)
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

describe('Settings › Lick Practice card', () => {
	it('does not list tempo among the settings made on the Lick Practice page', () => {
		const text = lickPracticeCardText();
		const where = text.split(/(?<=[.:])\s+/).find((s) => s.includes('Lick Practice page'));
		expect(where, text).toBeDefined();
		expect(where).not.toMatch(/tempo/i);
	});

	it("says tempo is per lick, from the real new-lick starting tempo", () => {
		const text = lickPracticeCardText();
		expect(text).toMatch(/tempo/i);
		expect(text).toContain(`${NEW_LICK_DEFAULT_TEMPO} BPM`);
	});
});
