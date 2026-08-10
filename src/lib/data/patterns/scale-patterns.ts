/**
 * Abstract melodic shapes defined as scale-degree indices.
 *
 * Each pattern's `degrees` array indexes into the realized scale tone pool:
 *   0 = root, 1 = next scale tone up, -1 = scale tone below root, etc.
 *
 * The `category` determines which scale context the combiner uses to realize pitches.
 * Pentatonic patterns target a 5-note pool, blues a 6-note pool, diatonic patterns 7-note.
 */
import type { ScalePattern } from '$lib/types/combinatorial';

export const SCALE_PATTERNS: ScalePattern[] = [
	// ── 3-note (pentatonic) ─────────────────────────────────────────
	// Pentatonic major pool: 1(0) 2(1) 3(2) 5(3) 6(4)
	{
		id: 'sp-pent-triad-up',
		name: 'Pent 1-3-5 Up',
		degrees: [0, 2, 3],
		category: 'pentatonic',
		tags: ['triad', 'ascending', 'beginner'],
		compatibleFamilies: ['pentatonic']
	},
	{
		id: 'sp-pent-triad-down',
		name: 'Pent 5-3-1 Down',
		degrees: [3, 2, 0],
		category: 'pentatonic',
		tags: ['triad', 'descending', 'beginner'],
		compatibleFamilies: ['pentatonic']
	},
	{
		id: 'sp-pent-neighbor',
		name: 'Pent Upper Neighbor',
		degrees: [0, 1, 0],
		category: 'pentatonic',
		tags: ['neighbor', 'beginner'],
		compatibleFamilies: ['pentatonic']
	},
	{
		id: 'sp-pent-step-up',
		name: 'Pent 1-2-3 Step',
		degrees: [0, 1, 2],
		category: 'pentatonic',
		tags: ['scalar', 'ascending', 'beginner'],
		compatibleFamilies: ['pentatonic']
	},

	// ── 4-note (pentatonic) ─────────────────────────────────────────
	{
		id: 'sp-pent-run-4',
		name: 'Pent 1-2-3-5',
		degrees: [0, 1, 2, 3],
		category: 'pentatonic',
		tags: ['ascending', 'run', 'beginner'],
		compatibleFamilies: ['pentatonic']
	},
	{
		id: 'sp-pent-run-down-4',
		name: 'Pent 5-3-2-1',
		degrees: [3, 2, 1, 0],
		category: 'pentatonic',
		tags: ['descending', 'run', 'beginner'],
		compatibleFamilies: ['pentatonic']
	},
	{
		id: 'sp-pent-skip',
		name: 'Pent 1-3-2-5',
		degrees: [0, 2, 1, 3],
		category: 'pentatonic',
		tags: ['skip', 'digital-pattern'],
		compatibleFamilies: ['pentatonic']
	},
	{
		id: 'sp-pent-turn',
		name: 'Pent Turn',
		degrees: [1, 0, -1, 0],
		category: 'pentatonic',
		tags: ['turn', 'ornament'],
		compatibleFamilies: ['pentatonic']
	},

	// ── 5-note (pentatonic) ─────────────────────────────────────────
	{
		id: 'sp-pent-up-full',
		name: 'Pent Full Ascend',
		degrees: [0, 1, 2, 3, 4],
		category: 'pentatonic',
		tags: ['pentatonic', 'ascending', 'run'],
		compatibleFamilies: ['pentatonic']
	},
	{
		id: 'sp-pent-down-full',
		name: 'Pent Full Descend',
		degrees: [4, 3, 2, 1, 0],
		category: 'pentatonic',
		tags: ['pentatonic', 'descending', 'run'],
		compatibleFamilies: ['pentatonic']
	},
	{
		id: 'sp-pent-wave',
		name: 'Pent Wave',
		degrees: [0, 2, 1, 3, 2],
		category: 'pentatonic',
		tags: ['pentatonic', 'direction-change'],
		compatibleFamilies: ['pentatonic']
	},

	// ── 4-note (blues) ──────────────────────────────────────────────
	// Blues minor pool: 1(0) b3(1) 4(2) b5(3) 5(4) b7(5)
	{
		id: 'sp-blues-turn',
		name: 'Blues Blue-Note Turn',
		degrees: [0, 2, 3, 4],
		category: 'blues',
		tags: ['blues', 'turnaround'],
		compatibleFamilies: ['blues']
	},
	{
		id: 'sp-blues-bend',
		name: 'Blues Bend Down',
		degrees: [4, 3, 2, 0],
		category: 'blues',
		tags: ['blues', 'descending'],
		compatibleFamilies: ['blues']
	},

	// ── 5-note (blues) ──────────────────────────────────────────────
	{
		id: 'sp-blues-run',
		name: 'Blues Run Up',
		degrees: [0, 1, 2, 3, 4],
		category: 'blues',
		tags: ['blues', 'ascending', 'run'],
		compatibleFamilies: ['blues']
	},

	// ── 3-note (diatonic — ii-V-I major) ────────────────────────────
	// Ionian pool: 1(0) 2(1) 3(2) 4(3) 5(4) 6(5) 7(6)
	{
		id: 'sp-diat-triad-up',
		name: 'Diatonic 1-3-5',
		degrees: [0, 2, 4],
		category: 'ii-V-I-major',
		tags: ['triad', 'ascending'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},

	// ── 4-note (diatonic) ───────────────────────────────────────────
	{
		id: 'sp-1357-arp',
		name: 'Maj7 Arpeggio',
		degrees: [0, 2, 4, 6],
		category: 'ii-V-I-major',
		tags: ['arpeggio', 'ascending'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-encl-above',
		name: 'Enclosure From Above',
		degrees: [1, -1, 0, 2],
		category: 'enclosures',
		tags: ['enclosure', 'chromatic'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-diat-1235',
		name: 'Diatonic 1-2-3-5',
		degrees: [0, 1, 2, 4],
		category: 'digital-patterns',
		tags: ['ascending', 'digital-pattern'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},

	// ── 5-note (diatonic) ───────────────────────────────────────────
	{
		id: 'sp-arp-resolve',
		name: 'Arp & Resolve',
		degrees: [0, 2, 4, 6, 4],
		category: 'ii-V-I-major',
		tags: ['arpeggio', 'resolve'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},

	// ── 6-note (diatonic) ───────────────────────────────────────────
	{
		id: 'sp-scale-run-up',
		name: 'Scale Run Up',
		degrees: [0, 1, 2, 3, 4, 5],
		category: 'digital-patterns',
		tags: ['scalar', 'ascending', 'run'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-scale-run-down',
		name: 'Scale Run Down',
		degrees: [5, 4, 3, 2, 1, 0],
		category: 'digital-patterns',
		tags: ['scalar', 'descending', 'run'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-arp-scale-down',
		name: 'Arp Up Scale Down',
		degrees: [0, 2, 4, 3, 2, 1],
		category: 'ii-V-I-major',
		tags: ['arpeggio', 'scalar', 'direction-change'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-diat-triad-down',
		name: 'Diatonic 5-3-1',
		degrees: [4, 2, 0],
		category: 'ii-V-I-major',
		tags: ['triad', 'descending'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-maj7-arp-down',
		name: 'Maj7 Arpeggio Down',
		degrees: [6, 4, 2, 0],
		category: 'ii-V-I-major',
		tags: ['arpeggio', 'descending'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},

	// ── ii-V-I minor (aeolian pool) ─────────────────────────────────
	// Aeolian pool: 1(0) 2(1) b3(2) 4(3) 5(4) b6(5) b7(6)
	{
		id: 'sp-min-triad-up',
		name: 'Minor 1-b3-5',
		degrees: [0, 2, 4],
		category: 'ii-V-I-minor',
		tags: ['triad', 'ascending'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-min-triad-down',
		name: 'Minor 5-b3-1',
		degrees: [4, 2, 0],
		category: 'ii-V-I-minor',
		tags: ['triad', 'descending'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-min7-arp',
		name: 'Min7 Arpeggio',
		degrees: [0, 2, 4, 6],
		category: 'ii-V-I-minor',
		tags: ['arpeggio', 'ascending'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-min7-arp-down',
		name: 'Min7 Arpeggio Down',
		degrees: [6, 4, 2, 0],
		category: 'ii-V-I-minor',
		tags: ['arpeggio', 'descending'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-min-1235',
		name: 'Minor 1-2-b3-5',
		degrees: [0, 1, 2, 4],
		category: 'ii-V-I-minor',
		tags: ['ascending', 'digital-pattern'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-min-line-down',
		name: 'Minor 5-4-b3-2-1',
		degrees: [4, 3, 2, 1, 0],
		category: 'ii-V-I-minor',
		tags: ['scalar', 'descending', 'resolve'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-min-arp-resolve',
		name: 'Minor Arp & Resolve',
		degrees: [0, 2, 4, 6, 4],
		category: 'ii-V-I-minor',
		tags: ['arpeggio', 'resolve'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-min-run-up',
		name: 'Minor Run Up',
		degrees: [0, 1, 2, 3, 4, 5],
		category: 'ii-V-I-minor',
		tags: ['scalar', 'ascending', 'run'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},

	// ── Short ii-V-I major (ionian pool) ────────────────────────────
	{
		id: 'sp-short-maj-triad',
		name: 'Short Maj 1-3-5',
		degrees: [0, 2, 4],
		category: 'short-ii-V-I-major',
		tags: ['triad', 'ascending'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-short-maj-3-2-1',
		name: 'Short Maj 3-2-1',
		degrees: [2, 1, 0],
		category: 'short-ii-V-I-major',
		tags: ['scalar', 'descending', 'resolve'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-short-maj-1234',
		name: 'Short Maj 1-2-3-4',
		degrees: [0, 1, 2, 3],
		category: 'short-ii-V-I-major',
		tags: ['scalar', 'ascending'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-short-maj-arp-down',
		name: 'Short Maj7 Down',
		degrees: [6, 4, 2, 0],
		category: 'short-ii-V-I-major',
		tags: ['arpeggio', 'descending'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-short-maj-encl-1',
		name: 'Short Maj Enclose 1',
		degrees: [2, 1, 0, -1, 0],
		category: 'short-ii-V-I-major',
		tags: ['enclosure', 'resolve'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-short-maj-54321',
		name: 'Short Maj 5-4-3-2-1',
		degrees: [4, 3, 2, 1, 0],
		category: 'short-ii-V-I-major',
		tags: ['scalar', 'descending', 'resolve'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},

	// ── Short ii-V-I minor (aeolian pool) ───────────────────────────
	{
		id: 'sp-short-min-triad',
		name: 'Short Min 1-b3-5',
		degrees: [0, 2, 4],
		category: 'short-ii-V-I-minor',
		tags: ['triad', 'ascending'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-short-min-b3-2-1',
		name: 'Short Min b3-2-1',
		degrees: [2, 1, 0],
		category: 'short-ii-V-I-minor',
		tags: ['scalar', 'descending', 'resolve'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-short-min7-arp',
		name: 'Short Min7 Arp',
		degrees: [0, 2, 4, 6],
		category: 'short-ii-V-I-minor',
		tags: ['arpeggio', 'ascending'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-short-min-5431',
		name: 'Short Min 5-4-b3-1',
		degrees: [4, 3, 2, 0],
		category: 'short-ii-V-I-minor',
		tags: ['scalar', 'descending'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},
	{
		id: 'sp-short-min-run',
		name: 'Short Min 1-2-b3-4-5',
		degrees: [0, 1, 2, 3, 4],
		category: 'short-ii-V-I-minor',
		tags: ['scalar', 'ascending', 'run'],
		compatibleFamilies: ['major', 'melodic-minor', 'harmonic-minor']
	},

	// ── Bebop lines (bebop dominant pool) ───────────────────────────
	// Bebop dominant pool: 1(0) 2(1) 3(2) 4(3) 5(4) 6(5) b7(6) 7(7).
	// The added natural 7 is the whole point: it puts chord tones on the
	// downbeats when the scale is run in straight eighths, which is why the
	// eight-note runs below are the idiomatic shapes and not just long ones.
	{
		id: 'sp-bebop-arp-up',
		name: 'Bebop 1-3-5-b7',
		degrees: [0, 2, 4, 6],
		category: 'bebop-lines',
		tags: ['arpeggio', 'ascending'],
		compatibleFamilies: ['bebop']
	},
	{
		id: 'sp-bebop-arp-down',
		name: 'Bebop b7-5-3-1',
		degrees: [6, 4, 2, 0],
		category: 'bebop-lines',
		tags: ['arpeggio', 'descending'],
		compatibleFamilies: ['bebop']
	},
	{
		id: 'sp-bebop-3456',
		name: 'Bebop 3-4-5-6',
		degrees: [2, 3, 4, 5],
		category: 'bebop-lines',
		tags: ['scalar', 'ascending'],
		compatibleFamilies: ['bebop']
	},
	{
		id: 'sp-bebop-arp-to-7',
		name: 'Bebop Arp To 7',
		degrees: [0, 2, 4, 6, 7],
		category: 'bebop-lines',
		tags: ['arpeggio', 'chromatic', 'ascending'],
		compatibleFamilies: ['bebop']
	},
	{
		id: 'sp-bebop-b7-down',
		name: 'Bebop b7 Down To 1',
		degrees: [6, 5, 4, 3, 2, 1, 0],
		category: 'bebop-lines',
		tags: ['scalar', 'descending', 'run'],
		compatibleFamilies: ['bebop']
	},
	{
		id: 'sp-bebop-descend-full',
		name: 'Bebop Descending Scale',
		degrees: [7, 6, 5, 4, 3, 2, 1, 0],
		category: 'bebop-lines',
		tags: ['scalar', 'descending', 'run', 'bebop'],
		compatibleFamilies: ['bebop']
	},
	{
		id: 'sp-bebop-ascend-full',
		name: 'Bebop Ascending Scale',
		degrees: [0, 1, 2, 3, 4, 5, 6, 7],
		category: 'bebop-lines',
		tags: ['scalar', 'ascending', 'run', 'bebop'],
		compatibleFamilies: ['bebop']
	},

	// ── Blues (blues minor pool) ────────────────────────────────────
	// Blues minor pool: 1(0) b3(1) 4(2) b5(3) 5(4) b7(5)
	{
		id: 'sp-blues-cell',
		name: 'Blues 1-b3-4',
		degrees: [0, 1, 2],
		category: 'blues',
		tags: ['blues', 'ascending', 'beginner'],
		compatibleFamilies: ['blues']
	},
	{
		id: 'sp-blues-top-down',
		name: 'Blues b7-5-b5-4',
		degrees: [5, 4, 3, 2],
		category: 'blues',
		tags: ['blues', 'descending'],
		compatibleFamilies: ['blues']
	},
	{
		id: 'sp-blues-full-up',
		name: 'Blues Full Ascend',
		degrees: [0, 1, 2, 3, 4, 5],
		category: 'blues',
		tags: ['blues', 'ascending', 'run'],
		compatibleFamilies: ['blues']
	},

	// ── Modal (dorian pool) ─────────────────────────────────────────
	// Dorian pool: 1(0) 2(1) b3(2) 4(3) 5(4) 6(5) b7(6). Degree 5 is the
	// natural 6 — the note that makes it dorian rather than aeolian, so the
	// descending shape below leads with it deliberately.
	{
		id: 'sp-modal-min7-arp',
		name: 'Dorian Min7 Arp',
		degrees: [0, 2, 4, 6],
		category: 'modal',
		tags: ['arpeggio', 'ascending', 'modal'],
		compatibleFamilies: ['major']
	},
	{
		id: 'sp-modal-6-down',
		name: 'Dorian 6 Down',
		degrees: [5, 4, 3, 2, 1, 0],
		category: 'modal',
		tags: ['scalar', 'descending', 'modal'],
		compatibleFamilies: ['major']
	},
	{
		id: 'sp-modal-run-up',
		name: 'Dorian Run Up',
		degrees: [0, 1, 2, 3, 4, 5],
		category: 'modal',
		tags: ['scalar', 'ascending', 'modal'],
		compatibleFamilies: ['major']
	}
];
