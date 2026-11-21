/** The chord spacers share the melody staff. abcjs treats that as two pitched
 * voices and puts every melody tie above. Seat same-pitch ties opposite their
 * stems, as for a single voice. The incoming/outgoing half of a system break
 * has just one note to anchor it. */
export function orientMelodyTies(root: Element): void {
	for (const tie of root.querySelectorAll<SVGPathElement>('path.abcjs-tie.abcjs-v0')) {
		const staff = tie.closest('.abcjs-staff-wrapper');
		if (!staff) continue;
		const centers: number[] = [];
		for (const match of tie.getAttribute('class')!.matchAll(/abcjs-(?:start|end)-m(\d+)-n(\d+)/g)) {
			const note = staff.querySelector(`.abcjs-note.abcjs-v0.abcjs-m${match[1]}.abcjs-n${match[2]}`);
			const head = note?.querySelector<SVGGraphicsElement>('.abcjs-notehead')?.getBBox();
			const stem = note?.querySelector<SVGGraphicsElement>('.abcjs-stem')?.getBBox();
			if (!head?.height || !stem?.height || stem.y >= head.y) {
				centers.length = 0;
				break;
			}
			centers.push(head.y + head.height / 2);
		}
		if (!centers.length) continue;
		const center = (centers[0] + centers[centers.length - 1]) / 2;
		const curve = tie.getBBox();
		if (curve.y + curve.height / 2 < center) {
			tie.setAttribute('transform', `translate(0 ${2 * center}) scale(1 -1)`);
		}
	}
}
