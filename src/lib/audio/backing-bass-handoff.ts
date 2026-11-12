/** Reachability of existing walking candidates into an already chosen approach. */
export function filterBassHandoffOptions(options: readonly number[], input: {
	beat: 1 | 2;
	approachMidi: number;
	chordPcs: readonly number[];
}): number[] {
	const chordTones = Array.from({ length: 28 }, (_, index) => index + 28)
		.filter(midi => input.chordPcs.includes(midi % 12) && Math.abs(midi - input.approachMidi) <= 5);
	return options.filter(midi => Number.isInteger(midi) && midi >= 28 && midi <= 55 &&
		(input.beat === 2 ? chordTones.includes(midi)
			: chordTones.some(next => next !== midi && Math.abs(next - midi) <= 5)));
}
