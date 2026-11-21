import type { Tune } from '$lib/types/tune';
import { fractionToFloat } from '$lib/music/intervals';

/** Draw a source-confirmed dashed continuation from an instruction to its
 * closing barline, leaving the measured text and musical spacing intact. */
export function drawDirectionLines(container: ParentNode, tune: Tune): void {
	let firstBar = 0;
	const barDuration = fractionToFloat(tune.timeSignature);
	for (const section of tune.sections) {
		for (const cue of section.directions ?? []) {
			if (!cue.extendsToBarline) continue;
			const bar = firstBar + Math.floor(fractionToFloat(cue.offset) / barDuration);
			const labels = container.querySelectorAll<SVGTextElement>(`text.abcjs-annotation.abcjs-mm${bar}`);
			const label = [...labels].find(el => el.textContent?.trim() === cue.text);
			const wrapper = label?.closest<SVGGElement>('.abcjs-staff-wrapper');
			if (!label || !wrapper) continue;
			const staff = wrapper.querySelector('.abcjs-staff')?.getBoundingClientRect();
			const ends = wrapper.querySelectorAll<SVGGElement>(`g.abcjs-bar.abcjs-v0.abcjs-mm${bar}`);
			const end = [...ends].at(-1)?.getBoundingClientRect();
			const ctm = wrapper.getScreenCTM();
			if (!staff || !end || !ctm || ctm.a <= 0 || ctm.d <= 0) continue;
			const text = label.getBoundingClientRect();
			const space = staff.height / 4;
			const left = text.right + space * 0.22;
			const right = end.right - space * 0.18;
			if (right - left < space * 0.7) continue;
			const x = (left - ctm.e) / ctm.a;
			const xEnd = (right - ctm.e) / ctm.a;
			const y = (text.y + text.height * 0.58 - ctm.f) / ctm.d;
			const dash = Math.min(space / ctm.a * 0.8, (xEnd - x) / 3);
			const tick = space / ctm.d * 0.4;
			const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			line.setAttribute('class', 'tune-direction-line');
			line.setAttribute('d', `M${x} ${y} H${xEnd}`);
			line.setAttribute('stroke', 'currentColor');
			line.setAttribute('stroke-dasharray', `${dash} ${dash * 0.75}`);
			const stop = line.cloneNode(false) as SVGPathElement;
			stop.removeAttribute('stroke-dasharray');
			stop.setAttribute('d', `M${xEnd} ${y - tick} v${tick * 2}`);
			wrapper.append(line, stop);
		}
		firstBar += section.bars;
	}
}
