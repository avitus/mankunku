import type { Locator } from '@playwright/test';
import { expect } from '../fixtures/test';

/** Check painted geometry, including the separate bar wash, against the row boundary. */
export async function expectFlushPracticeFrame(content: Locator): Promise<void> {
	const geometry = await content.evaluate((element) => {
		const wrap = element.closest('.chart-wrap')!;
		const row = wrap.closest('.row')!;
		const rowBottom = row.getBoundingClientRect().bottom;
		const outline = getComputedStyle(wrap, '::after');
		const frameBottom = wrap.getBoundingClientRect().top + parseFloat(outline.top) + parseFloat(outline.height);
		const wash = wrap.querySelector('.notation-wash');
		return {
			gaps: [rowBottom - frameBottom, rowBottom - element.getBoundingClientRect().bottom,
				...(wash ? [rowBottom - wash.getBoundingClientRect().bottom] : [])],
			separator: getComputedStyle(row, '::after').display
		};
	});
	for (const gap of geometry.gaps) expect(Math.abs(gap), 'frame, music and bar wash end at the row boundary').toBeLessThan(1);
	expect(geometry.separator, 'the active border replaces the separator').toBe('none');
}
