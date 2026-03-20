import type { PhraseCategory, ScaleFamily, Fraction } from './music.ts';

export interface ScalePattern {
	id: string;
	name: string;
	/**
	 * 0-based indices into the realized scale tone pool, relative to root.
	 * 0 = root, 1 = next scale tone up, -1 = scale tone below root, etc.
	 * Octave boundaries are crossed naturally (e.g. degree 7 on a 7-note scale = next octave root).
	 */
	degrees: number[];
	category: PhraseCategory;
	tags: string[];
	/** Restrict to specific scale families; null/undefined = all */
	compatibleFamilies?: ScaleFamily[] | null;
}

export interface RhythmPattern {
	id: string;
	name: string;
	noteCount: number;
	slots: { offset: Fraction; duration: Fraction }[];
	timeSignature: [number, number];
	bars: number;
	tags: string[];
}
