/**
 * Slugify text into a URL-safe segment (matches GitHub's heading-anchor
 * algorithm loosely — lowercase, dashes for spaces, drop non-word
 * characters). Shared by the docs heading anchors and tune URLs; the docs
 * anchors depend on this exact behaviour, so accent folding is a separate
 * step callers opt into.
 */
export function slugify(text: string): string {
	return text
		.toLowerCase()
		.trim()
		.replace(/[^\w\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

/** Strip diacritics ("Bésame" → "Besame") so `slugify` keeps the letter instead of dropping it. */
export function foldAccents(text: string): string {
	return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
