import type { Fraction, Mode, PitchClass } from '$lib/types/music';
import type { TrickContext, TrickParameters } from '$lib/types/tricks';
import { fractionToFloat } from '$lib/music/intervals';
import { midiToDisplayName, resolveUseFlats, spellingContextAt } from '$lib/music/notation';

export interface EnclosureShapeChoice {
	value: string;
	label: string;
}

/** Labels describe the whole approach, including the extra note in a three-note shape. */
export function enclosureShapeChoices(noteCount: string): EnclosureShapeChoice[] {
	if (noteCount === '1') {
		return [
			{ value: 'chromatic-below', label: 'Chromatic from below' },
			{ value: 'scale-above', label: 'Scale from above' }
		];
	}
	return [
		{ value: 'above-below', label: noteCount === '3' ? 'Above, above, below' : 'Above, below' },
		{ value: 'below-above', label: noteCount === '3' ? 'Below, below, above' : 'Below, above' },
		{ value: 'double-chromatic', label: noteCount === '3' ? 'Above, double chromatic below' : 'Double chromatic below' }
	];
}

/** Preserve the device's shape coercion when changing count, without changing other axes. */
export function enclosureParametersWithCount(parameters: TrickParameters, noteCount: string): TrickParameters {
	let shape = parameters.shape ?? 'above-below';
	if (noteCount === '1') {
		if (shape === 'above-below') shape = 'scale-above';
		else if (shape !== 'scale-above') shape = 'chromatic-below';
	} else {
		if (shape === 'chromatic-below') shape = 'double-chromatic';
		if (shape === 'scale-above') shape = 'above-below';
	}
	return { ...parameters, noteCount, shape };
}

/** Diatonic height, so an accidental changes the label without moving its staff line. */
export function enclosureStaffPosition(displayName: string): number {
	const match = /^([A-G])[#b]*(-?\d+)$/.exec(displayName);
	if (!match) throw new Error(`Invalid displayed enclosure note: ${displayName}`);
	return Number(match[2]) * 7 + 'CDEFGAB'.indexOf(match[1]);
}

/**
 * Read the whole gesture against its destination, including pickup notes still
 * sounding over the preceding chord. Resolve spelling after written transposition;
 * an absolute sharp/flat override from another key would bypass that policy.
 */
export function enclosureDisplayPitch(
	midi: number,
	arrival: Pick<TrickContext, 'chordRoot' | 'chordQuality' | 'scaleId'>,
	displayKey: PitchClass,
	transpositionSemitones: number,
	mode: Mode = 'major'
): { name: string; label: string; staffPosition: number } {
	const writtenMidi = midi + transpositionSemitones;
	const spelling = spellingContextAt({
		displayKey,
		harmony: [{
			chord: { root: arrival.chordRoot, quality: arrival.chordQuality },
			scaleId: arrival.scaleId,
			startOffset: [0, 1],
			duration: [1, 1]
		}],
		offset: 0,
		transpositionSemitones,
		mode
	});
	const name = midiToDisplayName(writtenMidi, resolveUseFlats(writtenMidi, spelling));
	return {
		name,
		label: name.replace(/-?\d+$/, '').replace(/b/g, '♭').replace(/#/g, '♯'),
		staffPosition: enclosureStaffPosition(name)
	};
}

interface CanvasNote {
	offset: Fraction;
	staffPosition: number;
}

export interface EnclosureCanvasLayout {
	width: number;
	height: number;
	beatOneX: number;
	staffLines: number[];
	points: { x: number; y: number }[];
	ticks: { column: number; label: string; x: number }[];
}

/**
 * The preview is a beat-relative excerpt. Cropping empty outer beats on phones
 * preserves target hit areas while retaining the same eighth-note spacing.
 */
export function enclosureCanvasLayout(
	notes: readonly CanvasNote[],
	targetIndex: number,
	arrivalOffset: Fraction,
	width: number
): EnclosureCanvasLayout {
	const safeWidth = Math.max(1, width);
	const compact = safeWidth < 520;
	const height = compact ? 232 : 252;
	const noteCount = Math.max(1, notes.length - 1);
	const firstColumn = compact ? 4 - noteCount : 0;
	const lastColumn = compact ? 5 : 6;
	const margin = compact ? 28 : 44;
	const spacing = Math.max(0, safeWidth - margin * 2) / (lastColumn - firstColumn);
	/** Map an eighth-note column into the current responsive viewport. */
	const x = (column: number) => margin + (column - firstColumn) * spacing;
	const center = height / 2;
	const letterStep = compact ? 21 : 24;
	const targetPosition = notes[targetIndex]?.staffPosition ?? 0;
	const arrival = fractionToFloat(arrivalOffset);
	const labels = ['3', '&', '4', '&', '1', '&', '2'];
	return {
		width: safeWidth,
		height,
		beatOneX: x(4),
		staffLines: [-2, -1, 0, 1, 2].map((line) => center + line * letterStep * 2),
		points: notes.map((note) => ({
			x: x(4 + (fractionToFloat(note.offset) - arrival) * 8),
			y: center - (note.staffPosition - targetPosition) * letterStep
		})),
		ticks: labels.flatMap((label, column) => column >= firstColumn && column <= lastColumn ? [{ column, label, x: x(column) }] : [])
	};
}
