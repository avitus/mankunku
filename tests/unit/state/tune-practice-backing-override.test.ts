import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { settings } from '$lib/state/settings.svelte';
import { tunePractice, initTunePractice } from '$lib/state/tune-practice.svelte';
import { sheet } from '../../helpers/tune-fixtures';

/**
 * The tune-practice setup screen's backing-track switch is a ONE-TIME
 * override of the global setting: it starts wherever Settings left it, the
 * session runs on the session value, and nothing is written back. "One time"
 * is enforced by re-seeding on every entry to setup — unlike `concertKey`,
 * which is deliberately sticky for the same tune.
 */
describe('tune practice backing-track session override', () => {
	const tune = sheet({ id: 'override-tune', title: 'Override Tune' });
	const other = sheet({ id: 'other-tune', title: 'Other Tune' });

	beforeEach(() => {
		settings.backingTrackEnabled = true;
	});

	it('seeds the session switch from the global setting', () => {
		settings.backingTrackEnabled = false;
		initTunePractice(tune);
		expect(tunePractice.config.backingTrackEnabled).toBe(false);

		settings.backingTrackEnabled = true;
		initTunePractice(tune);
		expect(tunePractice.config.backingTrackEnabled).toBe(true);
	});

	it('leaves the global setting untouched when the session switch is flipped', () => {
		settings.backingTrackEnabled = false;
		initTunePractice(tune);

		tunePractice.config.backingTrackEnabled = true;

		expect(settings.backingTrackEnabled).toBe(false);
	});

	it('re-seeds on a return visit to the same tune, discarding the override', () => {
		settings.backingTrackEnabled = false;
		initTunePractice(tune);
		tunePractice.config.backingTrackEnabled = true;

		// Leaving the session and coming back to the SAME tune: the override
		// was for one session, so the switch follows Settings again.
		initTunePractice(tune);

		expect(tunePractice.config.backingTrackEnabled).toBe(false);
	});

	it('re-seeds when a different tune is set up', () => {
		settings.backingTrackEnabled = false;
		initTunePractice(tune);
		tunePractice.config.backingTrackEnabled = true;

		initTunePractice(other);

		expect(tunePractice.config.backingTrackEnabled).toBe(false);
	});
});

/**
 * The override is only real if the SESSION value is what the audio and the
 * scoring read. A source sweep rather than a behavioural test because the
 * reads live in the route's audio orchestration, which has no Node seam: the
 * bleed-evidence call is the one that matters most and is the hardest to
 * observe — a comp grid claimed but not sounding suppresses real onsets as
 * bleed, silently costing the player notes.
 */
describe('tune-practice route reads the session override, not the global', () => {
	const route = readFileSync(
		join(__dirname, '../../../src/routes/tunes/[id]/practice/+page.svelte'),
		'utf8'
	);

	it('never reads settings.backingTrackEnabled', () => {
		const hits = [...route.matchAll(/settings\.backingTrackEnabled/g)];
		expect(
			hits,
			'the route must read the session override everywhere the global could differ — note the sweep is textual, so a comment spelling the global out trips it too'
		).toHaveLength(0);
	});

	it('passes the session value to the playback options and the bleed evidence', () => {
		const hits = [...route.matchAll(/backingTrackEnabled: tunePractice\.config\.backingTrackEnabled/g)];
		expect(hits).toHaveLength(2);
	});
});
