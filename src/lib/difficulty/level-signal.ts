export type LevelSignalDirection = 'up' | 'down';

/** Returns 'up' if either level rose, 'down' if either fell (up wins ties), else null. */
export function levelSignalDirection(
	prevPrimary: number,
	nextPrimary: number,
	prevScale: number,
	nextScale: number
): LevelSignalDirection | null {
	if (nextPrimary > prevPrimary || nextScale > prevScale) return 'up';
	if (nextPrimary < prevPrimary || nextScale < prevScale) return 'down';
	return null;
}
