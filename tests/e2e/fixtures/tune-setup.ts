import { expect, type Page } from '@playwright/test';

export async function setTuneTempo(page: Page, bpm: number): Promise<void> {
	const dial = page.getByRole('slider', { name: 'Tempo', exact: true });
	await dial.press('Home');
	if (bpm === 240) await dial.press('End');
	else {
		for (let n = 0; n < Math.floor((bpm - 40) / 5); n++) await dial.press('PageUp');
		for (let n = 0; n < (bpm - 40) % 5; n++) await dial.press('ArrowUp');
	}
	await expect(dial).toHaveAttribute('aria-valuenow', String(bpm));
}

export async function openTuneSettings(page: Page): Promise<void> {
	const settings = page.locator('details.sd-advanced');
	if (!(await settings.evaluate(el => (el as HTMLDetailsElement).open))) await settings.locator(':scope > summary').click();
}
