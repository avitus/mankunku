/**
 * The guided-tour registry (`src/lib/tour/tours/index.ts`) — the list
 * Settings → Tours & Help renders and replays from.
 *
 * Three contracts, each a silent failure when broken:
 *
 * 1. **Ids are unique and each resolves to its own tour.** Completion and
 *    dismissal live in `tour.svelte.ts` as sets of tour ids, synced by id. Two
 *    tours sharing an id share one "seen" flag, so finishing either hides the
 *    other's banner for good, and `getTour` returns only the first of them.
 * 2. **String anchors follow the `[data-tour="…"]` convention.** Every string
 *    `element` in the step files uses it. A class or id selector couples the
 *    tour to styling or markup that changes for unrelated reasons. Function
 *    anchors (`navTourElement`) resolve at drive time and are exempt.
 * 3. **Each string anchor is rendered on its tour's `startsAt` page.** Settings
 *    navigates to `startsAt`, then polls until every string selector mounts
 *    (`waitForTourTargets`). An anchor that isn't there burns the full timeout
 *    and driver.js falls back to a centred dummy element: the step still
 *    shows, pointing at nothing. Renaming a `data-tour` attribute in a route
 *    produces exactly that, and no other test notices.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOURS, getTour, type TourDefinition } from '$lib/tour/tours';

const SRC = join(__dirname, '../../../src');

/** `[data-tour="kebab-name"]`, capturing the name. */
const DATA_TOUR_SELECTOR = /^\[data-tour="([a-z0-9]+(?:-[a-z0-9]+)*)"\]$/;

/** The route page a tour's `startsAt` path renders. */
function pageFor(tour: TourDefinition): string {
	return join(SRC, 'routes', tour.startsAt, '+page.svelte');
}

/** Every string `element` in a tour, with its step index for failure messages. */
function stringAnchors(tour: TourDefinition): { step: number; selector: string }[] {
	return tour.steps.flatMap((s, step) =>
		typeof s.element === 'string' ? [{ step, selector: s.element }] : []
	);
}

describe('TOURS registry — ids', () => {
	it('has no duplicate ids (completion and dismissal are keyed by id)', () => {
		const ids = TOURS.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('getTour returns each registered tour, by its own id', () => {
		for (const tour of TOURS) {
			expect(getTour(tour.id), tour.id).toBe(tour);
		}
	});

	it('getTour returns undefined for an unregistered id', () => {
		expect(getTour('no-such-tour')).toBeUndefined();
	});

	it('every tour has at least one step', () => {
		for (const tour of TOURS) {
			expect(tour.steps.length, tour.id).toBeGreaterThan(0);
		}
	});
});

describe('TOURS registry — step anchors', () => {
	it('every string anchor is a [data-tour="…"] selector', () => {
		for (const tour of TOURS) {
			for (const { step, selector } of stringAnchors(tour)) {
				expect(selector, `${tour.id} step ${step}`).toMatch(DATA_TOUR_SELECTOR);
			}
		}
	});

	it("every tour's startsAt path is a real route page", () => {
		for (const tour of TOURS) {
			expect(existsSync(pageFor(tour)), `${tour.id} → ${tour.startsAt}`).toBe(true);
		}
	});

	it("every string anchor is rendered on the tour's startsAt page", () => {
		for (const tour of TOURS) {
			const page = readFileSync(pageFor(tour), 'utf8');
			for (const { step, selector } of stringAnchors(tour)) {
				const name = DATA_TOUR_SELECTOR.exec(selector)?.[1];
				expect(page, `${tour.id} step ${step}: ${selector} on ${tour.startsAt}`).toContain(
					`data-tour="${name}"`
				);
			}
		}
	});
});
