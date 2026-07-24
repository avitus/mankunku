import { describe, it, expect } from 'vitest';
import {
	findStaffBands,
	findBarlines,
	assignChordBeat,
	analyzePageGeometry,
	type ColumnProfile
} from '$lib/leadsheets/import/pdf-geometry';

/** Build a row-darkness array with 5-line staves at the given line rows. */
function rowsWithStaves(height: number, staves: number[][]): number[] {
	const rows = new Array<number>(height).fill(0.02);
	for (const staff of staves) for (const line of staff) rows[line] = 0.85;
	return rows;
}

describe('findStaffBands', () => {
	it('finds one five-line staff', () => {
		const rows = rowsWithStaves(200, [[50, 60, 70, 80, 90]]);
		const bands = findStaffBands(rows);
		expect(bands).toHaveLength(1);
		expect(bands[0].top).toBe(50);
		expect(bands[0].bottom).toBe(90);
	});

	it('finds multiple systems and keeps them separate', () => {
		const rows = rowsWithStaves(400, [
			[50, 60, 70, 80, 90],
			[250, 260, 270, 280, 290]
		]);
		const bands = findStaffBands(rows);
		expect(bands).toHaveLength(2);
		expect(bands[1].top).toBe(250);
		expect(bands[1].bottom).toBe(290);
	});

	it('tolerates thick lines (adjacent dark rows are one line)', () => {
		const rows = rowsWithStaves(200, [[50, 51, 60, 61, 70, 71, 80, 81, 90, 91]]);
		const bands = findStaffBands(rows);
		expect(bands).toHaveLength(1);
		expect(bands[0].top).toBeGreaterThanOrEqual(50);
		expect(bands[0].bottom).toBeLessThanOrEqual(92);
	});

	it('ignores stray dark rows that do not form five evenly spaced lines', () => {
		const rows = rowsWithStaves(300, [[50, 60, 70, 80, 90]]);
		rows[150] = 0.9; // a lone dark row (e.g. a text underline)
		const bands = findStaffBands(rows);
		expect(bands).toHaveLength(1);
	});

	it('still finds a staff when a beam row darkens the space between lines', () => {
		// A long beam inside the staff adds a dark row at 65 — between real
		// lines. The five real lines must still be recognized.
		const rows = rowsWithStaves(400, [
			[50, 60, 70, 80, 90],
			[250, 260, 270, 280, 290]
		]);
		rows[65] = 0.55;
		const bands = findStaffBands(rows);
		expect(bands).toHaveLength(2);
		expect(bands[0].lines).toEqual([50, 60, 70, 80, 90]);
	});

	it('rejects a dark row just outside a staff as a phantom sixth line', () => {
		// Ledger-line-heavy passages put dark rows above the staff; the band
		// must stay anchored on the five real lines.
		const rows = rowsWithStaves(300, [[50, 60, 70, 80, 90]]);
		rows[40] = 0.5; // exactly one interline above the top line
		const bands = findStaffBands(rows);
		expect(bands).toHaveLength(1);
		expect(bands[0].lines).toContain(90);
	});
});

describe('findBarlines', () => {
	// Profiles for a band of height 4 interlines (il = 10 → bandH 40).
	const IL = 10;
	const EMPTY: ColumnProfile = {
		fill: 0.05,
		maxGap: 38,
		spans: false,
		touchesTop: false,
		touchesBottom: false,
		above: 0,
		below: 0,
		offLine: 0
	};
	const BAR: ColumnProfile = {
		fill: 1,
		maxGap: 0,
		spans: true,
		touchesTop: true,
		touchesBottom: true,
		above: 0,
		below: 0,
		offLine: 30
	};
	const NOTEHEAD: ColumnProfile = { ...EMPTY, fill: 0.25, offLine: 10 };

	function cols(width: number, placed: Record<number, ColumnProfile>): ColumnProfile[] {
		return Array.from({ length: width }, (_, x) => placed[x] ?? EMPTY);
	}

	it('accepts clean barlines and rejects a stem via the chunk test', () => {
		const placed: Record<number, ColumnProfile> = { 10: BAR, 100: BAR, 200: BAR };
		// Stem at 150 with notehead mass at ±0.4 il.
		placed[150] = { ...BAR };
		for (const dx of [-5, -4, -3, 3, 4, 5]) placed[150 + dx] = NOTEHEAD;
		const xs = findBarlines(cols(240, placed), IL);
		expect(xs).toEqual([10, 100, 200]);
	});

	it('rejects a stem running a full interline up to a beam above the staff', () => {
		// Contiguous extension ≥ 0.9 il beyond the staff is stem-to-beam ink;
		// no barline reaches that far out.
		const placed: Record<number, ColumnProfile> = {
			10: BAR,
			100: { ...BAR, above: 12 },
			150: { ...BAR, below: 11 },
			200: BAR
		};
		const xs = findBarlines(cols(240, placed), IL);
		expect(xs).toEqual([10, 200]);
	});

	it('keeps a winged repeat barline (short hooks beyond the staff, no chunk mass)', () => {
		// Jazz-style winged |: extends ~0.5 il above AND below the staff, but
		// its neighborhood is clean — unlike a stem, which carries a notehead.
		const placed: Record<number, ColumnProfile> = {
			10: BAR,
			100: { ...BAR, above: 5, below: 5 },
			200: BAR
		};
		const xs = findBarlines(cols(240, placed), IL);
		expect(xs).toEqual([10, 100, 200]);
	});

	it('keeps a barline grazed by a slur at its top (short contiguous extension)', () => {
		const placed: Record<number, ColumnProfile> = { 10: BAR, 100: { ...BAR, above: 3 }, 200: BAR };
		const xs = findBarlines(cols(240, placed), IL);
		expect(xs).toEqual([10, 100, 200]);
	});

	it('rejects a column with a white gap inside the staff (broken vertical)', () => {
		const placed: Record<number, ColumnProfile> = {
			10: BAR,
			100: { ...BAR, fill: 0.86, maxGap: 7 },
			200: BAR
		};
		const xs = findBarlines(cols(240, placed), IL);
		expect(xs).toEqual([10, 200]);
	});

	it('rejects a stem whose tie arc bridges the notehead gap (no single spanning run)', () => {
		// A beamed stem ends at its notehead ~0.5 il above the bottom line;
		// the tie below is a SEPARATE run, so fill and maxGap look fine but
		// no contiguous run covers the band.
		const placed: Record<number, ColumnProfile> = {
			10: BAR,
			100: { ...BAR, fill: 0.9, maxGap: 2, spans: false },
			200: BAR
		};
		const xs = findBarlines(cols(240, placed), IL);
		expect(xs).toEqual([10, 200]);
	});

	it('rejects a staff-spanning quarter-note stem (half-interline gap at the notehead)', () => {
		// Note on the second line, stem to just above the staff: nearly full
		// fill, but the notehead bottom leaves a ~0.5 il gap to the bottom
		// line. A real barline is continuous — gap ≈ 0.
		const placed: Record<number, ColumnProfile> = {
			10: BAR,
			100: { ...BAR, fill: 0.9, maxGap: 5, above: 5 },
			200: BAR
		};
		const xs = findBarlines(cols(240, placed), IL);
		expect(xs).toEqual([10, 200]);
	});

	it('does not let a double barline pair reject itself via the chunk test', () => {
		// Two thin lines 0.5 il apart: candidate columns are exempt from each
		// other's chunk mass, and the pair merges into one boundary.
		const placed: Record<number, ColumnProfile> = { 10: BAR, 100: BAR, 105: BAR, 200: BAR };
		const xs = findBarlines(cols(240, placed), IL);
		expect(xs).toHaveLength(3);
		expect(xs[1]).toBeGreaterThanOrEqual(100);
		expect(xs[1]).toBeLessThanOrEqual(105);
	});

	it('collapses boundaries closer than 3 il, preferring the clean column', () => {
		// A first-beat stem can land 1.5-2 il after a real barline and pass
		// every column test; bars are never that narrow. The stem's notehead
		// pokes above the staff — the clean (flag-free) boundary wins.
		const placed: Record<number, ColumnProfile> = {
			10: BAR,
			100: BAR,
			127: { ...BAR, above: 5 },
			200: BAR
		};
		const xs = findBarlines(cols(240, placed), IL);
		expect(xs).toEqual([10, 100, 200]);
	});

	it('keeps a final thin+thick barline group (~1.6 il) as one boundary', () => {
		const placed: Record<number, ColumnProfile> = { 10: BAR };
		for (let x = 200; x <= 216; x++) placed[x] = BAR;
		const xs = findBarlines(cols(240, placed), IL);
		expect(xs).toHaveLength(2);
		expect(xs[1]).toBeGreaterThanOrEqual(200);
		expect(xs[1]).toBeLessThanOrEqual(216);
	});

	it('rejects a candidate cluster wider than 2.2 il (solid blob)', () => {
		const placed: Record<number, ColumnProfile> = { 10: BAR, 200: BAR };
		for (let x = 100; x <= 126; x++) placed[x] = BAR;
		const xs = findBarlines(cols(240, placed), IL);
		expect(xs).toEqual([10, 200]);
	});

	it('rejects a top-of-staff down-stem via near-band chunk mass', () => {
		// Down-stem eighth: notehead ABOVE the staff to the stem's right,
		// beam below the staff to its left — mass just outside the band,
		// counted because offLine covers the staff ±0.9 il.
		const placed: Record<number, ColumnProfile> = { 10: BAR, 100: { ...BAR, below: 5 }, 200: BAR };
		for (const dx of [3, 4, 5]) placed[100 + dx] = { ...EMPTY, offLine: 9 };
		for (const dx of [-5, -4, -3]) placed[100 + dx] = { ...EMPTY, offLine: 6 };
		const xs = findBarlines(cols(240, placed), IL);
		expect(xs).toEqual([10, 200]);
	});
});

describe('assignChordBeat', () => {
	// A system spanning x=0..400 with 4 bars of 100px each.
	const boundaries = [0, 100, 200, 300, 400];

	it('maps a chord x to its bar and nearest half-beat (4/4)', () => {
		expect(assignChordBeat(5, boundaries, 4)).toEqual({ bar: 0, beat: 0 });
		expect(assignChordBeat(155, boundaries, 4)).toEqual({ bar: 1, beat: 2 });
		expect(assignChordBeat(210, boundaries, 4)).toEqual({ bar: 2, beat: 0.5 });
		expect(assignChordBeat(395, boundaries, 4)).toEqual({ bar: 3, beat: 3.5 });
	});

	it('returns null outside the system', () => {
		expect(assignChordBeat(-10, boundaries, 4)).toBeNull();
		expect(assignChordBeat(450, boundaries, 4)).toBeNull();
	});
});

describe('analyzePageGeometry — repeat dots', () => {
	function makePage(width: number, height: number) {
		const data = new Uint8ClampedArray(width * height * 4).fill(255);
		const set = (x: number, y: number): void => {
			const i = (y * width + x) * 4;
			data[i] = 0;
			data[i + 1] = 0;
			data[i + 2] = 0;
		};
		return {
			page: { data, width, height },
			hline: (y: number, x0: number, x1: number) => {
				for (let x = x0; x <= x1; x++) set(x, y);
			},
			vline: (x: number, y0: number, y1: number) => {
				for (let y = y0; y <= y1; y++) set(x, y);
			},
			blob: (cx: number, cy: number, r: number) => {
				for (let y = cy - r; y <= cy + r; y++)
					for (let x = cx - r; x <= cx + r; x++) set(x, y);
			}
		};
	}

	it('classifies repeat dots beside a barline and plain barlines without', () => {
		const { page, hline, vline, blob } = makePage(400, 200);
		for (const y of [80, 90, 100, 110, 120]) hline(y, 40, 360);
		for (const x of [40, 150, 260, 360]) vline(x, 80, 120);
		// |: dots right of x=150 — centered in spaces 2 and 3 (y=95, 105).
		blob(163, 95, 2);
		blob(163, 105, 2);
		// :| dots left of x=260.
		blob(247, 95, 2);
		blob(247, 105, 2);
		const [sys] = analyzePageGeometry(page);
		expect(sys.barlines).toEqual([40, 150, 260, 360]);
		expect(sys.repeatDots.map((d) => `${d.left ? 'L' : ''}${d.right ? 'R' : ''}`)).toEqual([
			'',
			'R',
			'L',
			''
		]);
	});

	it('does not read a notehead near the barline as repeat dots', () => {
		const { page, hline, vline, blob } = makePage(400, 200);
		for (const y of [80, 90, 100, 110, 120]) hline(y, 40, 360);
		for (const x of [40, 150, 360]) vline(x, 80, 120);
		// A notehead straddling the middle line just after x=150: one blob
		// covering both space centers WITHOUT the white split dots have.
		blob(165, 100, 6);
		const [sys] = analyzePageGeometry(page);
		expect(sys.barlines).toEqual([40, 150, 360]);
		expect(sys.repeatDots[1]).toEqual({ left: false, right: false });
	});
});

describe('analyzePageGeometry', () => {
	// Paint a tiny synthetic page: white RGBA, staff lines + barlines black.
	function makePage(width: number, height: number): {
		page: { data: Uint8ClampedArray; width: number; height: number };
		hline: (y: number, x0: number, x1: number) => void;
		vline: (x: number, y0: number, y1: number) => void;
	} {
		const data = new Uint8ClampedArray(width * height * 4).fill(255);
		const set = (x: number, y: number): void => {
			const i = (y * width + x) * 4;
			data[i] = 0;
			data[i + 1] = 0;
			data[i + 2] = 0;
		};
		return {
			page: { data, width, height },
			hline: (y, x0, x1) => {
				for (let x = x0; x <= x1; x++) set(x, y);
			},
			vline: (x, y0, y1) => {
				for (let y = y0; y <= y1; y++) set(x, y);
			}
		};
	}

	it('finds a staff and its barlines from raw pixels', () => {
		const { page, hline, vline } = makePage(400, 200);
		for (const y of [80, 90, 100, 110, 120]) hline(y, 40, 360);
		for (const x of [40, 150, 260, 360]) vline(x, 80, 120);
		// A quarter-note stem that must NOT read as a barline: full staff
		// height but its "notehead" gap breaks the spanning run.
		vline(200, 80, 112);
		const systems = analyzePageGeometry(page);
		expect(systems).toHaveLength(1);
		expect(systems[0].band.top).toBe(80);
		expect(systems[0].interline).toBe(10);
		expect(systems[0].barlines).toEqual([40, 150, 260, 360]);
	});

	it('ignores colored highlight boxes (only black ink counts)', () => {
		const { page, hline, vline } = makePage(400, 200);
		for (const y of [80, 90, 100, 110, 120]) hline(y, 40, 360);
		for (const x of [40, 150, 260, 360]) vline(x, 80, 120);
		// A saturated blue box over one bar: red+green low, blue high.
		for (let y = 80; y <= 120; y++) {
			for (let x = 160; x <= 250; x++) {
				const i = (y * 400 + x) * 4;
				page.data[i] = 40;
				page.data[i + 1] = 80;
				page.data[i + 2] = 230;
			}
		}
		const systems = analyzePageGeometry(page);
		expect(systems).toHaveLength(1);
		expect(systems[0].barlines).toEqual([40, 150, 260, 360]);
	});
});
