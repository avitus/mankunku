import { describe, it, expect } from 'vitest';
import {
	detectNoteEvents,
	eventsByBar,
	positionToLetter,
	barEvidence
} from '$lib/tunes/import/pdf-noteheads';
import type { SystemGeometry } from '$lib/tunes/import/pdf-geometry';

// Production-scale synthetic staff: interline 20, lines at 80..160.
const W = 800;
const H = 320;
const LINES = [80, 100, 120, 140, 160];

function makePage() {
	const data = new Uint8ClampedArray(W * H * 4).fill(255);
	const set = (x: number, y: number): void => {
		if (x < 0 || y < 0 || x >= W || y >= H) return;
		const i = (y * W + x) * 4;
		data[i] = 0;
		data[i + 1] = 0;
		data[i + 2] = 0;
	};
	const hline = (y: number, xa: number, xb: number): void => {
		for (let x = xa; x <= xb; x++) set(x, y);
	};
	const vline = (x: number, ya: number, yb: number, w = 3): void => {
		for (let dx = 0; dx < w; dx++) for (let y = ya; y <= yb; y++) set(x + dx, y);
	};
	// Solid ellipse-ish notehead centered at (cx, cy): 26 x 18 px.
	const head = (cx: number, cy: number): void => {
		for (let dy = -9; dy <= 9; dy++) {
			const half = Math.round(13 * Math.sqrt(Math.max(0, 1 - (dy / 9) ** 2)));
			for (let dx = -half; dx <= half; dx++) set(cx + dx, cy + dy);
		}
	};
	// Hollow ellipse (whole note): ring of ~4px wall.
	const hollowHead = (cx: number, cy: number): void => {
		for (let dy = -9; dy <= 9; dy++) {
			const outer = Math.round(14 * Math.sqrt(Math.max(0, 1 - (dy / 9) ** 2)));
			const inner = Math.round(9 * Math.sqrt(Math.max(0, 1 - (dy / 5.5) ** 2)));
			for (let dx = -outer; dx <= outer; dx++) {
				if (Math.abs(dx) >= inner || Math.abs(dy) > 5.5) set(cx + dx, cy + dy);
			}
		}
	};
	for (const y of LINES) hline(y, 40, 760);
	return { page: { data, width: W, height: H }, set, hline, vline, head, hollowHead };
}

const system = (barlines: number[]): SystemGeometry => ({
	band: { top: 80, bottom: 160, lines: LINES },
	interline: 20,
	barlines,
	repeatDots: barlines.map(() => ({ left: false, right: false })),
	firstBarLeft: 120
});

describe('detectNoteEvents', () => {
	it('finds an up-stem quarter note (head bottom-left) at its staff position', () => {
		const { page, vline, head } = makePage();
		// Head centered on the middle line (position 4), stem up-right.
		head(300, 120);
		vline(311, 120 - 70, 120, 3);
		const events = detectNoteEvents(page, system([200, 500, 760]));
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe('stemmed');
		expect(events[0].position).toBe(4);
		expect(Math.abs(events[0].x - 300)).toBeLessThanOrEqual(8);
	});

	it('finds a down-stem note (head top-right)', () => {
		const { page, vline, head } = makePage();
		// Head in the top space (position 7 → y=90), stem down-left.
		head(400, 90);
		vline(386, 90, 90 + 70, 3);
		const events = detectNoteEvents(page, system([200, 500, 760]));
		expect(events).toHaveLength(1);
		expect(events[0].position).toBe(7);
	});

	it('finds a stemless whole note via its hollow ring', () => {
		const { page, hollowHead } = makePage();
		hollowHead(350, 110); // position 5 (space above middle line)
		const events = detectNoteEvents(page, system([200, 500, 760]));
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe('hollow');
		expect(events[0].position).toBe(5);
	});

	it('does not read a sharp (paired thin strokes) as a note', () => {
		const { page, vline, set } = makePage();
		// Two vertical strokes 8px apart with crossbars — a sharp glyph.
		vline(300, 95, 145, 2);
		vline(308, 93, 143, 2);
		for (let x = 294; x <= 316; x++) {
			set(x, 110);
			set(x, 111);
			set(x, 128);
			set(x, 129);
		}
		expect(detectNoteEvents(page, system([200, 500, 760]))).toHaveLength(0);
	});

	it('keeps a down-stem note whose stem sits close to a preceding sharp', () => {
		const { page, vline, head, set } = makePage();
		// Sharp glyph strokes (short, aligned) at 330/338, then the note's
		// down-stem at 346 — within pairing distance of the sharp's right
		// stroke, but much longer: it must NOT be eaten as an accidental.
		vline(330, 95, 145, 2);
		vline(338, 93, 143, 2);
		for (let x = 324; x <= 346; x++) {
			set(x, 110);
			set(x, 111);
			set(x, 128);
			set(x, 129);
		}
		head(360, 90); // head top-right of the down-stem
		vline(346, 90, 160, 3);
		const events = detectNoteEvents(page, system([200, 500, 760]));
		expect(events).toHaveLength(1);
		expect(events[0].position).toBe(7);
	});

	it('does not read chord text above the staff as whole notes', () => {
		const { page, set } = makePage();
		// A big "D"-like glyph 2.5 interlines above the top line: ring-ish
		// arcs but vertically continuous over 3 interlines.
		for (let y = 10; y <= 70; y++) {
			set(300, y);
			set(301, y);
			set(302, y);
		}
		for (let x = 300; x <= 330; x++) {
			for (const y of [10, 11, 68, 69, 70]) set(x, y);
		}
		expect(detectNoteEvents(page, system([200, 500, 760]))).toHaveLength(0);
	});

	it('does not read a lyric-like blob below the staff as a whole note', () => {
		const { page, set } = makePage();
		// An "o" glyph ~2 interlines below the bottom line (lyric row).
		for (let dy = -8; dy <= 8; dy++) {
			const outer = Math.round(10 * Math.sqrt(Math.max(0, 1 - (dy / 8) ** 2)));
			const inner = Math.round(6 * Math.sqrt(Math.max(0, 1 - (dy / 5) ** 2)));
			for (let dx = -outer; dx <= outer; dx++) {
				if (Math.abs(dx) >= inner || Math.abs(dy) > 5) set(350 + dx, 200 + dy);
			}
		}
		expect(detectNoteEvents(page, system([200, 500, 760]))).toHaveLength(0);
	});

	it('drops stacked ring hits at one x (meter digits), keeping real whole notes', () => {
		const { page, hollowHead } = makePage();
		// Two ring-like blobs stacked at the same x — a 4/4 meter's digit
		// counters — versus a lone real whole note elsewhere.
		hollowHead(300, 90);
		hollowHead(300, 150);
		hollowHead(600, 110);
		const events = detectNoteEvents(page, system([200, 500, 760]));
		expect(events).toHaveLength(1);
		expect(events[0].x).toBe(600);
	});

	it('does not read a barline as a note', () => {
		const { page, vline } = makePage();
		vline(500, 80, 160, 3);
		expect(detectNoteEvents(page, system([200, 500, 760]))).toHaveLength(0);
	});

	it('finds both notes of a beamed pair (beam does not read as a head)', () => {
		const { page, vline, head, hline } = makePage();
		// Two up-stem heads on the bottom line (position 0), beam on top.
		head(300, 160);
		vline(311, 90, 160, 3);
		head(380, 160);
		vline(391, 90, 160, 3);
		for (let dy = 0; dy < 10; dy++) hline(90 + dy, 311, 394);
		const events = detectNoteEvents(page, system([200, 500, 760]));
		expect(events).toHaveLength(2);
		expect(events.map((e) => e.position)).toEqual([0, 0]);
	});
});

describe('eventsByBar', () => {
	it('groups events by the barline that ends their bar', () => {
		const sys = system([200, 500, 760]);
		const bars = eventsByBar(
			[
				{ x: 150, anchorX: 162, position: 4, kind: 'stemmed' },
				{ x: 300, anchorX: 312, position: 2, kind: 'stemmed' },
				{ x: 450, anchorX: 450, position: 6, kind: 'hollow' },
				{ x: 700, anchorX: 712, position: 0, kind: 'stemmed' }
			],
			sys
		);
		expect(bars.map((b) => b.length)).toEqual([1, 2, 1]);
	});
});

describe('positionToLetter', () => {
	it('maps staff positions to treble letter names', () => {
		expect(positionToLetter(0)).toBe('E4');
		expect(positionToLetter(4)).toBe('B4');
		expect(positionToLetter(8)).toBe('F5');
		expect(positionToLetter(-2)).toBe('C4');
		expect(positionToLetter(9)).toBe('G5');
	});
});

describe('barEvidence', () => {
	it('summarizes counts and letters per bar', () => {
		const sys = system([200, 500, 760]);
		const ev = barEvidence(
			[
				{ x: 150, anchorX: 162, position: 4, kind: 'stemmed' },
				{ x: 300, anchorX: 312, position: 2, kind: 'stemmed' },
				{ x: 450, anchorX: 450, position: 6, kind: 'hollow' }
			],
			sys
		);
		expect(ev).toEqual([
			{ count: 1, letters: ['B4'] },
			{ count: 2, letters: ['G4', 'D5'] },
			{ count: 0, letters: [] }
		]);
	});
});
