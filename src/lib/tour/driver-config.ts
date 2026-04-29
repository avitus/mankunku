import type { SupabaseClient } from '@supabase/supabase-js';
import { driver, type Config, type DriveStep, type Driver } from 'driver.js';
import { tourState, markComplete } from '$lib/state/tour.svelte';
import type { Database } from '$lib/supabase/types';
import './driver-styles.css';

/**
 * Build a driver.js config matching the Mankunku design system.
 *
 * The popover class `mankunku-tour` is styled in `Tour.svelte` via global
 * selectors against driver's DOM, so colors and typography draw from the
 * `--color-*` custom properties defined in `app.css`.
 */
export function createDefaultConfig(overrides: Partial<Config> = {}): Config {
	return {
		animate: true,
		smoothScroll: true,
		allowClose: true,
		overlayColor: '#000',
		overlayOpacity: 0.6,
		stagePadding: 6,
		stageRadius: 8,
		popoverOffset: 12,
		showProgress: true,
		showButtons: ['next', 'previous', 'close'],
		nextBtnText: 'Next →',
		prevBtnText: '← Back',
		doneBtnText: 'Done',
		progressText: '{{current}} / {{total}}',
		popoverClass: 'mankunku-tour',
		...overrides
	};
}

export interface RunTourOptions {
	/** Stable identifier; tour is marked complete in tourState on done. */
	tourId: string;
	steps: DriveStep[];
	/**
	 * Supabase client, threaded through to `markComplete` so that tour
	 * completion synced to the cloud — without it, the cross-device
	 * suppression that the rest of the feature depends on never fires.
	 */
	supabase?: SupabaseClient<Database>;
	/** Runs after the user finishes the last step. */
	onComplete?: () => void;
	/** Runs when the user closes the tour before finishing. */
	onClose?: () => void;
	/** Driver config overrides for this tour. */
	config?: Partial<Config>;
}

/**
 * Create and start a tour. Marks the tour complete in tourState only on
 * natural completion (clicking Done on the last step). Premature close
 * (Esc, X button, overlay click) is treated as "not finished yet" — the
 * banner/trigger reappears so the user can retry. Explicit dismissal
 * goes through the Skip button on TourBanner, not through driver.js.
 *
 * Scrolls to top before driving so step 1 is reliably above the fold,
 * and the no-element intro popover (which is fixed-positioned but anchors
 * to the dummy element's location) renders in the centre of the viewport.
 */
export function runTour(options: RunTourOptions): Driver {
	const { tourId, steps, supabase, onComplete, onClose, config } = options;

	if (typeof window !== 'undefined') {
		window.scrollTo({ top: 0, behavior: 'auto' });
	}

	tourState.tourInProgress = tourId;

	let completedNaturally = false;

	const instance = driver(
		createDefaultConfig({
			...config,
			steps,
			onDestroyed: () => {
				if (completedNaturally) {
					markComplete(tourId, supabase);
					onComplete?.();
				} else {
					onClose?.();
				}
				if (tourState.tourInProgress === tourId) {
					tourState.tourInProgress = null;
				}
			},
			onNextClick: (_el, _step, ctx) => {
				if (ctx.driver.isLastStep()) {
					completedNaturally = true;
					ctx.driver.destroy();
				} else {
					ctx.driver.moveNext();
				}
			}
		})
	);

	instance.drive();
	return instance;
}
