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
	}
];
