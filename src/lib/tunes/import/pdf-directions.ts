import type { RecognizedBar } from './pdf-recognition';

/** Read the printed performance cues that the score can store and engrave. */
export function printedDirections(raw: unknown): NonNullable<RecognizedBar['directions']> {
	const directions: NonNullable<RecognizedBar['directions']> = [];
	if (!Array.isArray(raw)) return directions;
	for (const entry of raw.slice(0, 16)) {
		if (!Array.isArray(entry)) continue;
		const [beat, label] = entry;
		if (!Number.isFinite(beat) || beat < 0 || typeof label !== 'string') continue;
		const text = label.trim().toLowerCase();
		if (text === 'fine') directions.push([beat, 'Fine']);
		if (text === 'solo break') directions.push([beat, 'Solo break']);
	}
	return directions;
}
