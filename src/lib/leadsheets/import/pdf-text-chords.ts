/**
 * Chord symbols, rehearsal marks, ending labels, and printed bar numbers
 * from a PDF's text layer, anchored to the staff systems found by
 * `analyzePageGeometry`. Born-digital charts carry chord text as real text
 * items, so reading them beats re-transcribing them with a vision model.
 *
 * Two text-layer shapes observed across MuseScore exports:
 *  - MuseJazz parts: quality glyphs come from the text font's private-use
 *    area spliced INTO items ("G7" = GΔ7), superscript alterations
 *    are separate smaller raised items ("11" = ♯11), and bold text
 *    (rehearsal marks, ending numbers) is printed twice ~2px apart;
 *  - plain-font parts: one Unicode item per chord ("G♯-7♭5"), rehearsal
 *    marks in their own bold font, printed bar numbers in the left margin.
 */
import type { SystemGeometry } from './pdf-geometry';

/** A text item in page pixel space (same scale as the geometry analysis). */
export interface PageTextItem {
	str: string;
	/** Left edge. */
	x: number;
	/** Baseline y. */
	y: number;
	/** Glyph height in pixels. */
	h: number;
	/** Advance width in pixels. */
	w: number;
	/** PDF font identifier — rehearsal marks often use their own bold font. */
	font?: string;
}

export interface SystemTexts {
	/** Chord symbols in x order, text normalized to plain ASCII-ish form. */
	chords: Array<{ x: number; text: string }>;
	/** Rehearsal marks (single letters), in x order. */
	marks: Array<{ x: number; text: string }>;
	/** Volta ending labels ("1." → 1), in x order. */
	endings: Array<{ x: number; n: number }>;
	/** Printed bar number at the system start, if any. */
	barNumber: number | null;
}

/** MuseJazz Text private-use glyphs seen in chord symbols. */
const PUA_MAP: Record<number, string> = {
	0xe10c: '#',
	0xe10d: 'b',
	0xe18a: 'Δ',
	0xe870: '(',
	0xe871: ')',
	0xe875: '(',
	0xe876: ')'
};

/** Normalize a text item's characters; null when it contains unknown
 * private-use glyphs (a music symbol we cannot read as chord text). */
function normalize(str: string): string | null {
	let out = '';
	for (const ch of str) {
		const cp = ch.codePointAt(0) ?? 0;
		if (cp >= 0xe000 && cp <= 0xf8ff) {
			const mapped = PUA_MAP[cp];
			if (mapped === undefined) return null;
			out += mapped;
		} else {
			out += ch;
		}
	}
	return out.replace(/♯/g, '#').replace(/♭/g, 'b').replace(/∆|△/g, 'Δ').trim();
}

/** Root-position chord text: letter + optional accidental + quality tail.
 * The tail may be empty ("C") — position above the staff plus the leading
 * capital carry the intent; stray lyrics rarely match this shape. */
const CHORD_RE = /^\(?[A-G][#b]?[^\s]*\)?$/;

interface Placed extends PageTextItem {
	text: string;
	bold: boolean;
}

/**
 * Assemble the per-system text annotations for one page.
 *
 * `systems` must come from `analyzePageGeometry` on the SAME rendered page
 * (same scale). Items are matched to the system whose above-staff zone
 * contains them; smaller raised items right after a chord are superscript
 * alterations and get appended to it.
 */
export function extractSystemTexts(
	items: PageTextItem[],
	systems: SystemGeometry[]
): SystemTexts[] {
	const out: SystemTexts[] = systems.map(() => ({
		chords: [],
		marks: [],
		endings: [],
		barNumber: null
	}));
	if (systems.length === 0) return out;

	// Bold text is double-printed ~2px apart: collapse the pairs.
	const placed: Placed[] = [];
	for (const it of items) {
		const text = normalize(it.str);
		if (text === null || text === '') continue;
		const twin = placed.find(
			(p) => p.text === text && Math.abs(p.x - it.x) <= 4 && Math.abs(p.y - it.y) <= 3
		);
		if (twin) {
			twin.bold = true;
			continue;
		}
		placed.push({ ...it, text, bold: false });
	}

	// Assign items to the system whose above-staff zone holds them.
	const zoneOf = (p: Placed): number => {
		for (let i = 0; i < systems.length; i++) {
			const { band, interline } = systems[i];
			if (p.y >= band.top - 6 * interline && p.y <= band.top - 0.3 * interline) return i;
		}
		return -1;
	};

	const bySystem: Placed[][] = systems.map(() => []);
	for (const p of placed) {
		const i = zoneOf(p);
		if (i >= 0) bySystem[i].push(p);
	}

	for (let i = 0; i < systems.length; i++) {
		const zone = bySystem[i].sort((a, b) => a.x - b.x);
		if (zone.length === 0) continue;
		const staffLeft = systems[i].barlines.length
			? Math.min(...systems[i].barlines)
			: Number.POSITIVE_INFINITY;
		const chordH = Math.max(...zone.map((p) => p.h));

		const consumed = new Set<Placed>();
		for (const p of zone) {
			if (consumed.has(p)) continue;

			if (/^\d+\.$/.test(p.text)) {
				out[i].endings.push({ x: p.x, n: Number.parseInt(p.text, 10) });
				continue;
			}
			// Printed bar number: small plain integer left of the first barline.
			if (/^\d+$/.test(p.text) && p.h < 0.7 * chordH && p.x < staffLeft) {
				out[i].barNumber ??= Number.parseInt(p.text, 10);
				continue;
			}
			// Rehearsal mark: a single letter that is bold (double-printed),
			// set in a font no chord-like item uses, or floating well above
			// the chord row (chords sit 2-3 interlines over the staff).
			if (/^[A-Z]$/.test(p.text)) {
				const chordFonts = new Set(
					zone
						.filter((q) => q !== p && q.text.length > 1 && CHORD_RE.test(q.text))
						.map((q) => q.font)
				);
				const ownFont = chordFonts.size > 0 && !chordFonts.has(p.font);
				const floating = p.y < systems[i].band.top - 3.2 * systems[i].interline;
				if (p.bold || ownFont || floating) {
					out[i].marks.push({ x: p.x, text: p.text });
					continue;
				}
			}
			if (!CHORD_RE.test(p.text)) continue;

			// Append superscript fragments: smaller, raised, x-adjacent.
			let text = p.text;
			let right = p.x + p.w;
			for (const q of zone) {
				if (q === p || consumed.has(q)) continue;
				const raised = q.y < p.y - 0.15 * p.h;
				const smaller = q.h <= 0.85 * p.h;
				const adjacent = q.x >= right - 6 && q.x <= right + 0.8 * p.h;
				if (raised && smaller && adjacent) {
					text += q.text;
					right = q.x + q.w;
					consumed.add(q);
				}
			}
			out[i].chords.push({ x: p.x, text: text.replace(/[()]/g, '') });
		}
		out[i].chords.sort((a, b) => a.x - b.x);
		out[i].marks.sort((a, b) => a.x - b.x);
		out[i].endings.sort((a, b) => a.x - b.x);
	}
	return out;
}
