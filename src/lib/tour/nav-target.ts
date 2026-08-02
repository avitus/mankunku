/**
 * Viewport-aware targeting for guided-tour steps that point at nav links.
 *
 * `+layout.svelte` renders every `data-tour="nav-*"` attribute TWICE: once in
 * the desktop bar (`hidden sm:flex`) and once in the mobile menu (inside
 * `{#if mobileMenuOpen}`). driver.js resolves a string selector with
 * `document.querySelector`, which returns the first match in document order —
 * always the desktop link — and never checks visibility. Below the `sm`
 * breakpoint that link is `display: none`, so the tour spotlights an invisible
 * zero-size box while the popover floats beside nothing.
 *
 * Targeting the mobile selector instead is not a fix: with the hamburger
 * closed (the default) that element is not in the DOM at all, so it would
 * regress desktop without gaining anything on mobile.
 *
 * So resolve at drive time and pick whichever copy is actually on screen.
 * driver.js accepts `() => Element` for exactly this, and falls back to a
 * centred dummy element when the resolver yields nothing:
 *
 *   let t = typeof o == "function" ? o() : ... ; t || (t = dummy());
 *
 * — which is why returning `undefined` is a deliberate outcome here, not a
 * failure. A readable centred popover beats a spotlight on empty space.
 */

/** One candidate element plus whether it is currently rendered on screen. */
export interface NavCandidate<E> {
	el: E;
	visible: boolean;
}

/**
 * First visible candidate, or `undefined` when none is on screen.
 *
 * Kept generic and free of DOM types so the selection rule is unit-testable in
 * the Node test environment; `navTourElement` supplies the real elements.
 */
export function resolveNavTarget<E>(candidates: readonly NavCandidate<E>[]): E | undefined {
	return candidates.find((c: NavCandidate<E>) => c.visible)?.el;
}

/**
 * True when the element occupies space in the layout.
 *
 * Uses the bounding rect rather than `offsetParent`, which is also null for
 * `position: fixed` subtrees and would report a visible fixed nav as hidden.
 * A `display: none` element measures 0×0 in every engine, which is the case
 * this needs to catch.
 */
export function isRendered(el: Element): boolean {
	const rect = el.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0;
}

/**
 * driver.js `element` resolver for the nav link identified by `tourKey`
 * (the `tourKey` field of a `navItems` entry in `+layout.svelte`).
 *
 * Evaluated when the step is reached, so it reflects the viewport and the
 * hamburger state at that moment rather than at tour-definition time.
 *
 * The return type is a deliberate widening. driver.js 1.4.0 declares
 * `element?: string | Element | (() => Element)`, but its runtime is:
 *
 *   let t = typeof o == "function" ? o() : ...;
 *   t || (t = dummyElement());   // 0x0, position:fixed at 50%/50%
 *
 * so a falsy return is a supported path to the centred popover — and it is the
 * outcome we want when no copy of the link is on screen. The single cast here
 * records that the published type is narrower than the actual contract;
 * everything below it (`resolveNavTarget`) keeps the honest `| undefined`.
 */
export function navTourElement(tourKey: string): () => Element {
	const resolve = (): Element | undefined => {
		if (typeof document === 'undefined') return undefined;
		const matches = Array.from(document.querySelectorAll(`[data-tour="nav-${tourKey}"]`));
		return resolveNavTarget(matches.map((el: Element) => ({ el, visible: isRendered(el) })));
	};
	return resolve as () => Element;
}
