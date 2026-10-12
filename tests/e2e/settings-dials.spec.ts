import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

// Product contracts, deliberately independent of the component's min/max/step.
// Exercise every selectable value so a coarser step cannot silently skip one.
const numericDials = [
	{
		name: 'Master volume',
		key: 'masterVolume',
		min: 0,
		max: 100,
		step: 5,
		divisor: 100,
		unit: '%'
	},
	{
		name: 'Metronome volume',
		key: 'metronomeVolume',
		min: 0,
		max: 100,
		step: 5,
		divisor: 100,
		unit: '%'
	},
	{
		name: 'Backing track volume',
		key: 'backingTrackVolume',
		min: 0,
		max: 100,
		step: 5,
		divisor: 100,
		unit: '%'
	},
	{
		name: 'Default tempo',
		key: 'defaultTempo',
		min: 60,
		max: 200,
		step: 5,
		divisor: 1,
		unit: ''
	},
	{
		name: 'Swing feel',
		key: 'swing',
		min: 50,
		max: 80,
		step: 1,
		divisor: 100,
		unit: '%'
	}
];

for (const dial of numericDials) {
	test(`${dial.name} offers meaningful values throughout its range and saves them`, async ({
		page
	}) => {
		await seedOnboardedAnonymous(page);
		await page.goto('/settings');
		if (dial.key === 'backingTrackVolume') {
			await page
				.getByRole('switch', { name: 'Backing track', exact: true })
				.click();
		}
		const slider = page.getByRole('slider', { name: dial.name, exact: true });
		await expect(slider).toHaveAttribute(
			'aria-valuemin',
			String(dial.min / dial.divisor)
		);
		await expect(slider).toHaveAttribute(
			'aria-valuemax',
			String(dial.max / dial.divisor)
		);
		await slider.press('Home');
		await slider.press('ArrowDown');
		for (let value = dial.min; value <= dial.max; value += dial.step) {
			if (value > dial.min) await slider.press('ArrowUp');
			await expect(slider).toHaveAttribute(
				'aria-valuenow',
				String(value / dial.divisor)
			);
			await expect(slider).toHaveAttribute(
				'aria-valuetext',
				`${value}${dial.unit}`
			);
			await expect(slider.locator('svg text')).toHaveText(
				`${value}${dial.unit}`
			);
		}
		await slider.press('ArrowUp');
		await expect(slider).toHaveAttribute(
			'aria-valuenow',
			String(dial.max / dial.divisor)
		);
		// An interior value must survive reload, not merely a default or boundary.
		await slider.press('ArrowDown');
		const saved = dial.max - dial.step;
		await page.reload();
		await expect(slider).toHaveAttribute(
			'aria-valuetext',
			`${saved}${dial.unit}`
		);
		await expect(slider).toHaveAttribute(
			'aria-valuenow',
			String(saved / dial.divisor)
		);
		expect(
			await page.evaluate((key) => {
				return JSON.parse(localStorage.getItem('mankunku:settings') ?? '{}')[
					key
				];
			}, dial.key)
		).toBe(saved / dial.divisor);
	});
}

test('swing can select and persist 62%, 63%, and 64% individually', async ({
	page
}) => {
	await seedOnboardedAnonymous(page);
	await page.goto('/settings');
	const swing = page.getByRole('slider', { name: 'Swing feel' });
	await expect(swing).toHaveAttribute('aria-valuetext', '62%');
	await swing.press('ArrowDown');
	for (const percent of [62, 63, 64]) {
		await swing.press('ArrowUp');
		await expect(swing).toHaveAttribute('aria-valuetext', `${percent}%`);
		await page.reload();
		await expect(swing).toHaveAttribute('aria-valuenow', String(percent / 100));
		await expect(swing).toHaveAttribute('aria-valuetext', `${percent}%`);
		await expect(
			page.getByRole('complementary', { name: 'Your setup' })
		).toContainText(`${percent}%`);
	}
});

// Written note labels must correspond to the stored concert MIDI pitch.
const highestNotes = [
	{
		instrument: 'Concert Pitch',
		notes: ['F4', 'C5', 'G5', 'C6', 'F#6', 'C7'],
		midi: [65, 72, 79, 84, 90, 96]
	},
	{
		instrument: 'Soprano Saxophone',
		notes: ['D6', 'E6', 'F6', 'F#6', 'G6', 'G#6'],
		midi: [84, 86, 87, 88, 89, 90]
	},
	{
		instrument: 'Tenor Saxophone',
		notes: ['D6', 'E6', 'F6', 'F#6', 'G6', 'G#6'],
		midi: [72, 74, 75, 76, 77, 78]
	},
	{
		instrument: 'Alto Saxophone',
		notes: ['C#6', 'D#6', 'E6', 'F6', 'F#6', 'G6'],
		midi: [76, 78, 79, 80, 81, 82]
	},
	{
		instrument: 'Trumpet',
		notes: ['G5', 'A#5', 'B5', 'C6', 'C#6', 'D6'],
		midi: [77, 80, 81, 82, 83, 84]
	}
];

for (const instrument of highestNotes) {
	test(`Highest note uses real written pitches for ${instrument.instrument}`, async ({
		page
	}) => {
		await seedOnboardedAnonymous(page);
		await page.goto('/settings');
		await page
			.getByRole('radiogroup', { name: 'Instrument', exact: true })
			.getByRole('radio', { name: new RegExp(`^${instrument.instrument} `) })
			.click();
		const highest = page.getByRole('slider', { name: 'Highest note' });
		await highest.press('End');
		await highest.press('Home');
		await highest.press('ArrowDown');
		for (const [index, note] of instrument.notes.entries()) {
			if (index > 0) await highest.press('ArrowUp');
			await expect(highest).toHaveAttribute('aria-valuenow', String(index));
			await expect(highest).toHaveAttribute('aria-valuetext', note);
			await expect(highest.locator('svg text')).toHaveText(note);
			await expect(
				page.getByRole('complementary', { name: 'Your setup' })
			).toContainText(`Up to ${note} written`);
			expect(
				await page.evaluate(
					() =>
						JSON.parse(localStorage.getItem('mankunku:settings') ?? '{}')
							.highestNote
				)
			).toBe(instrument.midi[index]);
		}
		await highest.press('ArrowUp');
		await expect(highest).toHaveAttribute(
			'aria-valuenow',
			String(instrument.notes.length - 1)
		);
		await page.reload();
		await expect(highest).toHaveAttribute(
			'aria-valuetext',
			instrument.notes.at(-1)!
		);
	});
}
