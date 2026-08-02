import { describe, it, expect } from 'vitest';
import { resolveNavTarget, type NavCandidate } from '$lib/tour/nav-target';

/**
 * The welcome tour points at nav links via `[data-tour="nav-*"]`, and the
 * layout renders that attribute TWICE: once in the desktop bar (`hidden
 * sm:flex`) and once in the mobile menu (inside `{#if mobileMenuOpen}`).
 *
 * driver.js resolves a string selector with `document.querySelector`, which
 * returns the first match in document order — the desktop link — and does not
 * check visibility. Below the `sm` breakpoint that link is `display: none`, so
 * the tour spotlights a zero-box invisible element.
 *
 * `resolveNavTarget` is the pure core of the fix: pick the first VISIBLE
 * candidate, or none at all (driver.js then falls back to its centred dummy
 * element, which is a readable popover rather than a misplaced spotlight).
 */

const el = (name: string) => ({ name });

function candidates(...pairs: [string, boolean][]): NavCandidate<{ name: string }>[] {
	return pairs.map(([name, visible]) => ({ el: el(name), visible }));
}

describe('resolveNavTarget', () => {
	it('picks the desktop link when the desktop bar is visible', () => {
		// Desktop viewport: only the desktop nav is rendered visibly.
		const found = resolveNavTarget(candidates(['desktop', true]));
		expect(found?.name).toBe('desktop');
	});

	it('skips the hidden desktop link and picks the open mobile menu item', () => {
		// Mobile viewport with the hamburger open: BOTH carry data-tour, and the
		// hidden desktop one comes first in document order. This is the case
		// querySelector gets wrong.
		const found = resolveNavTarget(candidates(['desktop', false], ['mobile', true]));
		expect(found?.name).toBe('mobile');
	});

	it('returns undefined when every candidate is hidden', () => {
		// Mobile viewport, menu closed — the mobile item is not in the DOM at all
		// and the desktop one is display:none. Nothing to spotlight.
		expect(resolveNavTarget(candidates(['desktop', false]))).toBeUndefined();
	});

	it('returns undefined when there are no candidates', () => {
		expect(resolveNavTarget([])).toBeUndefined();
	});

	it('never returns a hidden element even when it is the only match', () => {
		// The regression this exists to prevent: spotlighting a 0x0 invisible box.
		const found = resolveNavTarget(candidates(['hidden-only', false]));
		expect(found).toBeUndefined();
	});

	it('prefers the earliest visible candidate when several are visible', () => {
		const found = resolveNavTarget(candidates(['first', true], ['second', true]));
		expect(found?.name).toBe('first');
	});
});
